"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.some_config = exports.decode = void 0;
/**
 * 拆包
 */
function decode(socket, msg) {
    let readLen = 0;
    while (readLen < msg.length) {
        if (socket.len === 0) //data length is unknown
         {
            socket.buffer = Buffer.concat([socket.buffer, Buffer.from([msg[readLen]])]);
            if (socket.buffer.length === 4) {
                socket.len = socket.buffer.readUInt32BE(0);
                if (socket.len > socket.maxLen || socket.len === 0) {
                    socket.close();
                    throw new Error("socket data length is longer then " + socket.maxLen + ", close it, " + socket.remoteAddress);
                    return;
                }
                socket.buffer = Buffer.allocUnsafe(socket.len);
            }
            readLen++;
        }
        else if (msg.length - readLen < socket.len) // data not coming all
         {
            msg.copy(socket.buffer, socket.buffer.length - socket.len, readLen);
            socket.len -= (msg.length - readLen);
            readLen = msg.length;
        }
        else {
            msg.copy(socket.buffer, socket.buffer.length - socket.len, readLen, readLen + socket.len);
            readLen += socket.len;
            socket.len = 0;
            let data = socket.buffer;
            socket.buffer = Buffer.allocUnsafe(0);
            //data coming all
            socket.emit("data", data);
        }
    }
}
exports.decode = decode;
/**
 * 一些默认配置
 */
exports.some_config = {
    Time: {
        Rpc_Reconnect_Time: 3,
        Rpc_Heart_Beat_Time: 60,
        Rpc_Heart_Beat_Timeout_Time: 10,
    },
    token: "rpcUtil_token",
    SocketBufferMaxLenUnregister: 1024,
    SocketBufferMaxLen: 10 * 1024 * 1024
};
