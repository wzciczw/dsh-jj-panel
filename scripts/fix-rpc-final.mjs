import { readFileSync, writeFileSync } from "node:fs";

const file = "src/client/index.tsx";
let text = readFileSync(file, "utf8");
const before = 'rpc.call!(rpc, "/api", "jjPanel", method, payload)';
const after = 'rpc.call!("/api", `jjPanel/${method}`, { args: payload })';
if (!text.includes(before)) throw new Error("rpc call expression not found");
text = text.replace(before, after);
writeFileSync(file, text, "utf8");
console.log("client rpc fixed");
