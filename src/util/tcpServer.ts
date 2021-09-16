/**
 * tcp通用服务端
 */


import * as net from "net";
import { EventEmitter } from "events";
import { SocketProxy } from "./util";
import { decode } from "./util";
import { some_config } from "./util";


export default function tcpServer(port: number, noDelay: boolean, startCb: () => void, newClientCb: (socket: SocketProxy) => void) {
    let svr = net.createServer(function (socket) {
        socket.setNoDelay(noDelay);
        newClientCb(new NetSocket(socket));
    }).listen(port, startCb);

    svr.on("error", (err) => {
        console.log(err);
        process.exit();
    });
    svr.on("close", () => { });
}

class NetSocket extends EventEmitter implements SocketProxy {
    die: boolean = false;
    remoteAddress: string = "";
    socket: net.Socket;
    maxLen: number;
    len: number = 0;
    buffer: Buffer = null as any;
    headLen = 0;
    headBuf = Buffer.alloc(4);
    constructor(socket: net.Socket) {
        super();
        this.socket = socket;
        this.maxLen = some_config.SocketBufferMaxLenUnregister;
        this.remoteAddress = socket.remoteAddress as string;
        socket.on("close", (err) => {
            if (!this.die) {
                this.die = true;
                this.emit("close", err);
            }
        });
        socket.on("error", (err) => {
            if (!this.die) {
                this.die = true;
                this.emit("close", err);
            }
        });
        socket.on("data", (data: Buffer) => {
            if (!this.die) {
                decode(this, data);
            } else {
                this.close();
            }
        });
    }

    send(data: Buffer) {
        this.socket.write(data);
    }

    close() {
        this.socket.destroy();
        this.socket.emit("close");
    }
}