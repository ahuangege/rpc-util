
/** set logger cb */
export function setLogger(cb: (type: "msg" | "frame", level: "info" | "warn" | "error", msg: string) => void): void;

/** create server */
export function rpcServer(config: I_rpcUtil_serverConfig, msgHandler: { [file: string]: any }): I_rpcUtil_server;

/** create client */
export function rpcClient(config: I_rpcUtil_clientConfig, msgHandler: { [file: string]: any }): I_rpcUtil_client;


interface I_baseConfig {
    "id": string,
    "serverType": string,
    [key: string]: any,
}


interface I_rpcUtil_serverConfig {
    "baseConfig": I_baseConfig
    /** port */
    "port": number,
    /** authentication key */
    "token"?: string,
    /** message sending frequency (ms, more than 10 is enabled, the default is to send immediately) */
    "interval"?: number,
    /** whether to enable Nagle algorithm (not enabled by default) */
    "noDelay"?: boolean,
}

interface I_rpcUtil_server {
    rpc: (id: string) => RpcUtil;
    rpcAwait: (id: string, notify?: boolean) => RpcUtil;
    delOne(id: string): void;
    hasSocket(id: string): boolean;
    on(event: "onAdd" | "onDel", listener: (info: I_baseConfig) => void);
}

interface I_rpcUtil_clientConfig {
    "baseConfig": I_baseConfig,
    "serverList": { "idTmp": string, "host": string, "port": number, "token"?: string, [key: string]: any }[],
    /** message sending frequency (ms, more than 10 is enabled, the default is to send immediately) */
    "interval"?: number,
    /** whether to enable Nagle algorithm (not enabled by default) */
    "noDelay"?: boolean,
}

interface I_rpcUtil_client {
    rpc: (id: string) => RpcUtil;
    rpcAwait: (id: string, notify?: boolean) => RpcUtil;
    addOne(server: { "idTmp": string, "host": string, "port": number, "token"?: string, [key: string]: any }): void;
    delOne(idTmp: string): void;
    hasSocket(idTmp: string): boolean;
    isSocketAlive(idTmp: string): boolean;
    on(event: "onAdd" | "onDel", listener: (info: I_baseConfig) => void);
}

/**
 * RpcUtil
 */
declare global {
    interface RpcUtil {
    }
}
