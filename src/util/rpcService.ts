
import { rpcErr, I_rpcMsg, I_rpcTimeout, Rpc_Msg } from "./util";
import { I_baseConfig } from "../rpcServer";

export interface I_rpc_sc {
    sockets: { [id: string]: { "send": (data: Buffer) => void, "baseConfig": I_baseConfig } };
    rpc: (id: string) => RpcUtil;
    rpcAwait: (id: string, notify?: boolean) => RpcUtil;
    msgHandler: { [file: string]: any };
}


/**
 * rpc代理
 */
export class RpcService {
    private rpcSc: I_rpc_sc;

    private rpcId = 1;  // 必须从1开始，不可为0
    private rpcRequest: { [id: number]: I_rpcTimeout } = {};
    private rpcTimeMax: number = 10 * 1000; //超时时间
    private outTime = 0;    // 当前时刻 + 超时时间

    private toId: string = "";
    private notify: boolean = false;
    private rpcObj: RpcUtil = null as any;
    private rpcObjAwait: RpcUtil = null as any;


    constructor(rpcSc: I_rpc_sc) {
        this.outTime = Date.now() + this.rpcTimeMax;
        setInterval(() => {
            this.outTime = Date.now() + this.rpcTimeMax;
        }, 100);
        setInterval(this.checkTimeout.bind(this), 3000);

        this.rpcSc = rpcSc;
        this.rpcSc.rpc = this.rpcFunc.bind(this);
        this.rpcSc.rpcAwait = this.rpcFuncAwait.bind(this);

        let self = this;
        this.rpcObj = new Proxy({}, {
            get(_serverTypeDic: any, serverType: string) {
                let fileDic = _serverTypeDic[serverType];
                if (!fileDic) {
                    fileDic = new Proxy({}, {
                        get(_fileDic: any, file: string) {
                            let methodDic = _fileDic[file];
                            if (!methodDic) {
                                methodDic = new Proxy({}, {
                                    get(_methodDic: any, method: string) {
                                        let func = _methodDic[method];
                                        if (!func) {
                                            func = self.rpcFuncProxy(serverType, file + "." + method);
                                            _methodDic[method] = func;
                                        }
                                        return func;
                                    }
                                });
                                _fileDic[file] = methodDic
                            }
                            return methodDic;
                        }
                    });
                    _serverTypeDic[serverType] = fileDic;
                }
                return fileDic;
            }
        });
        this.rpcObjAwait = new Proxy({}, {
            get(_serverTypeDic: any, serverType: string) {
                let fileDic = _serverTypeDic[serverType];
                if (!fileDic) {
                    fileDic = new Proxy({}, {
                        get(_fileDic: any, file: string) {
                            let methodDic = _fileDic[file];
                            if (!methodDic) {
                                methodDic = new Proxy({}, {
                                    get(_methodDic: any, method: string) {
                                        let func = _methodDic[method];
                                        if (!func) {
                                            func = self.rpcFuncAwaitProxy(serverType, file + "." + method);
                                            _methodDic[method] = func;
                                        }
                                        return func;
                                    }
                                });
                                _fileDic[file] = methodDic
                            }
                            return methodDic;
                        }
                    });
                    _serverTypeDic[serverType] = fileDic;
                }
                return fileDic;
            }
        });

    }

    private rpcFunc(serverId: string) {
        this.toId = serverId;
        return this.rpcObj;
    }
    private rpcFuncAwait(serverId: string, notify = false) {
        this.toId = serverId;
        this.notify = notify;
        return this.rpcObjAwait;
    }
    private rpcFuncProxy(serverT: string, file_method: string) {
        let self = this;
        let func = function (...args: any[]) {
            if (self.toId === "*") {
                self.sendT(serverT, file_method, args);
            } else {
                self.send(self.toId, file_method, args);
            }
        }
        return func;
    }
    private rpcFuncAwaitProxy(serverT: string, file_method: string) {
        let self = this;
        let func = function (...args: any[]): Promise<any> | undefined {
            if (self.toId === "*") {
                return self.sendTAwait(serverT, file_method, args);
            } else {
                return self.sendAwait(self.toId, self.notify, file_method, args);
            }
        }
        return func;
    }

