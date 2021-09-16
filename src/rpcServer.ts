import { getLogger } from "./rpcUtil";
import { I_rpc_sc, RpcService } from "./util/rpcService";
import tcpServer from "./util/tcpServer";
import { SocketProxy, Rpc_Msg, some_config } from "./util/util";
import { EventEmitter } from "events";

export interface I_baseConfig {
    "id": string,
    "serverType": string,
    [key: string]: any,
}

export interface I_RpcServerConfig {
    "baseConfig": I_baseConfig,
    "port": number,
    "token"?: string,
    "interval"?: number,
    "noDelay"?: boolean,
}

export class RpcServer extends EventEmitter implements I_rpc_sc {
    config: I_RpcServerConfig;
    sockets: { [id: string]: RpcServerSocket } = {};
    rpc: (id: string, serverType: string, file: string, method: string) => Function = null as any;
    rpcAwait: (id: string, serverType: string, file: string, method: string) => Function = null as any;
    msgHandler: { [file: string]: any };
    rpcService: RpcService;
    sendCache: boolean = false;
    sendInterval: number = 0;
    token: string;
    constructor(config: I_RpcServerConfig, msgHandler: { [file: string]: any }) {
        super();
        this.config = config;
        this.msgHandler = msgHandler;
        this.token = config.token || some_config.token
        if (config.interval && config.interval >= 10) {
            this.sendCache = true;
            this.sendInterval = config.interval;
        }
        this.rpcService = new RpcService(this);

        let noDelay = config.noDelay === false ? false : true;

        tcpServer(config.port, noDelay
            , () => {
                getLogger()("frame", "info", `rpcUtil_server --> [${config.baseConfig.id}] listening at [${config.port}]`);
            }
            , (socket: SocketProxy) => {
                new RpcServerSocket(this, socket);
            });
    }

    delOne(id: string) {
        let one = this.sockets[id];
        if (one) {
            one.close();
        }
    }

}


class RpcServerSocket {
    private rpcServer: RpcServer;

    baseConfig: I_baseConfig = null as any;
    private socket: SocketProxy;
    private die = false;

    private sendCache: boolean = false;
    private sendArr: Buffer[] = [];
    private sendTimer: NodeJS.Timer = null as any;

    private registerTimer: NodeJS.Timeout = null as any;
    private heartbeatTimer: NodeJS.Timeout = null as any;

