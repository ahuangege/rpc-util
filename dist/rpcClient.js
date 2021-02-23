"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcClientSocket = exports.RpcClient = void 0;
const rpcService_1 = require("./util/rpcService");
const tcpClient_1 = require("./util/tcpClient");
const util_1 = require("./util/util");
class RpcClient {
    constructor(config, msgHandler) {
        this.sockets = {};
        this.rpc = null;
        this.allSockets = {};
        this.config = config;
        this.msgHandler = msgHandler;
        this.rpcService = new rpcService_1.RpcService(config.timeout || 0, this);
        for (let one of config.serverList) {
            new RpcClientSocket(this, one);
        }
    }
    addOne(server) {
        new RpcClientSocket(this, server);
    }
    delOne(id) {
        let one = this.allSockets[id];
        if (one) {
            one.close(true);
        }
    }
}
exports.RpcClient = RpcClient;
class RpcClientSocket {
    constructor(rpcClient, server) {
        this.socket = null;
        this.die = false;
        this.heartbeatTimer = null;
        this.heartbeatTimeoutTimer = null;
        this.connectTimeout = null;
        this.rpcClient = rpcClient;
        this.id = server.id.toString();
        this.host = server.host;
        this.port = server.port;
        if (this.rpcClient.allSockets[this.id]) {
            console.error(`rpcUtil_client --> [${this.rpcClient.config.id}] already has rpc server named [${this.id}]`);
            return;
        }
        this.rpcClient.allSockets[this.id] = this;
        this.doConnect(0);
    }
    doConnect(delay) {
        if (this.die) {
            return;
        }
        let self = this;
        this.connectTimeout = setTimeout(() => {
            let connectCb = function () {
                // 注册
                let registerBuf = Buffer.from(JSON.stringify({
                    "id": self.rpcClient.config.id,
                    "token": self.rpcClient.config.token || util_1.some_config.token,
                }));
                let buf = Buffer.allocUnsafe(registerBuf.length + 5);
                buf.writeUInt32BE(registerBuf.length + 1, 0);
                buf.writeUInt8(1 /* register */, 4);
                registerBuf.copy(buf, 5);
                self.socket.send(buf);
            };
            this.connectTimeout = null;
            self.socket = new tcpClient_1.TcpClient(self.port, self.host, self.rpcClient.config.maxLen || util_1.some_config.SocketBufferMaxLen, connectCb);
            self.socket.on("data", self.onData.bind(self));
            self.socket.on("close", self.onClose.bind(self));
        }, delay);
    }
    onClose() {
        delete this.rpcClient.sockets[this.id];
        clearTimeout(this.heartbeatTimer);
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null;
        this.socket = null;
        if (!this.die) {
            console.warn(`rpcUtil_client --> [${this.rpcClient.config.id}] socket closed, reconnect the rpc server later: ${this.id}`);
            this.doConnect(util_1.some_config.Time.Rpc_Reconnect_Time * 1000);
        }
    }
    /**
     * 每隔一定时间发送心跳
     */
    heartbeatSend() {
        let self = this;
        let heartbeat = this.rpcClient.config.heartbeat || util_1.some_config.Time.Rpc_Heart_Beat_Time;
        let timeDelay = heartbeat * 1000 - 5000 + Math.floor(5000 * Math.random());
        if (timeDelay < 5000) {
            timeDelay = 5000;
        }
        this.heartbeatTimer = setTimeout(function () {
            let buf = Buffer.allocUnsafe(5);
            buf.writeUInt32BE(1, 0);
            buf.writeUInt8(2 /* heartbeat */, 4);
            self.socket.send(buf);
            self.heartbeatTimeoutStart();
            self.heartbeatSend();
        }, timeDelay);
    }
    /**
     * 发送心跳后，收到回应
     */
    heartbeatResponse() {
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null;
    }
    /**
     * 发送心跳后，一定时间内必须收到回应，否则断开连接
     */
    heartbeatTimeoutStart() {
        if (this.heartbeatTimeoutTimer !== null) {
            return;
        }
        this.heartbeatTimeoutTimer = setTimeout(() => {
            this.socket.close();
            console.warn(`rpcUtil_client --> [${this.rpcClient.config.id}] heartbeat timeout, close the socket: ${this.id}`);
        }, util_1.some_config.Time.Rpc_Heart_Beat_Timeout_Time * 1000);
    }
    onData(data) {
        try {
            let type = data.readUInt8(0);
            if (type === 3 /* rpcMsg */) {
                this.rpcClient.rpcService.handleMsg(this.id, data);
            }
            else if (type === 1 /* register */) {
                this.registerHandle();
            }
            else if (type === 2 /* heartbeat */) {
                this.heartbeatResponse();
            }
            else if (type === 4 /* closeClient */) {
                this.close(false);
            }
        }
        catch (e) {
            console.error(`[${this.rpcClient.config.id}]`, e.stack);
        }
    }
    /**
     * 注册成功
     */
    registerHandle() {
        this.heartbeatSend();
        this.rpcClient.sockets[this.id] = this;
        console.info(`rpcUtil_client --> [${this.rpcClient.config.id}] connect rpc server ok [${this.id}]`);
    }
    send(data) {
        this.socket.send(data);
    }
    close(byUser) {
        if (this.die) {
            return;
        }
        this.die = true;
        delete this.rpcClient.allSockets[this.id];
        if (this.socket) {
            this.socket.close();
        }
        clearTimeout(this.connectTimeout);
        if (byUser) {
            console.info(`rpcUtil_client --> [${this.rpcClient.config.id}] rpc socket be closed ok [${this.id}]`);
        }
        else {
            console.info(`rpcUtil_client --> [${this.rpcClient.config.id}] rpc socket be closed by rpc server ok [${this.id}]`);
        }
    }
}
exports.RpcClientSocket = RpcClientSocket;