    private send(id: string, cmd: string, args: any[]) {
        let cb: Function = null as any;
        if (typeof args[args.length - 1] === "function") {
            cb = args.pop();
        }
        let bufLast: Buffer = null as any;
        if (args[args.length - 1] instanceof Buffer) {
            bufLast = args.pop();
        }

        let socket = this.rpcSc.sockets[id];
        if (!socket) {
            if (cb) {
                process.nextTick(() => {
                    cb(rpcErr.noServer);
                });
            }
            return;
        }

        let rpcMsg: I_rpcMsg = {
            "cmd": cmd
        };
        if (cb) {
            let id = this.getRpcId();
            this.rpcRequest[id] = { "cb": cb, "time": this.outTime, "await": false };
            rpcMsg.id = id;
        }
        socket.send(this.getRpcMsg(rpcMsg, Buffer.from(JSON.stringify(args)), bufLast, Rpc_Msg.rpcMsg));
    }



    private sendT(serverType: string, cmd: string, args: any[]) {
        let bufLast: Buffer = null as any;
        if (args[args.length - 1] instanceof Buffer) {
            bufLast = args.pop();
        }
        let msgBuf = Buffer.from(JSON.stringify(args));

        let bufEnd = this.getRpcMsg({ "cmd": cmd }, msgBuf, bufLast, Rpc_Msg.rpcMsg);
        let sockets = this.rpcSc.sockets;
        for (let id in sockets) {
            if (sockets[id].baseConfig.serverType === serverType) {
                sockets[id].send(bufEnd);
            }
        }
    }

    private sendAwait(id: string, notify: boolean, cmd: string, args: any[]): Promise<any> | undefined {
        let bufLast: Buffer = null as any;
        if (args[args.length - 1] instanceof Buffer) {
            bufLast = args.pop();
        }

        let socket = this.rpcSc.sockets[id];
        if (!socket) {
            return undefined;
        }

        let rpcMsg: I_rpcMsg = {
            "cmd": cmd
        };

        let promise: Promise<any> = undefined as any;
        if (!notify) {
            let cb: Function = null as any;
            promise = new Promise((resolve) => {
                cb = resolve;
            });
            let id = this.getRpcId();
            this.rpcRequest[id] = { "cb": cb, "time": this.outTime, "await": true };
            rpcMsg.id = id;
        }
        socket.send(this.getRpcMsg(rpcMsg, Buffer.from(JSON.stringify(args)), bufLast, Rpc_Msg.rpcMsgAwait));
        return promise;

    }

    private sendTAwait(serverType: string, cmd: string, args: any[]): Promise<any> | undefined {
        let bufLast: Buffer = null as any;
        if (args[args.length - 1] instanceof Buffer) {
            bufLast = args.pop();
        }
        let msgBuf = Buffer.from(JSON.stringify(args));

        let bufEnd = this.getRpcMsg({ "cmd": cmd }, msgBuf, bufLast, Rpc_Msg.rpcMsgAwait);
        let sockets = this.rpcSc.sockets;
        for (let id in sockets) {
            if (sockets[id].baseConfig.serverType === serverType) {
                sockets[id].send(bufEnd);
            }
        }
        return undefined;
    }


    /**
     *  发送rpc消息
     * 
     *    [4]       [1]         [1]      [...]    [...]      [...]
     *  allMsgLen  消息类型   rpcBufLen   rpcBuf   msgBuf   bufLast
     */
    private getRpcMsg(rpcMsg: I_rpcMsg, msgBuf: Buffer, bufLast: Buffer, t: Rpc_Msg) {
        let buffLastLen = 0;
        if (bufLast) {
            buffLastLen = bufLast.length;
            rpcMsg.len = buffLastLen;
        }
        let rpcBuf = Buffer.from(JSON.stringify(rpcMsg));
        let buffEnd = Buffer.allocUnsafe(6 + rpcBuf.length + msgBuf.length + buffLastLen);
        buffEnd.writeUInt32BE(buffEnd.length - 4, 0);
        buffEnd.writeUInt8(t, 4);
        buffEnd.writeUInt8(rpcBuf.length, 5);
        rpcBuf.copy(buffEnd, 6);
        msgBuf.copy(buffEnd, 6 + rpcBuf.length);
        if (bufLast) {
            bufLast.copy(buffEnd, buffEnd.length - buffLastLen);
        }
        return buffEnd;
    }



    private getRpcId() {
        let id = this.rpcId++;
        if (this.rpcId > 9999999) {
            this.rpcId = 1;
        }
        return id;
    }

