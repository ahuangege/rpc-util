import EventEmitter from "events";
import { RpcServer } from "./rpcServer";
import { RpcClientSocket } from "./rpcClient";
import { RpcService } from "./util/rpcService";
import { RpcSocketPool } from "./util/rpcSocketPool";

export class RpcUtil<T = {}> extends EventEmitter {

    rpc: (id: string, notify?: boolean) => T = null as any;

    serverInfo: I_serverInfo;
    options: I_options = {};
    logger: I_logger = console;
    rpcPool: RpcSocketPool;
    rpcService: RpcService;

    private rpcServer: RpcServer = null as any;
    msgHandler: { [file: string]: any } = {};

    private servers: { [serverType: string]: I_serverInfo[] } = {};
    private serversIdMap: { [id: string]: I_serverInfo } = {};

    constructor(info: I_serverInfo, msgHandler: { [file: string]: any }, options?: I_options) {
        super();

        this.serverInfo = info;
        this.addServer(this.serverInfo);
        this.msgHandler = msgHandler;

        if (options) {
            this.options = options;
            if (options.logger) {
                this.logger = options.logger;
            }
        }
        this.rpcPool = new RpcSocketPool(this);
        this.rpcService = new RpcService(this);
    }

    listen(port: number, token?: string) {
        if (this.rpcServer) {
            this.logger.error("already listening");
            return;
        }
        this.rpcServer = new RpcServer(this, port, token);
    }

    connect(info: { host: string, port: number, token?: string }) {
        new RpcClientSocket(this, info);
    }

    closeServer(id: string, reason: string) {
        let socket = this.rpcPool.getSocket(id);
        if (socket) {
            socket.close(true, reason);
        }
    }

    getServersByType(serverType: string) {
        return this.servers[serverType] || [];
    }

    getServerById(serverId: string) {
        return this.serversIdMap[serverId];
    }

    addServer(server: I_serverInfo) {
        this.serversIdMap[server.id] = server;

        let arr = this.servers[server.serverType];
        if (!arr) {
            arr = [];
            this.servers[server.serverType] = arr;
        }
        arr.push(server);
    }

    removeServer(server: I_serverInfo) {
        delete this.serversIdMap[server.id];

        let arr = this.getServersByType(server.serverType);
        let index = arr.indexOf(server);
        if (index !== -1) {
            arr.splice(index, 1);
        }
    }
}


export interface I_serverInfo {
    "id": string,
    "serverType": string,
    [key: string]: any
}

interface I_options {
    /**
     * 超时时间（秒，大于 5 则使用，默认 10）
     */
    "timeout"?: number,
    /**
     * 消息包最大长度（默认 10 MB）
     */
    "maxLen"?: number,
    /**
     * 消息发送频率（毫秒，大于 10 则启用，默认立即发送）
     */
    "interval"?: number | { "default": number, [serverType: string]: number },
    /**
     * 是否开启Nagle算法（默认不开启）
     */
    "noDelay"?: boolean,
    /**
     * 心跳（秒，大于 5 则使用，默认 60）
     */
    "heartbeat"?: number,
    /**
     * 重连间隔（秒，默认 3）
     */
    "reconnectDelay"?: number,
    /**
     * rpc 消息缓存长度（默认 5000）
     */
    "rpcMsgCacheCount"?: number,
    /**
     * 当开启 interval 时，为防止单次Buffer申请过大，可配置此值作为立即发送的阈值（默认 +Infinity）
     */
    "intervalCacheLen"?: number,
    /**
     * 内部日志输出
     */
    "logger"?: I_logger
}

interface I_logger {
    debug: (msg: string | Error) => void,
    info: (msg: string | Error) => void,
    error: (msg: string | Error) => void,
}
