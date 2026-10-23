import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, resolveJjPath } from "../lib/host/jj.js";
import { buildOpArgv, buildOpSteps, runOp } from "../lib/host/ops.js";
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
  const run = (args) =>
    execFileSync(jj, ["--no-pager", "--color=never", ...args], { cwd: dir, encoding: "utf8", timeout: 15000 });
  run(["git", "init", "--colocate"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(["describe", "-m", "first"]);
  run(["new", "--message=second"]);
  writeFileSync(join(dir, "b.txt"), "two\n");
  writeFileSync(join(dir, "c.txt"), "three\n");
  return { dir, run };
}

test("ops: argv plan covers every action", () => {
  assert.deepEqual(buildOpSteps({ action: "new", params: { onto: "@", message: "msg" } }), [
    ["new", "@", "--message=msg"]
  ]);
  assert.deepEqual(buildOpSteps({ action: "edit", params: { change: "abc" } }), [["edit", "abc"]]);
  assert.deepEqual(buildOpSteps({ action: "describe", params: { change: "@", message: "x" } }), [
    ["describe", "-r", "@", "--message=x"]
  ]);
  assert.deepEqual(buildOpSteps({ action: "squash", params: { from: "@", into: "@-" } }), [
    ["squash", "--from", "@", "--into", "@-", "-u"]
  ]);
  assert.deepEqual(
    buildOpSteps({ action: "abandon", confirm: true, params: { change: "abc", subtree: true } }),
    [["abandon", "abc::"]]
  );
  assert.deepEqual(buildOpSteps({ action: "duplicate", params: { change: "abc", onto: "@-" } }), [
    ["duplicate", "abc", "--onto", "@-"]
  ]);
  assert.deepEqual(
    buildOpSteps({ action: "revert", confirm: true, params: { change: "abc" } }),
    [["revert", "-r", "abc", "--insert-before", "@"]]
  );
  assert.deepEqual(buildOpSteps({ action: "rebase", params: { change: "abc", destination: "@" } }), [
    ["rebase", "-r", "abc", "--onto", "@"]
  ]);
  assert.deepEqual(
    buildOpSteps({ action: "rebase", params: { change: "abc", destination: "@", mode: "before" } }),
    [["rebase", "-r", "abc", "--insert-before", "@"]]
  );
  assert.deepEqual(buildOpSteps({ action: "split", params: { change: "@", paths: ["a.txt"] } }), [
    ["new"],
    ["squash", "--from", "@-", "--into", "@", "-u", "--", "a.txt"],
    ["describe", "-r", "@", "--message=split"]
  ]);
  assert.deepEqual(buildOpSteps({ action: "undo", confirm: true }), [["undo"]]);
  assert.deepEqual(buildOpSteps({ action: "fetch" }), [["git", "fetch"]]);
  assert.deepEqual(buildOpSteps({ action: "bookmark", params: { name: "feat/x", change: "@" } }), [
    ["bookmark", "set", "feat/x", "-r", "@"]
  ]);
  assert.deepEqual(buildOpSteps({ action: "push", confirm: true, params: { name: "feat/x" } }), [
    ["git", "push", "--bookmark", "feat/x"]
  ]);
  assert.deepEqual(buildOpArgv({ action: "fetch" }), ["git", "fetch"]);
});

test("ops: destructive actions require confirmation and inputs are validated", () => {
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
      codeOf(() => buildOpSteps({ action, params: { change: "@", destination: "@", name: "x" } })),
      "confirmation-required",
      action
    );
  }
  assert.equal(codeOf(() => buildOpSteps({ action: "nope" })), "unknown-action");
  assert.equal(codeOf(() => buildOpSteps({ action: "new", params: { onto: "--config=x" } })), "invalid-revset");
  assert.equal(codeOf(() => buildOpSteps({ action: "split", params: { change: "@", paths: ["../x"] } })), "invalid-path");
  assert.equal(codeOf(() => buildOpSteps({ action: "split", params: { change: "@", paths: ["-rf"] } })), "invalid-path");
  assert.equal(
    codeOf(() => buildOpSteps({ action: "bookmark", params: { name: "-bad", change: "@" } })),
    "invalid-bookmark"
  );
  assert.equal(codeOf(() => buildOpSteps({ action: "edit", params: { change: "all()" } })), "invalid-change");
});

integration("ops: split moves the ticked files into a new child change", async () => {
  const { dir } = makeRepo();
  const before = await log(runner, dir, "::@", 100);
  const current = before.find((commit) => commit.subject === "second");
  assert.ok(current !== undefined);

  await runOp(runner, dir, {
    action: "split",
    params: { change: current.changeId, paths: ["c.txt"], message: "split c" }
  });

  const after = await log(runner, dir, "::@", 100);
  assert.equal(after.length, before.length + 1);
  const child = after.find((commit) => commit.subject === "split c");
  const parent = after.find((commit) => commit.changeId === current.changeId);
  assert.ok(child !== undefined && parent !== undefined);
  assert.ok(child.parents.includes(parent.commitId), "split child must be a child of the original");
  assert.equal(parent.subject, "second", "the original keeps its description");

  const files = (changeId) =>
    execFileSync(jj, ["--no-pager", "diff", "-r", changeId, "--summary"], { cwd: dir, encoding: "utf8" })
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => line.slice(1).trim());
  assert.deepEqual(files(child.changeId), ["c.txt"]);
  assert.deepEqual(files(parent.changeId), ["b.txt"]);
});

integration("ops: rebase moves a change under a different parent", async () => {
  const { dir, run } = makeRepo();
  run(["new", "--message=side", "@-"]); // child of first, sibling of second
  run(["new", "--message=leaf"]);
  writeFileSync(join(dir, "d.txt"), "four\n");
  const commits = await log(runner, dir, "::@", 100);
  const leaf = commits.find((commit) => commit.subject === "leaf");
  const first = commits.find((commit) => commit.subject === "first");
  assert.ok(leaf !== undefined && first !== undefined);

  await runOp(runner, dir, { action: "rebase", params: { change: leaf.changeId, destination: first.changeId } });
  const after = await log(runner, dir, "::@", 100);
  const moved = after.find((commit) => commit.changeId === leaf.changeId);
  assert.ok(moved !== undefined);
  assert.ok(moved.parents.includes(first.commitId));
});

integration("ops: abandon and undo restore the exact commit count", async () => {
  const { dir } = makeRepo();
  const before = (await log(runner, dir, "::@", 100)).length;
  const commits = await log(runner, dir, "::@", 100);
  const target = commits.find((commit) => commit.subject === "first");
  assert.ok(target !== undefined);
  await runOp(runner, dir, { action: "abandon", confirm: true, params: { change: target.changeId } });
  assert.equal((await log(runner, dir, "::@", 100)).length, before - 1);
  await runOp(runner, dir, { action: "undo", confirm: true });
  assert.equal((await log(runner, dir, "::@", 100)).length, before);
});

integration("ops: revert inserts a visible change before @", async () => {
  const { dir } = makeRepo();
  const commits = await log(runner, dir, "::@", 100);
  const first = commits.find((commit) => commit.subject === "first");
  assert.ok(first !== undefined);
  await runOp(runner, dir, { action: "revert", confirm: true, params: { change: first.changeId } });
  const after = await log(runner, dir, "::@", 100);
  assert.ok(after.some((commit) => commit.subject.startsWith("Revert")), "revert commit must stay in ::@");
});
