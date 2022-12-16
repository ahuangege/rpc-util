import { I_serverInfo, RpcUtil } from "./rpcUtil";
import tcpServer from "./util/tcpServer";
import { SocketProxy, Rpc_Msg, some_config } from "./util/util";


export class RpcServer {
    private rpcUtil: RpcUtil;
    token: string;
    constructor(rpcUtil: RpcUtil, port: number, token?: string) {
        this.rpcUtil = rpcUtil;
        this.token = token || some_config.token;

        let noDelay = rpcUtil.options.noDelay === false ? false : true;

        tcpServer(port, noDelay,
            () => {
                this.rpcUtil.logger.info(`[rpc-util ${this.rpcUtil.serverInfo.id}] listening at ${port}`);
            },
            (socket: SocketProxy) => {
                new RpcServerSocket(this.rpcUtil, this, socket);
            });
    }
}


class RpcServerSocket {
    private rpcUtil: RpcUtil;
    private rpcServer: RpcServer;
    private serverInfo: I_serverInfo = {} as any;

    private socket: SocketProxy;
    private die = false;

    private sendCache: boolean = false;
    private sendArr: Buffer[] = [];
    private sendTimer: NodeJS.Timer = null as any;
    private nowLen = 0;
    private maxLen = +Infinity;

    private registerTimer: NodeJS.Timeout = null as any;
    private heartbeatTimer: NodeJS.Timeout = null as any;

