
/** set logger cb */
export function setLogger(cb: (level: "info" | "warn" | "error", msg: string) => void): void;

/** create server */
export function rpcServer(config: I_rpcUtil_serverConfig, msgHandler: { [file: string]: any }): I_rpcUtil_server;

/** create client */
export function rpcClient(config: I_rpcUtil_clientConfig, msgHandler: { [file: string]: any }): I_rpcUtil_client;


interface I_rpcUtil_serverConfig {
    /** server id */
    "id"?: number | string,
    /** port */
    "port": number,
    /** authentication key */
    "token"?: string,
    /** rpc timeout (seconds, use more than 5, default 10) */
    "timeout"?: number,
    /** maximum message packet length (default 10 Mb) */
    "maxLen"?: number,
    /** heartbeat (seconds, use more than 5, default 60) */
    "heartbeat"?: number,
    /** message sending frequency (ms, more than 10 is enabled, the default is to send immediately) */
    "interval"?: number,
}

interface I_rpcUtil_server {
    rpc: (id: number | string, cmd: string) => Function;
    delOne(id: number | string): void;
    on(event: "onAdd" | "onDel", listener: (id: number | string) => void);
}

interface I_rpcUtil_clientConfig {
    /** client id */
    "id": number | string,
    /** server list */
    "serverList": { "id": number | string, "host": string, "port": number }[],
    /** authentication key */
    "token"?: string,
    /** rpc timeout (seconds, use more than 5, default 10) */
    "timeout"?: number,
    /** maximum message packet length (default 10 Mb) */
    "maxLen"?: number,
    /** heartbeat (seconds, use more than 5, default 60) */
    "heartbeat"?: number,
    /** message sending frequency (ms, more than 10 is enabled, the default is to send immediately) */
    "interval"?: number,
}

interface I_rpcUtil_client {
    rpc: (id: number | string, cmd: string) => Function;
    addOne(server: { "id": number | string, "host": string, "port": number }): void;
    delOne(id: number | string): void;
    on(event: "onAdd" | "onDel", listener: (id: number | string) => void);
}

