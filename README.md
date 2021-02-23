# rpc-util
a typescript rpc framework

# install
`npm install rpc-util`

# usage

```
import * as rpcUtl from "rpc-util";

class ServerHandler {
    test(a: number, b: string, cb: (err: number, data: any) => void) {
        console.log("server---", a, b);
        cb(0, { "msg": "hello world" });
    }
}
class ClientHandler {
    test(msg: string) {
        console.log("client---", msg);
    }
}

rpcUtl.setLogger((level, msg) => {
    console.log(" *** ", level, msg)
});

let server = rpcUtl.rpcServer({ "id": "hallSvr", "port": 3001 }, { "mainSvr": new ServerHandler() });
let client = rpcUtl.rpcClient({ "id": "gameSvr1", "serverList": [{ "id": "hallSvr", "host": "127.0.0.1", "port": 3001 }] }, { "mainClient": new ClientHandler() });

setTimeout(Test, 1000);

function Test() {

    client.rpc("hallSvr", "mainSvr.test")(123, "hello", (err: number, data: any) => {
        console.log("back", err, data);
    });

    server.rpc("gameSvr1", "mainClient.test")("haha");
}
```