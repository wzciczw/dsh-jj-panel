import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { JjPanelService } from "../lib/host/index.js";
import { resolveJjPath } from "../lib/host/jj.js";

const jj = resolveJjPath();

function detectJj() {
  try {
    execFileSync(jj, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasJj = detectJj();
const integration = hasJj ? test : test.skip;

integration("service: op resolves the session cwd and mutates the repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-jj-panel-service-"));
  process.env.JJ_USER = "Service User";
  process.env.JJ_EMAIL = "service@example.com";
  const run = (args) =>
    execFileSync(jj, ["--no-pager", "--color=never", ...args], { cwd: dir, encoding: "utf8", timeout: 15000 });
  run(["git", "init", "--colocate"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(["describe", "-m", "first"]);

  const ctx = new Context();
  ctx.provide("sessions");
  ctx.set("sessions", { get: (id) => (id === "session-x" ? { header: { cwd: dir } } : undefined) });
  new JjPanelService(ctx, {});
  const receiver = ctx.get("jjPanel");
  assert.ok(receiver !== undefined);

  const described = await receiver.op({
    sessionId: "session-x",
    action: "describe",
    params: { change: "@", message: "renamed by service" }
  });
  assert.equal(described.ok, true, JSON.stringify(described));

  const log = run(["log", "-r", "@", "--no-graph", "-T", "description.first_line()"]);
  assert.equal(log.trim(), "renamed by service");

  const created = await receiver.op({
    sessionId: "session-x",
    action: "new",
    params: { onto: "@", message: "child" }
  });
  assert.equal(created.ok, true, JSON.stringify(created));

  const abandoned = await receiver.op({
    sessionId: "session-x",
    action: "abandon",
    params: { change: "@" }
  });
  assert.equal(abandoned.ok, false);
  assert.equal(abandoned.error.code, "confirmation-required");
});
