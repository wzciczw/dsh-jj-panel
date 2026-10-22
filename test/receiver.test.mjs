import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { JjPanelService } from "../lib/host/index.js";

test("host: Remote methods survive the Cordis receiver proxy", async () => {
  const ctx = new Context();
  new JjPanelService(ctx, {});
  const receiver = ctx.get("jjPanel");
  assert.ok(receiver !== undefined, "service is not registered");
  const result = await receiver.snapshot({});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "cwd-unavailable");
});
