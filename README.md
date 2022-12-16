# rpc-util
a typescript rpc framework  

# install
`npm install rpc-util`

# usage

```
import { RpcUtil } from "rpc-util";

declare global {
    interface I_demoProject {
        gate: {
            main: serverHandler
        }
    }
}

// 消息接收类
class serverHandler {
    async add(num1: number, num2: number) {
        console.log("add", num1, num2);
        return num1 + num2;
    }
}

// 启动一个服务器
let gate1 = new RpcUtil<I_demoProject>({ "id": "gate1", "serverType": "gate" }, { "main": new serverHandler });
gate1.on("onAdd", (info) => {
    console.log("onAdd", info)
});
gate1.listen(2885);


// 启动一个客户端
let con1 = new RpcUtil<I_demoProject>({ "id": "con1", "serverType": "connector" }, {});
con1.connect({ "host": "127.0.0.1", "port": 2885 });

// rpc
async function test() {

    let res1 = await con1.rpc("gate1").gate.main.add(1, 2);
    console.log("back1", res1)

    let res2 = await gate1.rpc("gate1").gate.main.add(1, 2);
    console.log("back2", res2)
}
test();


```

# others
1、这个框架是给服务器使用的，服务器之间rpc调用。暂未开发纯web前端这种使用。
2、最佳实践在项目源码里的demo文件夹下。