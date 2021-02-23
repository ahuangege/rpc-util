"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcService = void 0;
/**
 * rpc代理
 */
class RpcService {
    constructor(timeout, rpcSc) {
        this.rpcId = 1; // 必须从1开始，不可为0
        this.rpcRequest = {};
        this.rpcTimeMax = 10 * 1000; //超时时间
        this.outTime = 0; // 当前时刻 + 超时时间
        if (timeout >= 5) {
            this.rpcTimeMax = timeout * 1000;
        }
        this.outTime = Date.now() + this.rpcTimeMax;
        setInterval(() => {
            this.outTime = Date.now() + this.rpcTimeMax;
        }, 100);
        setInterval(this.checkTimeout.bind(this), 3000);
        this.rpcSc = rpcSc;
        this.rpcSc.rpc = this.rpcFunc.bind(this);
    }
    rpcFunc(id, cmd) {
        let self = this;
        let func = function (...args) {
            if (id === "*") {
                self.proxyCbAll(cmd, args);
            }
            else {
                self.proxyCb(id, cmd, args);
            }
        };
        return func;
    }
    proxyCb(id, cmd, args) {
        let cb = null;
        if (typeof args[args.length - 1] === "function") {
            cb = args.pop();
        }
        let bufLast = null;
        if (args[args.length - 1] instanceof Buffer) {
            bufLast = args.pop();
        }
        let socket = this.rpcSc.sockets[id];
        if (!socket) {
            if (cb) {
                process.nextTick(() => {
                    cb(1 /* noServer */);
                });
            }
            return;
        }
        let rpcMsg = {
            "cmd": cmd
        };
        if (cb) {
            let id = this.getRpcId();
            this.rpcRequest[id] = { "cb": cb, "time": this.outTime };
            rpcMsg.id = id;
        }
        this.sendRpcMsg(socket, rpcMsg, Buffer.from(JSON.stringify(args)), bufLast);
    }
    proxyCbAll(cmd, args) {
        let cb = null;
        if (typeof args[args.length - 1] === "function") {
            cb = args.pop();
        }
        let bufLast = null;
        if (args[args.length - 1] instanceof Buffer) {
            bufLast = args.pop();
        }
        let msgBuf = Buffer.from(JSON.stringify(args));
        let self = this;
        let sockets = this.rpcSc.sockets;
        let nums = 0;
        let msgObj = null;
        let bindCb = null;
        if (cb) {
            msgObj = {};
            bindCb = function (id) {
                return function (...msg) {
                    nums--;
                    msgObj[id] = msg;
                    if (nums === 0) {
                        cb(msgObj);
                    }
                };
            };
        }
        for (let x in sockets) {
            nums++;
            if (cb) {
                send(sockets[x], bindCb(x));
            }
            else {
                send(sockets[x]);
            }
        }
        if (nums === 0) {
            if (cb) {
                process.nextTick(() => {
                    cb({});
                });
            }
        }
        function send(socket, callback) {
            let rpcMsg = {
                "cmd": cmd
            };
            if (callback) {
                let id = self.getRpcId();
                self.rpcRequest[id] = { "cb": callback, "time": self.outTime };
                rpcMsg.id = id;
            }
            self.sendRpcMsg(socket, rpcMsg, msgBuf, bufLast);
        }
    }
    /**
     *  发送rpc消息
     *
     *    [4]       [1]         [1]      [...]    [...]      [...]
     *  allMsgLen  消息类型   rpcBufLen   rpcBuf   msgBuf   bufLast
     */
    sendRpcMsg(socket, rpcMsg, msgBuf, bufLast) {
        let buffLastLen = 0;
        if (bufLast) {
            buffLastLen = bufLast.length;
            rpcMsg.len = buffLastLen;
        }
        let rpcBuf = Buffer.from(JSON.stringify(rpcMsg));
        let buffEnd = Buffer.allocUnsafe(6 + rpcBuf.length + msgBuf.length + buffLastLen);
        buffEnd.writeUInt32BE(buffEnd.length - 4, 0);
        buffEnd.writeUInt8(3 /* rpcMsg */, 4);
        buffEnd.writeUInt8(rpcBuf.length, 5);
        rpcBuf.copy(buffEnd, 6);
        msgBuf.copy(buffEnd, 6 + rpcBuf.length);
        if (bufLast) {
            bufLast.copy(buffEnd, buffEnd.length - buffLastLen);
        }
        socket.send(buffEnd);
    }
    getRpcId() {
        let id = this.rpcId++;
        if (this.rpcId > 999999) {
            this.rpcId = 1;
        }
        return id;
    }
    checkTimeout() {
        let now = Date.now();
        let rpcRequest = this.rpcRequest;
        for (let id in rpcRequest) {
            if (rpcRequest[id].time < now) {
                let cb = rpcRequest[id].cb;
                delete rpcRequest[id];
                this.timeoutCb(cb);
            }
        }
    }
    timeoutCb(cb) {
        try {
            cb(2 /* timeout */);
        }
        catch (e) {
            console.error(e.stack);
        }
    }
    /**
     * 处理rpc消息
     *
     *     [1]         [1]      [...]    [...]      [...]
     *   消息类型   rpcBufLen   rpcBuf   msgBuf   bufLast
     */
    handleMsg(id, bufAll) {
        let rpcBufLen = bufAll.readUInt8(1);
        let rpcMsg = JSON.parse(bufAll.slice(2, 2 + rpcBufLen).toString());
        let msg;
        if (rpcMsg.len === undefined) {
            msg = JSON.parse(bufAll.slice(2 + rpcBufLen).toString());
        }
        else {
            msg = JSON.parse(bufAll.slice(2 + rpcBufLen, bufAll.length - rpcMsg.len).toString());
            msg.push(bufAll.slice(bufAll.length - rpcMsg.len));
        }
        if (!rpcMsg.cmd) {
            let timeout = this.rpcRequest[rpcMsg.id];
            if (timeout) {
                delete this.rpcRequest[rpcMsg.id];
                timeout.cb.apply(null, msg);
            }
        }
        else {
            let cmd = rpcMsg.cmd.split('.');
            if (rpcMsg.id) {
                msg.push(this.getCallBackFunc(id, rpcMsg.id));
            }
            this.rpcSc.msgHandler[cmd[0]][cmd[1]](...msg);
        }
    }
    getCallBackFunc(id, rpcId) {
        let self = this;
        return function (...args) {
            let bufLast = null;
            if (args[args.length - 1] instanceof Buffer) {
                bufLast = args.pop();
            }
            let socket = self.rpcSc.sockets[id];
            if (socket) {
                self.sendRpcMsg(socket, { "id": rpcId }, Buffer.from(JSON.stringify(args)), bufLast);
            }
        };
    }
}
exports.RpcService = RpcService;
