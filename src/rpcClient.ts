import { getLogger } from "./rpcUtil";
import { I_rpc_sc, RpcService } from "./util/rpcService";
import { TcpClient } from "./util/tcpClient";
import { Rpc_Msg, SocketProxy, some_config } from "./util/util";
import { EventEmitter } from "events";
import { I_baseConfig } from "./rpcServer";

export interface I_RpcClientConfig {
    "baseConfig": I_baseConfig,
    "serverList": { "idTmp": string, "host": string, "port": number, "token"?: string, [key: string]: any }[],
    "interval"?: number,
    "noDelay"?: boolean,
}


export class RpcClient extends EventEmitter implements I_rpc_sc {
    allSockets: { [id: string]: RpcClientSocket } = {};
    sockets: { [id: string]: RpcClientSocket } = {};
    rpc: (id: string) => RpcUtil = null as any;
    rpcAwait: (id: string, notify?: boolean) => RpcUtil = null as any;
    msgHandler: { [file: string]: any };

    config: I_RpcClientConfig;
    rpcService: RpcService;
    constructor(config: I_RpcClientConfig, msgHandler: { [file: string]: any }) {
        super();
        this.config = config;
        this.msgHandler = msgHandler;
        this.rpcService = new RpcService(this);

        for (let one of config.serverList) {
            let socket = new RpcClientSocket(this, one);
            this.allSockets[one.id] = socket;
        }
    }

    addOne(server: { "idTmp": string, "host": string, "port": number, "token"?: string, [key: string]: any }) {
        let socket = new RpcClientSocket(this, server);
        this.allSockets[server.id] = socket;
    }

    delOne(idTmp: string) {
        let one = this.allSockets[idTmp];
        if (one) {
            one.close(true)
        }
    }

    hasSocket(idTmp: string) {
        return !!this.allSockets[idTmp];
    }

    isSocketAlive(idTmp: string) {
        return !!this.sockets[idTmp];
    }


}



export class RpcClientSocket {
    private rpcClient: RpcClient;

    baseConfig: I_baseConfig = null as any;
    private idTmp: string;
    private host: string;
    private port: number;
    private socket: SocketProxy = null as any;
    private die = false;
    private token: string;

    private sendCache: boolean = false;
    private sendArr: Buffer[] = [];
    private sendTimer: NodeJS.Timer = null as any;

    private heartbeatTimer: NodeJS.Timer = null as any;
    private heartbeatTimeoutTimer: NodeJS.Timer = null as any;
    private connectTimeout: NodeJS.Timeout = null as any;
    private heartbeat: number = 0;

    constructor(rpcClient: RpcClient, server: { "idTmp": string, "host": string, "port": number, "token"?: string }) {
        this.rpcClient = rpcClient;
        this.idTmp = server.idTmp;
        this.host = server.host;
        this.port = server.port;
        this.token = server.token || some_config.token;

        let interval = this.rpcClient.config.interval;
        if (interval && interval >= 10) {
            this.sendCache = true;
        }

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
                    "baseConfig": self.rpcClient.config.baseConfig,
                    "token": self.token,
                }));
                let buf = Buffer.allocUnsafe(registerBuf.length + 5);
                buf.writeUInt32BE(registerBuf.length + 1, 0);
                buf.writeUInt8(Rpc_Msg.register, 4);
                registerBuf.copy(buf, 5);
                self.socket.send(buf);
            };
            this.connectTimeout = null as any;
            let noDelay = self.rpcClient.config.noDelay === false ? false : true;
            self.socket = new TcpClient(self.port, self.host, some_config.SocketBufferMaxLen, noDelay, connectCb);
            self.socket.on("data", self.onData.bind(self));
            self.socket.on("close", self.onClose.bind(self));
        }, delay);
    }


    private onClose() {
        clearTimeout(this.heartbeatTimer);
        clearTimeout(this.heartbeatTimeoutTimer);
        clearInterval(this.sendTimer);
        this.heartbeatTimeoutTimer = null as any;
        this.socket = null as any;
        if (!this.die) {

            getLogger()("frame", "warn", `rpcUtil_client --> [${this.rpcClient.config.baseConfig.id}] socket closed, reconnect the rpc server later: ${this.idTmp}`);
            this.doConnect(some_config.Time.Rpc_Reconnect_Time * 1000);
        }
        if (this.baseConfig && this.rpcClient.sockets[this.baseConfig.id]) {
            delete this.rpcClient.sockets[this.baseConfig.id];
            this.rpcClient.emit("onDel", this.baseConfig);
        }
        this.baseConfig = null as any;
    }

    /**
     * 每隔一定时间发送心跳
     */
    private heartbeatSend() {
        this.heartbeatTimer = setTimeout(() => {
            let buf = Buffer.allocUnsafe(5);
            buf.writeUInt32BE(1, 0);
            buf.writeUInt8(Rpc_Msg.heartbeat, 4);
            this.socket.send(buf);
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
            getLogger()("frame", "warn", `rpcUtil_client --> [${this.rpcClient.config.baseConfig.id}] heartbeat timeout, close the socket: ${this.idTmp}`);
        }, some_config.Time.Rpc_Heart_Beat_Timeout_Time * 1000);

    }

    private onData(data: Buffer) {
        try {
            let type = data.readUInt8(0);
            if (type === Rpc_Msg.rpcMsg) {
                this.rpcClient.rpcService.handleMsg(this.baseConfig.id, data);
            }
            else if (type === Rpc_Msg.rpcMsgAwait) {
                this.rpcClient.rpcService.handleMsgAwait(this.baseConfig.id, data);
            }
            else if (type === Rpc_Msg.register) {
                this.registerHandle(data);
            }
            else if (type === Rpc_Msg.heartbeat) {
                this.heartbeatResponse();
            } else if (type === Rpc_Msg.closeClient) {
                this.close(false);
            }
        } catch (e: any) {
            getLogger()("msg", "error", `[${this.rpcClient.config.baseConfig.id}] ` + e.stack);
        }
    }

    /**
     * 注册成功
     */
    private registerHandle(buf: Buffer) {
        let data: { "baseConfig": I_baseConfig, "heartbeat": number } = JSON.parse(buf.slice(1).toString());
        this.baseConfig = data.baseConfig;
        this.heartbeat = data.heartbeat;
        this.heartbeatSend();
        this.rpcClient.sockets[this.baseConfig.id] = this;
        if (this.sendCache) {
            this.sendTimer = setInterval(this.sendInterval.bind(this), this.rpcClient.config.interval) as any;
        }
        getLogger()("frame", "info", `rpcUtil_client --> [${this.rpcClient.config.baseConfig.id}] connect rpc server ok [${this.idTmp}]`);
        this.rpcClient.emit("onAdd", this.baseConfig);
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
    close(byUser: boolean) {
        if (this.die) {
            return;
        }
        delete this.rpcClient.allSockets[this.idTmp];
        this.die = true;
        if (this.socket) {
            this.socket.close();
        }
        clearTimeout(this.connectTimeout);
        if (byUser) {
            getLogger()("frame", "info", `rpcUtil_client --> [${this.rpcClient.config.baseConfig.id}] rpc socket be closed ok [${this.idTmp}]`);
        } else {
            getLogger()("frame", "info", `rpcUtil_client --> [${this.rpcClient.config.baseConfig.id}] rpc socket be closed by rpc server ok [${this.idTmp}]`);
        }
    }
}