import { I_RpcClientConfig, RpcClient } from "./rpcClient";
import { I_RpcServerConfig, RpcServer } from "./rpcServer";

let logCb: (level: "info" | "warn" | "error", msg: string) => void = function () {

}
export function setLogger(cb: (level: "info" | "warn" | "error", msg: string) => void) {
    logCb = cb;
}

export function rpcServer(config: I_RpcServerConfig, msgHandler: { [file: string]: any }) {
    return new RpcServer(config, msgHandler);
}

export function rpcClient(config: I_RpcClientConfig, msgHandler: { [file: string]: any }) {
    return new RpcClient(config, msgHandler);
}

export function getLogger() {
    return logCb;
}