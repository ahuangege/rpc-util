import { TcpClient } from "./util/tcpClient";
import { Rpc_Msg, SocketProxy, some_config } from "./util/util";
import { RpcUtil, I_serverInfo } from "./rpcUtil"


export class RpcClientSocket {
    private rpcUtil: RpcUtil;
    private info: { host: string, port: number, token?: string };
    private serverInfo: I_serverInfo = {} as any;

    private socket: SocketProxy = null as any;
    private die = false;

    private sendCache: boolean = false;
    private sendArr: Buffer[] = [];
    private sendTimer: NodeJS.Timer = null as any;
    private nowLen = 0;
    private maxLen = +Infinity;

    private heartbeatTimer: NodeJS.Timer = null as any;
    private heartbeatTimeoutTimer: NodeJS.Timer = null as any;
    private connectTimeout: NodeJS.Timeout = null as any;
    private heartbeat: number = 0;

    constructor(rpcUtil: RpcUtil, info: { host: string, port: number, token?: string }) {
        this.rpcUtil = rpcUtil;
        this.info = info;

        this.doConnect(0);
    }

    private doConnect(delay: number) {
        if (this.die) {
            return;
        }
        let self = this;
        this.connectTimeout = setTimeout(() => {
            let connectCb = function () {
                // 注册
                let registerBuf = Buffer.from(JSON.stringify({
                    "serverInfo": self.rpcUtil.serverInfo,
                    "token": self.info.token || some_config.token,
                }));
                let buf = Buffer.allocUnsafe(registerBuf.length + 5);
                buf.writeUInt32BE(registerBuf.length + 1, 0);
                buf.writeUInt8(Rpc_Msg.register, 4);
                registerBuf.copy(buf, 5);
                self.socket.send(buf);
            };
            this.connectTimeout = null as any;
            let noDelay = self.rpcUtil.options.noDelay === false ? false : true;
            let maxMsgLen = self.rpcUtil.options.maxLen || some_config.SocketBufferMaxLen;
            self.socket = new TcpClient(self.info.port, self.info.host, maxMsgLen, noDelay, connectCb);
            self.socket.on("data", self.onData.bind(self));
            self.socket.on("close", self.onClose.bind(self));
        }, delay);
    }


