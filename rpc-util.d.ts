

export class RpcUtil<T> {

    constructor(info: I_serverInfo, msgHandler: { [file: string]: any }, options?: I_options);

    /**
     *  rpc 调用
     */
    rpc(id: string, notify?: boolean): T;

    /**
     * 监听
     */
    listen(port: number, token?: string): void;

    /**
     * 连接某个服务器
     */
    connect(info: { host: string, port: number, token?: string }): void;

    /**
     * 断开与某个服务器的连接
     */
    closeServer(id: string, reason?: string): void;

    /**
     * 获取某一类型的连接
     */
    getServersByType(serverType: string): I_serverInfo[];

    /**
     * 获取某一个连接
     */
    getServerById(serverId: string): I_serverInfo;

    /**
     * 事件通知
     */
    on(event: "onAdd" | "onDel", cb: (info: I_serverInfo) => void): void;
}

interface I_serverInfo {
    "id": string,
    "serverType": string,
    [key: string]: any
}

interface I_options {
    /**
     * rpc 超时时间（秒，大于 5 则使用，默认 10）
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
