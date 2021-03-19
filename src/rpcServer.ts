import { getLogger } from "./rpcUtil";
import { I_rpc_sc, RpcService } from "./util/rpcService";
import tcpServer from "./util/tcpServer";
import { SocketProxy, Rpc_Msg, some_config } from "./util/util";
import { EventEmitter } from "events";

export interface I_RpcServerConfig {
    "id"?: number | string,
    "port": number,
    "token"?: string,
    "timeout"?: number,
    "maxLen"?: number,
    "heartbeat"?: number,
    "interval"?: number,
}

export class RpcServer extends EventEmitter implements I_rpc_sc {
    config: I_RpcServerConfig;
    sockets: { [id: string]: RpcServerSocket } = {};
    rpc: (id: string, cmd: string) => Function = null as any;
    rpcService: RpcService;
    msgHandler: { [file: string]: any };
    sendCache: boolean = false;
    sendInterval: number = 0;
    constructor(config: I_RpcServerConfig, msgHandler: { [file: string]: any }) {
        super();
        this.config = config;
        this.msgHandler = msgHandler;
        if (config.interval && config.interval >= 10) {
            this.sendCache = true;
            this.sendInterval = config.interval;
        }
        this.rpcService = new RpcService(config.timeout || 0, this);

        tcpServer(config.port
            , () => {
                getLogger()("info", `rpcUtil_server --> [${this.config.id}] listening at [${config.port}]`);
            }
            , (socket: SocketProxy) => {
                new RpcServerSocket(this, socket);
            });
    }

    delOne(id: number | string) {
        let one = this.sockets[id];
        if (one) {
            one.close();
        }
    }

}


class RpcServerSocket {
    private rpcServer: RpcServer;

    private id: string = "";
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
            getLogger()("warn", `rpcUtil_server --> [${this.rpcServer.config.id}] register timeout, close the socket: ${socket.remoteAddress}`);
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
                getLogger()("warn", `rpcUtil_server --> [${this.rpcServer.config.id}] illegal rpc register, close the socket: ${this.socket.remoteAddress}`);
                this.socket.close();
            }
        } catch (e) {
            this.socket.close();
            getLogger()("error", `[${this.rpcServer.config.id}] ` + e.stack);
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
                this.rpcServer.rpcService.handleMsg(this.id, data);
            }
            else if (type === Rpc_Msg.heartbeat) {
                this.heartbeatHandle();
                this.heartbeatResponse();
            }
            else {
                getLogger()("error", `rpcUtil_server --> [${this.rpcServer.config.id}] illegal data type, close rpc client named: ${this.id}`);
                this.socket.close();
            }
        } catch (e) {
            getLogger()("error", `[${this.rpcServer.config.id}] ` + e.stack);
        }
    }

    /**
     * socket连接关闭了
     */
    private onClose() {
        clearTimeout(this.registerTimer);
        clearTimeout(this.heartbeatTimer);
        clearInterval(this.sendTimer);
        if (this.rpcServer.sockets[this.id]) {
            delete this.rpcServer.sockets[this.id];
            this.rpcServer.emit("onDel", this.id);
        }
        if (!this.die) {
            getLogger()("warn", `rpcUtil_server --> [${this.rpcServer.config.id}] a rpc client disconnected: ${this.id}, ${this.socket.remoteAddress}`);
        }
    }

    /**
     * 注册
     */
    private registerHandle(msg: Buffer) {
        clearTimeout(this.registerTimer);
        let data: { "id": string, "token": string };
        try {
            data = JSON.parse(msg.slice(1).toString());
        } catch (err) {
            getLogger()("warn", `rpcUtil_server --> [${this.rpcServer.config.id}] JSON parse error，close the rpc socket: ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        let token = this.rpcServer.config.token || some_config.token;
        if (!data.id || data.token !== token) {
            getLogger()("warn", `rpcUtil_server --> [${this.rpcServer.config.id}] illegal token, close the rpc socket: ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        if (this.rpcServer.sockets[data.id]) {
            getLogger()("warn", `rpcUtil_server --> [${this.rpcServer.config.id}] already has a rpc client named: ${data.id}, close it, ${this.socket.remoteAddress}`);
            this.socket.close();
            return;
        }
        this.socket.maxLen = this.rpcServer.config.maxLen || some_config.SocketBufferMaxLen;
        this.socket.on("data", this.onData.bind(this));

        this.id = data.id;
        this.rpcServer.sockets[this.id] = this;
        this.registerTimer = null as any;

        if (this.sendCache) {
            this.sendTimer = setInterval(this.sendInterval.bind(this), this.rpcServer.sendInterval);
        }

        getLogger()("info", `rpcUtil_server --> [${this.rpcServer.config.id}] get new rpc client named: ${this.id}`);

        // 注册成功，回应
        let buffer = Buffer.allocUnsafe(5);
        buffer.writeUInt32BE(1, 0);
        buffer.writeUInt8(Rpc_Msg.register, 4);
        this.socket.send(buffer);
        this.heartbeatHandle();

        this.rpcServer.emit("onAdd", this.id);
    }

    /**
     * 心跳
     */
    private heartbeatHandle() {
        clearTimeout(this.heartbeatTimer);
        let heartbeat = this.rpcServer.config.heartbeat || some_config.Time.Rpc_Heart_Beat_Time;
        if (heartbeat < 5) {
            heartbeat = 5;
        }
        this.heartbeatTimer = setTimeout(() => {
            getLogger()("warn", `rpcUtil_server --> [${this.rpcServer.config.id}] heartbeat timeout, close it: ${this.id}`);
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
        getLogger()("info", `rpcUtil_server --> [${this.rpcServer.config.id}] rpc socket be closed ok [${this.id}]`);
    }
}