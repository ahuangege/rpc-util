import { EventEmitter } from "events";

/**
 * socket连接代理
 */
export interface SocketProxy extends EventEmitter {
    socket: any;
    remoteAddress: string;
    die: boolean;
    maxLen: number;
    len: number;
    buffer: Buffer;
    headLen: number;
    headBuf: Buffer;
    close(): void;
    send(data: Buffer): void;
}


/**
 * 拆包
 */
export function decode(socket: SocketProxy, msg: Buffer) {
    let readLen = 0;
    while (readLen < msg.length) {
        if (socket.len === 0) // data length is unknown
        {
            socket.headBuf[socket.headLen] = msg[readLen];
            socket.headLen++;
            readLen++;
            if (socket.headLen === 4) {
                socket.len = socket.headBuf.readUInt32BE(0);
                if (socket.len > socket.maxLen || socket.len === 0) {
                    socket.close();
                    throw new Error("socket data length is longer then " + socket.maxLen + ", close it, " + socket.remoteAddress);
                    return;
                }
                if (msg.length - readLen >= socket.len) { // data coming all
                    socket.emit("data", msg.subarray(readLen, readLen + socket.len));
                    readLen += socket.len;
                    socket.len = 0;
                    socket.headLen = 0;
                } else {
                    socket.buffer = Buffer.allocUnsafe(socket.len);
                }
            }
        }
        else if (msg.length - readLen < socket.len)	// data not coming all
        {
            msg.copy(socket.buffer, socket.buffer.length - socket.len, readLen);
            socket.len -= (msg.length - readLen);
            readLen = msg.length;
        }
        else { // data coming all
            msg.copy(socket.buffer, socket.buffer.length - socket.len, readLen, readLen + socket.len);
            socket.emit("data", socket.buffer);
            readLen += socket.len;
            socket.len = 0;
            socket.headLen = 0;
            socket.buffer = null as any;
        }
    }
}


/**
 * 一些默认配置
 */
export let some_config = {
    Time: {
        Rpc_Reconnect_Time: 3,
        Rpc_Heart_Beat_Time: 60,
        Rpc_Heart_Beat_Timeout_Time: 10,
    },
    token: "rpcUtil_token",
    SocketBufferMaxLenUnregister: 1024, // 未注册的socket，消息最大长度
    SocketBufferMaxLen: 10 * 1024 * 1024
}

/**
 * 内部用户服务器消息类型
 */
export const enum Rpc_Msg {
    register = 1,           // 注册
    heartbeat = 2,          // 心跳
    closeClient = 3,        // 关闭rpc client
    rpcMsg = 4,             // rpc消息
    rpcMsgAwait = 5,        // rpc消息 await形式
}



/**
 * rpc消息导向包
 * 1、有f有id表示收到消息且需回调
 * 2、有f无id表示收到消息无需回调
 * 3、无f有id表示是回调的消息
 */
export interface I_rpcMsg {
    f?: string;
    m?: string;
    id?: number;
}

/**
 * rpc请求超时
 */
export interface I_rpcTimeout {
    id: number;
    cb: Function;
    time: number;
    await: boolean;
}

