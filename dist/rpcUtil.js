"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLogger = exports.rpcClient = exports.rpcServer = exports.setLogger = void 0;
const rpcClient_1 = require("./rpcClient");
const rpcServer_1 = require("./rpcServer");
let logCb = function () {
};
function setLogger(cb) {
    logCb = cb;
}
exports.setLogger = setLogger;
function rpcServer(config, msgHandler) {
    return new rpcServer_1.RpcServer(config, msgHandler);
}
exports.rpcServer = rpcServer;
function rpcClient(config, msgHandler) {
    return new rpcClient_1.RpcClient(config, msgHandler);
}
exports.rpcClient = rpcClient;
function getLogger() {
    return logCb;
}
exports.getLogger = getLogger;
