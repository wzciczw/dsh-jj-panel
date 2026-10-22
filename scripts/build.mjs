import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

function run(project) {
  execFileSync(process.execPath, [tsc, "-p", project], { stdio: "inherit", cwd: root });
}

rmSync(join(root, "lib"), { recursive: true, force: true });
run("tsconfig.host.json");
run("tsconfig.client.json");

// Bundle the CommonJS client output into one file the harness loader can wrap:
// relative requires resolve lazily inside the bundle, everything else (react)
// is delegated to the harness `require`.
const buildDir = join(root, "lib", "client-build");
const modules = new Map();
for (const file of readdirSync(buildDir)) {
  if (!file.endsWith(".js")) continue;
  const cjs = file.slice(0, -3) + ".cjs";
  renameSync(join(buildDir, file), join(buildDir, cjs));
  modules.set(file.slice(0, -3), readFileSync(join(buildDir, cjs), "utf8"));
}
if (!modules.has("index")) throw new Error("client build produced no index.js");

const chunks = [];
chunks.push('"use strict";');
chunks.push("var __defs = Object.create(null);");
chunks.push("var __cache = Object.create(null);");
chunks.push("function __require(id) {");
chunks.push('  if (id.startsWith("./")) {');
chunks.push('    var key = id.slice(2).replace(/\\.js$/, "");');
chunks.push("    return __load(key);");
chunks.push("  }");
chunks.push("  return require(id);");
chunks.push("}");
chunks.push("function __load(id) {");
chunks.push("  if (id in __cache) return __cache[id];");
chunks.push("  if (!(id in __defs)) throw new Error('module not bundled: ' + id);");
chunks.push("  var module = { exports: {} };");
chunks.push("  __cache[id] = module.exports;");
chunks.push("  __defs[id](module, module.exports, __require);");
chunks.push("  __cache[id] = module.exports;");
chunks.push("  return __cache[id];");
chunks.push("}");
for (const [id, source] of modules) {
  chunks.push(`__defs[${JSON.stringify(id)}] = function (module, exports, require) {`);
  chunks.push(source);
  chunks.push("};");
}
chunks.push('module.exports = __load("index");');

mkdirSync(join(root, "lib"), { recursive: true });
writeFileSync(
  join(root, "lib", "client.js"),
  [
    'window.__ModuleLoader__.load({ id: "dsh-jj-panel", factory: (require) => {',
    "var module = { exports: {} }; var exports = module.exports;",
    ...chunks,
    "return module.exports;",
    "} });",
    ""
  ].join("\n"),
  "utf8"
);

console.log("built lib/host and lib/client.js");

