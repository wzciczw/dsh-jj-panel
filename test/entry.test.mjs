import test from "node:test";
import assert from "node:assert/strict";

test("host: the compiled entry imports cleanly and exports the bundle identity", async () => {
  const mod = await import("../lib/host/index.js");
  assert.equal(mod.name, "jj-panel");
  assert.deepEqual(mod.inject, []);
  assert.equal(typeof mod.apply, "function");
  assert.equal(typeof mod.JjPanelService, "function");
});