    private checkTimeout() {
        let now = Date.now();
        let rpcRequest = this.rpcRequest;
        for (let id in rpcRequest) {
            if (rpcRequest[id].time < now) {
                let one = rpcRequest[id];
                delete rpcRequest[id];
                one.await ? one.cb(undefined) : one.cb(rpcErr.timeout);
            }
        }
    }

    /**
     * 处理rpc消息
     * 
     *     [1]         [1]      [...]    [...]      [...]
     *   消息类型   rpcBufLen   rpcBuf   msgBuf   bufLast
     */
    public handleMsg(sid: string, bufAll: Buffer) {
        let rpcBufLen = bufAll.readUInt8(1);
        let rpcMsg: I_rpcMsg = JSON.parse(bufAll.slice(2, 2 + rpcBufLen).toString());
        let msg: any[];
        if (rpcMsg.len === undefined) {
            msg = JSON.parse(bufAll.slice(2 + rpcBufLen).toString());
        } else {
            msg = JSON.parse(bufAll.slice(2 + rpcBufLen, bufAll.length - rpcMsg.len).toString());
            msg.push(bufAll.slice(bufAll.length - rpcMsg.len));
        }

        if (!rpcMsg.cmd) {
            let timeout = this.rpcRequest[rpcMsg.id as number];
            if (timeout) {
                delete this.rpcRequest[rpcMsg.id as number];
                timeout.cb(...msg);
            }
        } else {
            let cmd = (rpcMsg.cmd as string).split('.');
            if (rpcMsg.id) {
                msg.push(this.getCallBackFunc(sid, rpcMsg.id));
            }
            this.rpcSc.msgHandler[cmd[0]][cmd[1]](...msg);
        }
    }

    private getCallBackFunc(id: string, rpcId: number) {
        let self = this;
        return function (...args: any[]) {
            let bufLast: Buffer = null as any;
            if (args[args.length - 1] instanceof Buffer) {
                bufLast = args.pop();
            }
            let socket = self.rpcSc.sockets[id];
            if (socket) {
                socket.send(self.getRpcMsg({ "id": rpcId }, Buffer.from(JSON.stringify(args)), bufLast, Rpc_Msg.rpcMsg))
            }
        }
    }

    public handleMsgAwait(sid: string, bufAll: Buffer) {
        let rpcBufLen = bufAll.readUInt8(1);
        let rpcMsg: I_rpcMsg = JSON.parse(bufAll.slice(2, 2 + rpcBufLen).toString());
        let msg: any;
        if (rpcMsg.len === undefined) {
            msg = JSON.parse(bufAll.slice(2 + rpcBufLen).toString());
        } else if (2 + rpcBufLen + rpcMsg.len === bufAll.length) {
            msg = bufAll.slice(bufAll.length - rpcMsg.len);
        } else {
            msg = JSON.parse(bufAll.slice(2 + rpcBufLen, bufAll.length - rpcMsg.len).toString());
            msg.push(bufAll.slice(bufAll.length - rpcMsg.len));
        }

        if (!rpcMsg.cmd) {
            let timeout = this.rpcRequest[rpcMsg.id as number];
            if (timeout) {
                delete this.rpcRequest[rpcMsg.id as number];
                timeout.cb(msg);
            }
        } else {
            let cmd = (rpcMsg.cmd as string).split('.');
            let res = this.rpcSc.msgHandler[cmd[0]][cmd[1]](...msg);
            if (!rpcMsg.id) {
                return;
            }
            let self = this;
            if (res && typeof res.then === "function") {
                res.then((data: any) => {
                    cbFunc(data);
                });
            } else {
                cbFunc(res);
            }

            function cbFunc(data: any) {
                let socket = self.rpcSc.sockets[sid];
                if (!socket) {
                    return;
                }
                if (data === undefined) {
                    data = null;
                }
                if (data instanceof Buffer) {
                    socket.send(self.getRpcMsg({ "id": rpcMsg.id }, Buffer.allocUnsafe(0), data, Rpc_Msg.rpcMsgAwait));
                } else if (data instanceof Array && data[data.length - 1] instanceof Buffer) {
                    let tmpRes = [...data];
                    let buf: Buffer = tmpRes.pop();
                    socket.send(self.getRpcMsg({ "id": rpcMsg.id }, Buffer.from(JSON.stringify(tmpRes)), buf, Rpc_Msg.rpcMsgAwait));
                } else {
                    socket.send(self.getRpcMsg({ "id": rpcMsg.id }, Buffer.from(JSON.stringify(data)), null as any, Rpc_Msg.rpcMsgAwait));
                }
            }

        }
    }

}
