import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, resolveJjPath } from "../lib/host/jj.js";
import { buildOpArgv, runOp } from "../lib/host/ops.js";
import { log } from "../lib/host/queries.js";

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
const runner = createRunner(jj, { timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-jj-panel-ops-"));
  process.env.JJ_USER = "Test User";
  process.env.JJ_EMAIL = "test@example.com";
  const run = (args) => execFileSync(jj, ["--no-pager", "--color=never", ...args], { cwd: dir, encoding: "utf8", timeout: 15000 });
  run(["git", "init", "--colocate"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(["describe", "-m", "first"]);
  run(["new", "-m", "second"]);
  writeFileSync(join(dir, "b.txt"), "two\n");
  writeFileSync(join(dir, "c.txt"), "three\n");
  return { dir, run };
}

test("ops: argv builder covers every action", () => {
  assert.deepEqual(buildOpArgv({ action: "new", params: { onto: "@", message: "msg" } }), ["new", "@", "-m", "msg"]);
  assert.deepEqual(buildOpArgv({ action: "edit", params: { change: "abc" } }), ["edit", "abc"]);
  assert.deepEqual(buildOpArgv({ action: "describe", params: { change: "@", message: "x" } }), [
    "describe",
    "-r",
    "@",
    "-m",
    "x"
  ]);
  assert.deepEqual(buildOpArgv({ action: "squash", params: { from: "@", into: "@-" } }), [
    "squash",
    "--from",
    "@",
    "--into",
    "@-",
    "-u"
  ]);
  assert.deepEqual(
    buildOpArgv({ action: "abandon", confirm: true, params: { change: "abc", subtree: true } }),
    ["abandon", "abc::"]
  );
  assert.deepEqual(buildOpArgv({ action: "duplicate", params: { change: "abc", onto: "@-" } }), [
    "duplicate",
    "abc",
    "--onto",
    "@-"
  ]);
  assert.deepEqual(
    buildOpArgv({ action: "revert", confirm: true, params: { change: "abc", destination: "@" } }),
    ["revert", "-r", "abc", "--onto", "@"]
  );
  assert.deepEqual(buildOpArgv({ action: "rebase", params: { change: "abc", destination: "@" } }), [
    "rebase",
    "-r",
    "abc",
    "--onto",
    "@"
  ]);
  assert.deepEqual(buildOpArgv({ action: "split", params: { change: "abc", paths: ["a.txt"] } }), [
    "split",
    "-r",
    "abc",
    "-m",
    "split",
    "a.txt"
  ]);
  assert.deepEqual(buildOpArgv({ action: "undo", confirm: true }), ["undo"]);
  assert.deepEqual(buildOpArgv({ action: "fetch" }), ["git", "fetch"]);
  assert.deepEqual(buildOpArgv({ action: "bookmark", params: { name: "feat/x", change: "@" } }), [
    "bookmark",
    "set",
    "feat/x",
    "-r",
    "@"
  ]);
  assert.deepEqual(buildOpArgv({ action: "push", confirm: true, params: { name: "feat/x" } }), [
    "git",
    "push",
    "--bookmark",
    "feat/x"
  ]);
});

test("ops: destructive actions require confirmation", () => {
  const codeOf = (fn) => {
    try {
      fn();
      return "no-throw";
    } catch (error) {
      return error?.code ?? "no-code";
    }
  };
  for (const action of ["abandon", "revert", "undo", "push"]) {
    assert.equal(
      codeOf(() => buildOpArgv({ action, params: { change: "@", destination: "@", name: "x" } })),
      "confirmation-required",
      action
    );
  }
  assert.equal(codeOf(() => buildOpArgv({ action: "nope" })), "unknown-action");
  assert.equal(codeOf(() => buildOpArgv({ action: "new", params: { onto: "--config=x" } })), "invalid-revset");
  assert.equal(codeOf(() => buildOpArgv({ action: "split", params: { change: "@", paths: ["../x"] } })), "invalid-path");
  assert.equal(
    codeOf(() => buildOpArgv({ action: "bookmark", params: { name: "-bad", change: "@" } })),
    "invalid-bookmark"
  );
});

integration("ops: new, describe, split, squash, duplicate, revert, abandon, undo on a real repo", async () => {
  const { dir } = makeRepo();
  const count = async () => (await log(runner, dir, "::@", 100)).length;
  const before = await count();

  await runOp(runner, dir, { action: "new", params: { onto: "@", message: "work" } });
  await runOp(runner, dir, { action: "describe", params: { change: "@", message: "work renamed" } });
  assert.equal((await count()), before + 1);

  const withFiles = (await log(runner, dir, "::@", 100)).find((commit) => commit.subject === "work renamed");
  assert.ok(withFiles !== undefined);
  await runOp(runner, dir, { action: "split", params: { change: withFiles.changeId, paths: ["c.txt"] } });

  await runOp(runner, dir, { action: "new", params: { onto: "@", message: "top" } });
  await runOp(runner, dir, { action: "squash", params: { from: "@", into: "@-" } });
  await runOp(runner, dir, { action: "duplicate", params: { change: "@-", onto: "@" } });
  await runOp(runner, dir, { action: "bookmark", params: { name: "probe/book", change: "@-" } });

  await runOp(runner, dir, { action: "new", params: { onto: "@", message: "throwaway" } });
  const throwaway = (await log(runner, dir, "::@", 100)).find((commit) => commit.subject === "throwaway");
  assert.ok(throwaway !== undefined);
  await runOp(runner, dir, { action: "abandon", confirm: true, params: { change: throwaway.changeId } });

  const afterAbandon = await count();
  await runOp(runner, dir, { action: "undo", confirm: true });
  const afterUndo = await count();
  assert.ok(afterUndo >= afterAbandon, `undo should restore a commit (${afterAbandon} -> ${afterUndo})`);
});

integration("ops: rebase moves a change onto another parent", async () => {
  const { dir } = makeRepo();
  const commits = await log(runner, dir, "::@", 100);
  const first = commits.find((commit) => commit.subject === "first");
  const second = commits.find((commit) => commit.subject === "second");
  assert.ok(first !== undefined && second !== undefined);
  await runOp(runner, dir, { action: "rebase", params: { change: second.changeId, destination: first.changeId } });
  const after = await log(runner, dir, "::@", 100);
  const moved = after.find((commit) => commit.changeId === second.changeId);
  assert.ok(moved !== undefined);
  assert.ok(moved.parents.includes(first.commitId));
});