    private onClose() {
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null as any;
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null as any;
        clearInterval(this.sendTimer);
        this.socket = null as any;
        this.sendArr = [];
        this.nowLen = 0;

        if (!this.die) {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] socket closed, reconnect the rpc server later:${this.serverInfo.id} - ${this.info.host}:${this.info.port}`);
            let delay = (this.rpcUtil.options.reconnectDelay || some_config.Time.Rpc_Reconnect_Time) * 1000;
            this.doConnect(delay);
        }
        if (this.serverInfo.id && this.rpcUtil.getServerById(this.serverInfo.id)) {
            this.rpcUtil.removeServer(this.serverInfo);
            this.rpcUtil.rpcPool.removeSocket(this.serverInfo.id);
            this.rpcUtil.emit("onDel", this.serverInfo);
        }
        this.serverInfo = {} as any;
    }

    /**
     * 每隔一定时间发送心跳
     */
    private heartbeatSend() {
        if (this.heartbeatTimer) {
            this.heartbeatTimer.refresh();
            return;
        }

        this.heartbeatTimer = setTimeout(() => {
            let buf = Buffer.allocUnsafe(5);
            buf.writeUInt32BE(1, 0);
            buf.writeUInt8(Rpc_Msg.heartbeat, 4);
            this.send(buf);
            this.heartbeatTimeoutStart();
            this.heartbeatSend();
        }, this.heartbeat);
    }

    /**
     * 发送心跳后，收到回应
     */
    private heartbeatResponse() {
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null as any;
    }

    /**
     * 发送心跳后，一定时间内必须收到回应，否则断开连接
     */
    private heartbeatTimeoutStart() {
        if (this.heartbeatTimeoutTimer !== null) {
            return;
        }
        this.heartbeatTimeoutTimer = setTimeout(() => {
            this.socket.close();
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] heartbeat timeout, close the socket: ${this.serverInfo.id}`);
        }, some_config.Time.Rpc_Heart_Beat_Timeout_Time * 1000);

    }

    private onData(data: Buffer) {
        try {
            let type = data.readUInt8(0);
            if (type === Rpc_Msg.rpcMsgAwait) {
                this.rpcUtil.rpcService.handleMsgAwait(this.serverInfo.id, data);
            }
            else if (type === Rpc_Msg.rpcMsg) {
                this.rpcUtil.rpcService.handleMsg(this.serverInfo.id, data);
            }
            else if (type === Rpc_Msg.register) {
                this.registerHandle(data);
            }
            else if (type === Rpc_Msg.heartbeat) {
                this.heartbeatResponse();
            } else if (type === Rpc_Msg.closeClient) {
                this.close(false, data.subarray(1).toString());
            }
        } catch (e: any) {
            this.rpcUtil.logger.error(e);
        }
    }

    /**
     * 注册成功
     */
    private registerHandle(buf: Buffer) {
        let data: { "serverInfo": I_serverInfo, "heartbeat": number } = JSON.parse(buf.subarray(1).toString());

        if (this.rpcUtil.getServerById(data.serverInfo.id)) {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] already has a rpc socket named: ${data.serverInfo.id}, close it, ${this.socket.remoteAddress}`);
            this.close(false, "me self already has a same name rpc socket");
            return;
        }

        this.serverInfo = data.serverInfo;
        this.heartbeat = data.heartbeat;
        this.heartbeatSend();

        let options = this.rpcUtil.options;
        let interval = 0;
        if (options.interval) {
            if (typeof options.interval === "number") {
                interval = options.interval;
            } else {
                interval = options.interval[this.serverInfo.serverType] || options.interval.default || 0;
            }
        }

        if (interval >= 10) {
            this.sendCache = true;
            this.sendTimer = setInterval(this.sendInterval.bind(this), interval) as any;
            let tmpMaxLen = parseInt(options.intervalCacheLen as any) || 0;
            if (tmpMaxLen > 0) {
                this.maxLen = tmpMaxLen;
            }
        }

        this.rpcUtil.logger.debug(`[rpc-util ${this.rpcUtil.serverInfo.id}] connect rpc server ok [${this.serverInfo.id}]`);

        this.rpcUtil.addServer(this.serverInfo);
        this.rpcUtil.rpcPool.addSocket(this.serverInfo.id, this);
        this.rpcUtil.emit("onAdd", this.serverInfo);
    }



    send(data: Buffer) {
        if (this.sendCache) {
            this.sendArr.push(data);
            this.nowLen += data.length;
            if (this.nowLen > this.maxLen) {
                this.sendInterval();
            }
        } else {
            this.socket.send(data);
        }
    }

    private sendInterval() {
        if (this.sendArr.length > 0) {
            this.socket.send(Buffer.concat(this.sendArr));
            this.sendArr.length = 0;
            this.nowLen = 0;
        }
    }


    close(byUser: boolean, reason: string) {
        if (this.die) {
            return;
        }
        this.die = true;

        let serverInfo = this.serverInfo;

        this.sendInterval();
        if (this.socket) {
            this.socket.close();
        }
        clearTimeout(this.connectTimeout);

        if (byUser && !reason) {
            reason = "closed by client user self";
        }

        if (byUser) {
            this.rpcUtil.logger.info(`[rpc-util ${this.rpcUtil.serverInfo.id}] rpc socket be closed ok : ${serverInfo.id}, reason: ${reason}`);
        } else {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] rpc socket be closed by rpc server : ${serverInfo.id}, reason: ${reason}`);
        }
    }
}