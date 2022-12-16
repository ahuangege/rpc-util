
import { RpcUtil } from "../rpcUtil";
import { I_rpcMsg, I_rpcTimeout, Rpc_Msg } from "./util";



/**
 * rpc代理
 */
export class RpcService {
    private rpcUtil: RpcUtil;

    private rpcId = 1;  // 必须从1开始，不可为0
    private rpcRequest: { [id: number]: I_rpcTimeout } = {};
    private rpcTimeMax: number = 10 * 1000; //超时时间
    private outTime = 0;    // 当前时刻 + 超时时间

    private toId: string = "";
    private notify: boolean = false;
    private rpcObj: RpcUtil = null as any;
    private msgQueueDic: { [serverId: string]: { "rpcTimeout": I_rpcTimeout | null, "buf": Buffer, "time": number }[] } = {};
    private msgCacheCount = 5000;


    constructor(rpcUtil: RpcUtil) {

        let options = rpcUtil.options;
        let rpcMsgCacheCount = parseInt(options.rpcMsgCacheCount as any);
        if (rpcMsgCacheCount >= 0) {
            this.msgCacheCount = rpcMsgCacheCount;
        }

        let timeout = Number(options.timeout) || 0;
        if (timeout >= 5) {
            this.rpcTimeMax = timeout * 1000;
        }

        this.outTime = Date.now() + this.rpcTimeMax;
        setInterval(() => {
            this.outTime = Date.now() + this.rpcTimeMax;
        }, 100);
        setInterval(this.checkTimeout.bind(this), 2000);

        this.rpcUtil = rpcUtil;
        this.rpcUtil.rpc = this.rpcFunc.bind(this);

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
                                            func = self.rpcFuncProxy({ "serverT": serverType, "f": file, "m": method });
                                            _methodDic[method] = func;
                                        }
                                        return func;
                                    }
                                });
                                _fileDic[file] = methodDic;
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

    rpcOnNewSocket(sid: string) {
        let queue = this.msgQueueDic[sid];
        if (!queue) {
            return;
        }
        delete this.msgQueueDic[sid];
        for (let one of queue) {
            this.sendTo(sid, one.rpcTimeout, one.buf);
        }
    }

    private rpcFunc(serverId: string, notify = false) {
        this.toId = serverId;
        this.notify = notify;
        return this.rpcObj;
    }
    private rpcFuncProxy(cmd: { serverT: string, f: string, m: string }) {
        let self = this;
        let func = function (...args: any[]) {
            return self.send(self.toId, self.notify, cmd, args);
        }
        return func;
    }

    private send(sid: string, notify: boolean, cmd: { "serverT": string, "f": string, "m": string }, args: any[]): Promise<any> | undefined {
        if (sid === "*") {
            this.sendT(cmd, args);
            return;
        }

        if (typeof args[args.length - 1] === "function") {
            this.sendCb(sid, cmd, args);
            return;
        }

        return this.sendAwait(sid, notify, cmd, args);
    }

    /** 发送给某一类型的服务器 */
    private sendT(cmd: { "serverT": string, "f": string, "m": string }, args: any[]) {
        let msgBuf = Buffer.from(JSON.stringify(args));
        let bufEnd = this.getRpcMsg({ "f": cmd.f, "m": cmd.m }, msgBuf, Rpc_Msg.rpcMsg);
        let servers = this.rpcUtil.getServersByType(cmd.serverT);
        for (let one of servers) {
            if (one.id === this.rpcUtil.serverInfo.id) {
                this.sendRpcMsgToSelf(cmd, msgBuf);
            } else {
                this.sendTo(one.id, null, bufEnd);
            }
        }
    }

    /** 回调形式，发送给某一服务器 */
    private sendCb(sid: string, cmd: { "serverT": string, "f": string, "m": string }, args: any[]) {
        let cb: Function = args.pop();
        if (sid === this.rpcUtil.serverInfo.id) {
            this.sendRpcMsgToSelf(cmd, Buffer.from(JSON.stringify(args)), cb);
            return;
        }

        let rpcTimeout: I_rpcTimeout = { "id": this.getRpcId(), "cb": cb, "time": this.outTime, "await": false };
        let rpcMsg: I_rpcMsg = {
            "f": cmd.f,
            "m": cmd.m,
            "id": rpcTimeout.id
        };
        let bufEnd = this.getRpcMsg(rpcMsg, Buffer.from(JSON.stringify(args)), Rpc_Msg.rpcMsg);
        this.sendTo(sid, rpcTimeout, bufEnd);
    }

    /** await 形式，发送给某一服务器 */
    private sendAwait(sid: string, notify: boolean, cmd: { "serverT": string, "f": string, "m": string }, args: any[]): Promise<any> | undefined {
        if (sid === this.rpcUtil.serverInfo.id) {
            return this.sendRpcMsgToSelfAwait(cmd, Buffer.from(JSON.stringify(args)), notify);
        }

        let rpcMsg: I_rpcMsg = {
            "f": cmd.f,
            "m": cmd.m
        };

        let promise: Promise<any> = undefined as any;
        let rpcTimeout: I_rpcTimeout = null as any;
        if (!notify) {
            let cb: Function = null as any;
            promise = new Promise((resolve) => {
                cb = resolve;
            });
            rpcTimeout = { "id": this.getRpcId(), "cb": cb, "time": this.outTime, "await": true };
            rpcMsg.id = rpcTimeout.id;
        }
        let bufEnd = this.getRpcMsg(rpcMsg, Buffer.from(JSON.stringify(args)), Rpc_Msg.rpcMsgAwait);
        this.sendTo(sid, rpcTimeout, bufEnd);
        return promise;
    }

    private sendRpcMsgToSelf(cmd: { "serverT": string, "f": string, "m": string }, msgBuf: Buffer, cb?: Function) {
        let args = JSON.parse(msgBuf.toString());
        if (cb) {
            let id = this.getRpcId();
            this.rpcRequest[id] = { "id": id, "cb": cb, "time": this.outTime, "await": false };
            args.push(this.getCallBackFuncSelf(id));
        }
        process.nextTick(() => {
            this.rpcUtil.msgHandler[cmd.f][cmd.m](...args);
        });
    }

    private getCallBackFuncSelf(id: number) {
        let self = this;
        return function (...args: any[]) {
            args = JSON.parse(JSON.stringify(args));
            process.nextTick(() => {
                let timeout = self.rpcRequest[id];
                if (timeout) {
                    delete self.rpcRequest[id];
                    timeout.cb(...args);
                }
            });

        }
    }

    private sendRpcMsgToSelfAwait(cmd: { "serverT": string, "f": string, "m": string }, msgBuf: Buffer, notify: boolean): Promise<any> | undefined {
        let args = JSON.parse(msgBuf.toString());
        if (notify) {
            process.nextTick(() => {
                this.rpcUtil.msgHandler[cmd.f][cmd.m](...args);
            });
            return;
        }

        let cb: Function = null as any;
        let promise = new Promise((resolve) => {
            cb = resolve;
        });

        let id = this.getRpcId();
        this.rpcRequest[id] = { "id": id, "cb": cb, "time": this.outTime, "await": true };

        process.nextTick(async () => {

            let data = await this.rpcUtil.msgHandler[cmd.f][cmd.m](...args);

            let timeout = this.rpcRequest[id];
            if (!timeout) {
                return;
            }
            delete this.rpcRequest[id];
            if (data === undefined) {
                data = null;
            }
            timeout.cb(JSON.parse(JSON.stringify(data)));
        });

        return promise;
    }



    private sendTo(sid: string, rpcTimeout: I_rpcTimeout | null, buf: Buffer) {
        let socket = this.rpcUtil.rpcPool.getSocket(sid);
        if (socket) {
            if (rpcTimeout) {
                this.rpcRequest[rpcTimeout.id] = rpcTimeout;
            }
            socket.send(buf);
            return;
        }
        let queue = this.msgQueueDic[sid];
        if (!queue) {
            queue = [];
            this.msgQueueDic[sid] = queue;
        }
        queue.push({ "rpcTimeout": rpcTimeout, "buf": buf, "time": this.outTime - 3000 });

        if (queue.length > this.msgCacheCount) {
            for (let one of queue.splice(0, 20)) {
                if (one.rpcTimeout) {
                    this.timeoutCall(one.rpcTimeout);
                }
            }
        }
    }


    /**
     *  发送rpc消息
     * 
     *    [4]       [1]         [1]      [...]    [...]   
     *  allMsgLen  消息类型   rpcBufLen   rpcBuf   msgBuf 
     */
    private getRpcMsg(rpcMsg: I_rpcMsg, msgBuf: Buffer, t: Rpc_Msg) {
        let rpcBuf = Buffer.from(JSON.stringify(rpcMsg));
        let buffEnd = Buffer.allocUnsafe(6 + rpcBuf.length + msgBuf.length);
        buffEnd.writeUInt32BE(buffEnd.length - 4, 0);
        buffEnd.writeUInt8(t, 4);
        buffEnd.writeUInt8(rpcBuf.length, 5);
        rpcBuf.copy(buffEnd, 6);
        msgBuf.copy(buffEnd, 6 + rpcBuf.length);
        return buffEnd;
    }



    private getRpcId() {
        let id = this.rpcId++;
        if (this.rpcId > 99999999) {
            this.rpcId = 1;
        }
        return id;
    }

    private checkTimeout() {
        let now = Date.now();

        for (let sid in this.msgQueueDic) {
            let queue = this.msgQueueDic[sid];
            let deleteCount = 0;
            for (let one of queue) {
                if (one.time < now) {
                    deleteCount++;
                } else {
                    break;
                }
            }
            if (deleteCount > 0) {
                for (let one of queue.splice(0, deleteCount)) {
                    if (one.rpcTimeout) {
                        this.timeoutCall(one.rpcTimeout);
                    }
                }
            }
        }

        let rpcRequest = this.rpcRequest;
        for (let id in rpcRequest) {
            if (rpcRequest[id].time < now) {
                let one = rpcRequest[id];
                delete rpcRequest[id];
                this.timeoutCall(one);
            }
        }
    }

    private timeoutCall(one: I_rpcTimeout) {
        process.nextTick(() => {
            one.await ? one.cb(undefined) : one.cb(true);
        });
    }

    /**
     * 处理rpc消息
     * 
     *     [1]         [1]      [...]    [...]  
     *   消息类型   rpcBufLen   rpcBuf   msgBuf
     */
    public handleMsg(sid: string, bufAll: Buffer) {
        let rpcBufLen = bufAll.readUInt8(1);
        let rpcMsg: I_rpcMsg = JSON.parse(bufAll.subarray(2, 2 + rpcBufLen).toString());
        let msg = JSON.parse(bufAll.subarray(2 + rpcBufLen).toString());

        if (!rpcMsg.f) {
            let timeout = this.rpcRequest[rpcMsg.id as number];
            if (timeout) {
                delete this.rpcRequest[rpcMsg.id as number];
                timeout.cb(...msg);
            }
        } else {
            if (rpcMsg.id) {
                msg.push(this.getCallBackFunc(sid, rpcMsg.id));
            }
            this.rpcUtil.msgHandler[rpcMsg.f][rpcMsg.m as any](...msg);
        }
    }

    private getCallBackFunc(sid: string, rpcId: number) {
        let self = this;
        return function (...args: any[]) {
            let bufEnd = self.getRpcMsg({ "id": rpcId }, Buffer.from(JSON.stringify(args)), Rpc_Msg.rpcMsg);
            self.sendTo(sid, null, bufEnd);
        }
    }

    public async handleMsgAwait(sid: string, bufAll: Buffer) {
        let rpcBufLen = bufAll.readUInt8(1);
        let rpcMsg: I_rpcMsg = JSON.parse(bufAll.subarray(2, 2 + rpcBufLen).toString());
        let msg = JSON.parse(bufAll.subarray(2 + rpcBufLen).toString());

        if (!rpcMsg.f) {
            let timeout = this.rpcRequest[rpcMsg.id as number];
            if (timeout) {
                delete this.rpcRequest[rpcMsg.id as number];
                timeout.cb(msg);
            }
        } else {
            let data = await this.rpcUtil.msgHandler[rpcMsg.f][rpcMsg.m as any](...msg);
            if (!rpcMsg.id) {
                return;
            }

            if (data === undefined) {
                data = null;
            }
            let bufEnd = this.getRpcMsg({ "id": rpcMsg.id }, Buffer.from(JSON.stringify(data)), Rpc_Msg.rpcMsgAwait);
            this.sendTo(sid, null, bufEnd);
        }
    }

}