    constructor(rpcServer: RpcServer, socket: SocketProxy) {
        this.rpcServer = rpcServer;
        this.socket = socket;
        socket.once("data", this.onRegisterData.bind(this));
        socket.on("close", this.onClose.bind(this));
        this.registerTimer = setTimeout(() => {
            getLogger()("frame", "warn", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] register timeout, close the socket: ${socket.remoteAddress}`);
            socket.close();
        }, 5000);
        this.sendCache = this.rpcServer.sendCache;
    }

    // 首条消息是注册
    private onRegisterData(data: Buffer) {
        try {
            let type = data.readUInt8(0);
            if (type === Rpc_Msg.register) {
                this.registerHandle(data);
            } else {
                getLogger()("frame", "warn", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] illegal rpc register, close the socket: ${this.socket.remoteAddress}`);
                this.socket.close();
            }
        } catch (e: any) {
            this.socket.close();
            getLogger()("frame", "error", `[${this.rpcServer.config.baseConfig.id}] ` + e.stack);
        }
    }

    /**
     * socket收到数据了
     * @param data
     */
    private onData(data: Buffer) {
        try {
            let type = data.readUInt8(0);
            if (type === Rpc_Msg.rpcMsg) {
                this.rpcServer.rpcService.handleMsg(this.baseConfig.id, data);
            }
            else if (type === Rpc_Msg.rpcMsgAwait) {
                this.rpcServer.rpcService.handleMsgAwait(this.baseConfig.id, data);
            }
            else if (type === Rpc_Msg.heartbeat) {
                this.heartbeatHandle();
                this.heartbeatResponse();
            }
            else {
                getLogger()("frame", "error", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] illegal data type, close rpc client named: ${this.baseConfig.id}`);
                this.socket.close();
            }
        } catch (e: any) {
            getLogger()("msg", "error", `[${this.rpcServer.config.baseConfig.id}] ` + e.stack);
        }
    }

    /**
     * socket连接关闭了
     */
    private onClose() {
        clearTimeout(this.registerTimer);
        clearTimeout(this.heartbeatTimer);
        clearInterval(this.sendTimer);
        if (this.baseConfig && this.rpcServer.sockets[this.baseConfig.id]) {
            delete this.rpcServer.sockets[this.baseConfig.id];
            this.rpcServer.emit("onDel", this.baseConfig);
        }
        if (!this.die) {
            let id = "";
            if (this.baseConfig) {
                id = this.baseConfig.id
            }
            getLogger()("frame", "warn", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] a rpc client disconnected: ${id}, ${this.socket.remoteAddress}`);
        }
    }

    /**
     * 注册
     */
    private registerHandle(msg: Buffer) {
        clearTimeout(this.registerTimer);
        this.registerTimer = null as any;

        let data: { "baseConfig": I_baseConfig, "token": string };
        try {
            data = JSON.parse(msg.slice(1).toString());
        } catch (err) {
            getLogger()("frame", "warn", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] JSON parse error，close the rpc socket: ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        if (!data || !data.baseConfig || !data.baseConfig.id || !data.baseConfig.serverType || data.token !== this.rpcServer.token) {
            getLogger()("frame", "warn", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] illegal token, close the rpc socket: ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        if (this.rpcServer.sockets[data.baseConfig.id]) {
            getLogger()("frame", "warn", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] already has a rpc client named: ${data.baseConfig.id}, close it, ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        this.socket.maxLen = some_config.SocketBufferMaxLen;
        this.socket.on("data", this.onData.bind(this));

        this.baseConfig = data.baseConfig;
        this.rpcServer.sockets[this.baseConfig.id] = this;

        if (this.sendCache) {
            this.sendTimer = setInterval(this.sendInterval.bind(this), this.rpcServer.sendInterval);
        }

        getLogger()("frame", "info", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] get new rpc client named: ${this.baseConfig.id}`);

        // 注册成功，回应
        let registerBackBuf = Buffer.from(JSON.stringify({ "baseConfig": this.rpcServer.config.baseConfig, "heartbeat": some_config.Time.Rpc_Heart_Beat_Time }));
        let buf = Buffer.allocUnsafe(registerBackBuf.length + 5);
        buf.writeUInt32BE(registerBackBuf.length + 1, 0);
        buf.writeUInt8(Rpc_Msg.register, 4);
        registerBackBuf.copy(buf, 5);
        this.socket.send(buf);
        this.heartbeatHandle();

        this.rpcServer.emit("onAdd", this.baseConfig);
    }

    /**
     * 心跳
     */
    private heartbeatHandle() {
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = setTimeout(() => {
            getLogger()("frame", "warn", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] heartbeat timeout, close it: ${this.baseConfig.id}`);
            this.socket.close();
        }, some_config.Time.Rpc_Heart_Beat_Time * 1000 * 2);
    }

    /**
     * 心跳回应
     */
    private heartbeatResponse() {
        let buffer = Buffer.allocUnsafe(5);
        buffer.writeUInt32BE(1, 0);
        buffer.writeUInt8(Rpc_Msg.heartbeat, 4);
        this.socket.send(buffer);
    }

    send(data: Buffer) {
        if (this.sendCache) {
            this.sendArr.push(data);
        } else {
            this.socket.send(data);
        }
    }

    private sendInterval() {
        if (this.sendArr.length > 0) {
            this.socket.send(Buffer.concat(this.sendArr));
            this.sendArr.length = 0;
        }
    }

    close() {
        this.die = true;
        let buffer = Buffer.allocUnsafe(5);
        buffer.writeUInt32BE(1, 0);
        buffer.writeUInt8(Rpc_Msg.closeClient, 4);
        this.socket.send(buffer);
        this.socket.close();
        getLogger()("frame", "info", `rpcUtil_server --> [${this.rpcServer.config.baseConfig.id}] rpc socket be closed ok [${this.baseConfig.id}]`);
    }
}