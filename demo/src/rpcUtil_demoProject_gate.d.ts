/**
 * I_demoProject 表示项目，你可能会rpc到不同项目，依据这个区分各自的命名空间
 * gate 表示服务器类型
 * main 表示消息接收文件
 */


declare global {
    interface I_demoProject {
        gate: {
            main: mainFile
        }
    }
}


export interface mainFile {
    /** 加法 */
    add: (num1: number, num2: number) => Promise<number>;
}
