import { I_rpc_sc, RpcService } from "./util/rpcService";
import { TcpClient } from "./util/tcpClient";
import { Rpc_Msg, SocketProxy, some_config } from "./util/util";

export interface I_RpcClientConfig {
    "id": number | string,
    "serverList": { "id": number | string, "host": string, "port": number }[],
    "token"?: string,
    "timeout"?: number,
    "maxLen"?: number,
    "heartbeat"?: number,
}


export class RpcClient implements I_rpc_sc {
    config: I_RpcClientConfig;
    sockets: { [id: string]: RpcClientSocket } = {};
    rpc: (id: string, cmd: string) => Function = null as any;
    rpcService: RpcService;
    msgHandler: { [file: string]: any };
    allSockets: { [id: string]: RpcClientSocket } = {};
    constructor(config: I_RpcClientConfig, msgHandler: { [file: string]: any }) {
        this.config = config;
        this.msgHandler = msgHandler;
        this.rpcService = new RpcService(config.timeout || 0, this);

        for (let one of config.serverList) {
            new RpcClientSocket(this, one)
        }
    }

    addOne(server: { "id": number | string, "host": string, "port": number }) {
        new RpcClientSocket(this, server)
    }

    delOne(id: number | string) {
        let one = this.allSockets[id];
        if (one) {
            one.close(true)
        }
    }
}



export class RpcClientSocket {
    private rpcClient: RpcClient;

    private id: string;
    private host: string;
    private port: number;
    private socket: SocketProxy = null as any;
    private die = false;

    private heartbeatTimer: NodeJS.Timer = null as any;
    private heartbeatTimeoutTimer: NodeJS.Timer = null as any;
    private connectTimeout: NodeJS.Timeout = null as any;

    constructor(rpcClient: RpcClient, server: { "id": number | string, "host": string, "port": number }) {
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

    private doConnect(delay: number) {
        if (this.die) {
            return;
        }
        let self = this;
        this.connectTimeout = setTimeout(() => {
            let connectCb = function () {
                // 注册
                let registerBuf = Buffer.from(JSON.stringify({
                    "id": self.rpcClient.config.id,
                    "token": self.rpcClient.config.token || some_config.token,
                }));
                let buf = Buffer.allocUnsafe(registerBuf.length + 5);
                buf.writeUInt32BE(registerBuf.length + 1, 0);
                buf.writeUInt8(Rpc_Msg.register, 4);
                registerBuf.copy(buf, 5);
                self.socket.send(buf);
            };
            this.connectTimeout = null as any;
            self.socket = new TcpClient(self.port, self.host, self.rpcClient.config.maxLen || some_config.SocketBufferMaxLen, connectCb);
            self.socket.on("data", self.onData.bind(self));
            self.socket.on("close", self.onClose.bind(self));
        }, delay);
    }


    private onClose() {
        delete this.rpcClient.sockets[this.id];
        clearTimeout(this.heartbeatTimer);
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null as any;
        this.socket = null as any;
        if (!this.die) {
            console.warn(`rpcUtil_client --> [${this.rpcClient.config.id}] socket closed, reconnect the rpc server later: ${this.id}`);
            this.doConnect(some_config.Time.Rpc_Reconnect_Time * 1000);
        }
    }

    /**
     * 每隔一定时间发送心跳
     */
    private heartbeatSend() {
        let self = this;
        let heartbeat = this.rpcClient.config.heartbeat || some_config.Time.Rpc_Heart_Beat_Time;
        let timeDelay = heartbeat * 1000 - 5000 + Math.floor(5000 * Math.random());
        if (timeDelay < 5000) {
            timeDelay = 5000;
        }
        this.heartbeatTimer = setTimeout(function () {
            let buf = Buffer.allocUnsafe(5);
            buf.writeUInt32BE(1, 0);
            buf.writeUInt8(Rpc_Msg.heartbeat, 4);
            self.socket.send(buf);
            self.heartbeatTimeoutStart();
            self.heartbeatSend();
        }, timeDelay);
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
            console.warn(`rpcUtil_client --> [${this.rpcClient.config.id}] heartbeat timeout, close the socket: ${this.id}`);
        }, some_config.Time.Rpc_Heart_Beat_Timeout_Time * 1000);

    }

    private onData(data: Buffer) {
        try {
            let type = data.readUInt8(0);
            if (type === Rpc_Msg.rpcMsg) {
                this.rpcClient.rpcService.handleMsg(this.id, data);
            }
            else if (type === Rpc_Msg.register) {
                this.registerHandle();
            }
            else if (type === Rpc_Msg.heartbeat) {
                this.heartbeatResponse();
            } else if (type === Rpc_Msg.closeClient) {
                this.close(false);
            }
        } catch (e) {
            console.error(`[${this.rpcClient.config.id}]`, e.stack);
        }
    }

    /**
     * 注册成功
     */
    private registerHandle() {
        this.heartbeatSend();
        this.rpcClient.sockets[this.id] = this;
        console.info(`rpcUtil_client --> [${this.rpcClient.config.id}] connect rpc server ok [${this.id}]`);
    }


    send(data: Buffer) {
        this.socket.send(data);
    }

    close(byUser: boolean) {
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
        } else {
            console.info(`rpcUtil_client --> [${this.rpcClient.config.id}] rpc socket be closed by rpc server ok [${this.id}]`);
        }
    }
}