    constructor(rpcUtil: RpcUtil, rpcServer: RpcServer, socket: SocketProxy) {
        this.rpcUtil = rpcUtil;
        this.rpcServer = rpcServer;
        this.socket = socket;

        socket.once("data", this.onRegisterData.bind(this));
        socket.on("close", this.onClose.bind(this));
        this.registerTimer = setTimeout(() => {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] register timeout, close the socket: ${socket.remoteAddress}`);
            this.close(false, "register timeout");
        }, 5000);
    }

    // 首条消息是注册
    private onRegisterData(data: Buffer) {
        try {
            let type = data.readUInt8(0);
            if (type === Rpc_Msg.register) {
                this.registerHandle(data);
            } else {
                this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] illegal rpc register, close the socket: ${this.socket.remoteAddress}`);
                this.close(false, "illegal register");
            }
        } catch (e: any) {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] register error, close the socket: ${this.socket.remoteAddress}. ${e && e.stack}`);
            this.close(false, "register error");
        }
    }

    /**
     * socket收到数据了
     * @param data
     */
    private onData(data: Buffer) {
        try {
            let type = data.readUInt8(0);

            if (type === Rpc_Msg.rpcMsgAwait) {
                this.rpcUtil.rpcService.handleMsgAwait(this.serverInfo.id, data);
            }
            else if (type === Rpc_Msg.rpcMsg) {
                this.rpcUtil.rpcService.handleMsg(this.serverInfo.id, data);
            }
            else if (type === Rpc_Msg.heartbeat) {
                this.heartbeatHandle();
                this.heartbeatResponse();
            }
            else {
                this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] illegal data type, close rpc client named: ${this.serverInfo.id}`);
                this.close(false, "illegal data type");
            }
        } catch (e: any) {
            this.rpcUtil.logger.error(e);
        }
    }

    /**
     * socket连接关闭了
     */
    private onClose() {
        clearTimeout(this.registerTimer);
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null as any;
        clearInterval(this.sendTimer);
        if (this.serverInfo.id && this.rpcUtil.getServerById(this.serverInfo.id)) {
            this.rpcUtil.removeServer(this.serverInfo);
            this.rpcUtil.rpcPool.removeSocket(this.serverInfo.id);
            this.rpcUtil.emit("onDel", this.serverInfo);
        }
        if (!this.die) {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}]  a rpc client disconnected: ${this.serverInfo.id}, ${this.socket.remoteAddress}`);
        }
    }

    /**
     * 注册
     */
    private registerHandle(msg: Buffer) {
        clearTimeout(this.registerTimer);
        this.registerTimer = null as any;

        let data: { "serverInfo": I_serverInfo, "token": string };
        try {
            data = JSON.parse(msg.subarray(1).toString());
        } catch (err) {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] JSON parse error，close the rpc socket: ${this.socket.remoteAddress}`);
            this.close(false, "register JSON parse error");
            return;
        }

        if (!data || !data.serverInfo || !data.serverInfo.id || !data.serverInfo.serverType || data.token !== this.rpcServer.token) {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] illegal token, close the rpc socket: ${this.socket.remoteAddress}`);
            this.close(false, "illegal token");
            return;
        }
        if (this.rpcUtil.getServerById(data.serverInfo.id)) {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] already has a rpc client named: ${data.serverInfo.id}, close it, ${this.socket.remoteAddress}`);
            this.close(false, "already has a same name rpc client");
            return;
        }

        let options = this.rpcUtil.options;
        this.socket.maxLen = options.maxLen || some_config.SocketBufferMaxLen;
        this.socket.on("data", this.onData.bind(this));

        this.serverInfo = data.serverInfo;

        let interval = 0;
        if (options.interval) {
            if (typeof options.interval === "number") {
                interval = options.interval;
            } else {
                interval = options.interval[data.serverInfo.serverType] || options.interval.default || 0;
            }
        }
        if (interval >= 10) {
            this.sendCache = true;
            this.sendTimer = setInterval(this.sendInterval.bind(this), interval);
            let tmpMaxLen = parseInt(options.intervalCacheLen as any) || 0;
            if (tmpMaxLen > 0) {
                this.maxLen = tmpMaxLen;
            }
        }

        this.rpcUtil.logger.debug(`[rpc-util ${this.rpcUtil.serverInfo.id}] get new rpc client named: ${this.serverInfo.id}`);

        // 注册成功，回应
        let heartbeat = options.heartbeat || some_config.Time.Rpc_Heart_Beat_Time;
        let registerBackBuf = Buffer.from(JSON.stringify({ "serverInfo": this.rpcUtil.serverInfo, "heartbeat": heartbeat }));
        let buf = Buffer.allocUnsafe(registerBackBuf.length + 5);
        buf.writeUInt32BE(registerBackBuf.length + 1, 0);
        buf.writeUInt8(Rpc_Msg.register, 4);
        registerBackBuf.copy(buf, 5);
        this.send(buf);
        this.heartbeatHandle();

        this.rpcUtil.addServer(this.serverInfo);
        this.rpcUtil.rpcPool.addSocket(this.serverInfo.id, this);
        this.rpcUtil.emit("onAdd", this.serverInfo);
    }

    /**
     * 心跳
     */
    private heartbeatHandle() {
        if (this.heartbeatTimer) {
            this.heartbeatTimer.refresh();
            return;
        }

        let heartbeat = this.rpcUtil.options.heartbeat || some_config.Time.Rpc_Heart_Beat_Time;

        this.heartbeatTimer = setTimeout(() => {
            this.rpcUtil.logger.error(`[rpc-util ${this.rpcUtil.serverInfo.id}] heartbeat timeout, close it: ${this.serverInfo.id}`);
            this.socket.close();
        }, heartbeat * 1000 * 2);
    }

    /**
     * 心跳回应
     */
    private heartbeatResponse() {
        let buffer = Buffer.allocUnsafe(5);
        buffer.writeUInt32BE(1, 0);
        buffer.writeUInt8(Rpc_Msg.heartbeat, 4);
        this.send(buffer);
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

        if (byUser && !reason) {
            reason = "closed by server user";
        }
        let reasonBuff = Buffer.from(reason.toString());
        let buffer = Buffer.allocUnsafe(5 + reasonBuff.length);
        buffer.writeUInt32BE(1 + reasonBuff.length, 0);
        buffer.writeUInt8(Rpc_Msg.closeClient, 4);
        reasonBuff.copy(buffer, 5);
        this.send(buffer);
        this.sendInterval();

        this.socket.close();
        if (byUser) {
            this.rpcUtil.logger.info(`[rpc-util ${this.rpcUtil.serverInfo.id}] rpc socket be closed ok :${this.serverInfo.id} reason: ${reason}`);
        }
    }
}