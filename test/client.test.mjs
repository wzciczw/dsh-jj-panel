import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function loadBundle() {
  const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  let loaded;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          loaded = entry;
        }
      }
    },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "lib/client.js" });
  assert.ok(loaded !== undefined, "bundle did not register with the module loader");
  assert.equal(loaded.id, "dsh-jj-panel");
  const moduleExports = loaded.factory((id) => {
    if (id === "react") return React;
    throw new Error(`unexpected require: ${id}`);
  });
  return moduleExports;
}

test("client: bundle exports the loader identity and services", () => {
  const mod = loadBundle();
  assert.equal(mod.name, "dsh-jj-panel");
  assert.deepEqual([...mod.inject], ["slots", "locale", "connection"]);
  assert.equal(typeof mod.apply, "function");
});

test("client: apply registers the conversation view and renders", () => {
  const mod = loadBundle();
  let captured;
  const ctx = {
    get: (key) =>
      key === "connection"
        ? { rpc: { call: async () => ({ ok: true, value: { commits: [] } }) } }
        : undefined,
    effect: (fn) => fn(),
    locale: {
      register() {},
      bind: () => (key) => key
    },
    slots: {
      inject(_name, register) {
        register();
      },
      register(options, component) {
        captured = { options, component };
        return () => {};
      }
    }
  };
  mod.apply(ctx);
  assert.ok(captured !== undefined);
  assert.equal(captured.options.id, "jj-panel");
  assert.equal(captured.options.name, "conversation.view");
  assert.equal(captured.options.order, 31);
  assert.equal(captured.options.label(), "tab");
  const html = renderToStaticMarkup(captured.component({ sessionId: "test-session" }));
  assert.match(html, /placeholder="revset"/u);
  assert.match(html, />refresh</u);
  assert.match(html, />empty</u);
});

test("client: rpc calls use the gateway channel, endpoint and args.req envelope", async () => {
  const mod = loadBundle();
  const calls = [];
  const ctx = {
    get: (key) =>
      key === "connection"
        ? {
            rpc: {
              call: (...args) => {
                calls.push(args);
                return Promise.resolve({ ok: true, value: { ok: true, value: { commits: [] } } });
              }
            }
          }
        : undefined
  };
  const rpc = mod.createRpc(ctx);
  assert.equal(typeof rpc, "function");
  await rpc("log", { sessionId: "s", revset: "::@", limit: 5 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api");
  assert.equal(calls[0][1], "jjPanel/log");
  // Cross-realm objects from the vm bundle: compare structurally, not by prototype.
  assert.equal(
    JSON.stringify(calls[0][2]),
    JSON.stringify({ args: { req: { sessionId: "s", revset: "::@", limit: 5 } } })
  );
});
