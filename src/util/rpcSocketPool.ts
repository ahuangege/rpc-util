
import { RpcUtil } from "../rpcUtil";

export class RpcSocketPool {
    rpcUtil: RpcUtil;
    private rpcSockets: { [id: string]: I_RpcSocket } = {};

    constructor(rpcUtil: RpcUtil) {
        this.rpcUtil = rpcUtil;
    }


    /**
     * Add socket
     */
    addSocket(id: string, socket: I_RpcSocket) {
        this.rpcSockets[id] = socket;
        this.rpcUtil.rpcService.rpcOnNewSocket(id);
    }

    /**
     * Remove socket
     */
    removeSocket(id: string) {
        delete this.rpcSockets[id];
    }

    /**
     * Get socket
     */
    getSocket(id: string) {
        return this.rpcSockets[id];
    }
}

interface I_RpcSocket {
    send(data: Buffer): void;
    close(byUser: boolean, reason: string): void;
}