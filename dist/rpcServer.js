"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcServer = void 0;
const rpcService_1 = require("./util/rpcService");
const tcpServer_1 = __importDefault(require("./util/tcpServer"));
const util_1 = require("./util/util");
class RpcServer {
    constructor(config, msgHandler) {
        this.sockets = {};
        this.rpc = null;
        this.config = config;
        this.msgHandler = msgHandler;
        this.rpcService = new rpcService_1.RpcService(config.timeout || 0, this);
        tcpServer_1.default(config.port, () => {
            console.info(`rpcUtil_server --> [${this.config.id}] listening at [${config.port}]`);
        }, (socket) => {
            new RpcServerSocket(this, socket);
        });
    }
    delOne(id) {
        let one = this.sockets[id];
        if (one) {
            one.close();
        }
    }
}
exports.RpcServer = RpcServer;
class RpcServerSocket {
    constructor(rpcServer, socket) {
        this.id = "";
        this.die = false;
        this.registerTimer = null;
        this.heartbeatTimer = null;
        this.rpcServer = rpcServer;
        this.socket = socket;
        socket.once("data", this.onRegisterData.bind(this));
        socket.on("close", this.onClose.bind(this));
        this.registerTimer = setTimeout(() => {
            console.warn(`rpcUtil_server --> [${this.rpcServer.config.id}] register timeout, close the socket: ${socket.remoteAddress}`);
            socket.close();
        }, 5000);
    }
    // 首条消息是注册
    onRegisterData(data) {
        try {
            let type = data.readUInt8(0);
            if (type === 1 /* register */) {
                this.registerHandle(data);
            }
            else {
                console.warn(`rpcUtil_server --> [${this.rpcServer.config.id}] illegal rpc register, close the socket: ${this.socket.remoteAddress}`);
                this.socket.close();
            }
        }
        catch (e) {
            this.socket.close();
            console.error(`[${this.rpcServer.config.id}]`, e.stack);
        }
    }
    /**
     * socket收到数据了
     * @param data
     */
    onData(data) {
        try {
            let type = data.readUInt8(0);
            if (type === 3 /* rpcMsg */) {
                this.rpcServer.rpcService.handleMsg(this.id, data);
            }
            else if (type === 2 /* heartbeat */) {
                this.heartbeatHandle();
                this.heartbeatResponse();
            }
            else {
                console.error(`rpcUtil_server --> [${this.rpcServer.config.id}] illegal data type, close rpc client named: ${this.id}`);
                this.socket.close();
            }
        }
        catch (e) {
            console.error(`[${this.rpcServer.config.id}]`, e.stack);
        }
    }
    /**
     * socket连接关闭了
     */
    onClose() {
        clearTimeout(this.registerTimer);
        clearTimeout(this.heartbeatTimer);
        if (!this.registerTimer) {
            delete this.rpcServer.sockets[this.id];
        }
        if (!this.die) {
            console.warn(`rpcUtil_server --> [${this.rpcServer.config.id}] a rpc client disconnected: ${this.id}, ${this.socket.remoteAddress}`);
        }
    }
    /**
     * 注册
     */
    registerHandle(msg) {
        clearTimeout(this.registerTimer);
        let data;
        try {
            data = JSON.parse(msg.slice(1).toString());
        }
        catch (err) {
            console.warn(`rpcUtil_server --> [${this.rpcServer.config.id}] JSON parse error，close the rpc socket: ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        let token = this.rpcServer.config.token || util_1.some_config.token;
        if (!data.id || data.token !== token) {
            console.warn(`rpcUtil_server --> [${this.rpcServer.config.id}] illegal token, close the rpc socket: ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        if (this.rpcServer.sockets[data.id]) {
            console.warn(`rpcUtil_server --> [${this.rpcServer.config.id}] already has a rpc client named: ${data.id}, close it, ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        this.socket.maxLen = this.rpcServer.config.maxLen || util_1.some_config.SocketBufferMaxLen;
        this.socket.on("data", this.onData.bind(this));
        this.id = data.id;
        this.rpcServer.sockets[this.id] = this;
        this.registerTimer = null;
        console.info(`rpcUtil_server --> [${this.rpcServer.config.id}] get new rpc client named: ${this.id}`);
        // 注册成功，回应
        let buffer = Buffer.allocUnsafe(5);
        buffer.writeUInt32BE(1, 0);
        buffer.writeUInt8(1 /* register */, 4);
        this.socket.send(buffer);
        this.heartbeatHandle();
    }
    /**
     * 心跳
     */
    heartbeatHandle() {
        clearTimeout(this.heartbeatTimer);
        let heartbeat = this.rpcServer.config.heartbeat || util_1.some_config.Time.Rpc_Heart_Beat_Time;
        if (heartbeat < 5) {
            heartbeat = 5;
        }
        this.heartbeatTimer = setTimeout(() => {
            console.warn(`rpcUtil_server --> [${this.rpcServer.config.id}] heartbeat timeout, close it: ${this.id}`);
            this.socket.close();
        }, heartbeat * 1000 * 2);
    }
    /**
     * 心跳回应
     */
    heartbeatResponse() {
        let buffer = Buffer.allocUnsafe(5);
        buffer.writeUInt32BE(1, 0);
        buffer.writeUInt8(2 /* heartbeat */, 4);
        this.socket.send(buffer);
    }
    send(data) {
        this.socket.send(data);
    }
    close() {
        this.die = true;
        let buffer = Buffer.allocUnsafe(5);
        buffer.writeUInt32BE(1, 0);
        buffer.writeUInt8(4 /* closeClient */, 4);
        this.socket.send(buffer);
        this.socket.close();
        console.info(`rpcUtil_server --> [${this.rpcServer.config.id}] rpc socket be closed ok [${this.id}]`);
    }
}
