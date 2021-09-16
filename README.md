# rpc-util
a typescript rpc framework  
能够智能参数提示

# install
`npm install rpc-util`

# usage

```
import * as rpcUtil from "rpc-util"

/** 声明提示，开发时应放到一个文件中，不同项目进行共享。声明和服务器消息处理器需要保持一致 */
declare global {
    interface RpcUtil {
        serverType_gate: {
            file_main: {
                method_test: (a: number, b: string, cb: (err: number, num: number) => void) => void;
                method_testAwait: (a: number, b: string) => number;
            }
        }
    }
}

/** 日志回调 */
rpcUtil.setLogger((level, msg) => {
    console.log(level, msg);
});

/** 服务器启动 */
class A implements Required<RpcUtil["serverType_gate"]["file_main"]>{
    method_test(a: number, b: string, cb: (err: number, num: number) => void) {
        console.log("method_test", a, b);
        cb && cb(0, 123);
    }

    method_testAwait(a: number, b: string) {
        console.log("method_testAwait", a, b);
        return 111;
    }
}
rpcUtil.rpcServer({ "baseConfig": { "id": "gateSvr", "serverType": "serverType_gate" }, "port": 3002 }, { "file_main": new A() });

/** 客户端调用测试 */
let client = rpcUtil.rpcClient({ "baseConfig": { "id": "client1", "serverType": "client" }, "serverList": [{ "host": "127.0.0.1", "port": 3002 }] }, {});
setTimeout(async () => {
    client.rpc("gateSvr", "serverType_gate", "file_main", "method_test")(666, "hello", (err, num) => {
        console.log("rpc back", err, num)
    });

    let res = await client.rpcAwait("gateSvr", "serverType_gate", "file_main", "method_testAwait")(555, "world");
    console.log("rpcAwait back", res)
}, 1000)

```