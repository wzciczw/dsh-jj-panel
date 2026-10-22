import test from "node:test";
import assert from "node:assert/strict";
import { createRunner, resolveJjPath } from "../lib/host/jj.js";
import { diff, log, show, snapshot } from "../lib/host/queries.js";
import { isSafePath, isSafeRevset } from "../lib/host/validate.js";

const repo = process.env.JJ_TEST_REPO ?? "D:\\agent-research";
const runner = createRunner(resolveJjPath(), { timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });

test("host: snapshot resolves the repository root and jj version", async () => {
  const value = await snapshot(runner, repo);
  assert.ok(value.root.length > 0, "root must not be empty");
  assert.match(value.version, /jj \d+\.\d+/u);
  assert.ok(value.current === null || typeof value.current.changeId === "string");
});

test("host: log returns commits with change ids and parents", async () => {
  const commits = await log(runner, repo, "::@", 500);
  assert.ok(commits.length > 10, `expected a populated history, got ${String(commits.length)}`);
  const first = commits[0];
  assert.ok(first !== undefined);
  assert.match(first.changeId, /^[a-z0-9]+$/u);
  assert.match(first.commitId, /^[0-9a-f]+$/u);
  assert.ok(Array.isArray(first.parents));
});

test("host: show and diff work on the gitignore commit", async () => {
  const commits = await log(runner, repo, "::@", 500);
  const target = commits.find((commit) => commit.subject.includes("ignore local scratch"));
  assert.ok(target !== undefined, "fixture commit not found");
  const detail = await show(runner, repo, target.changeId);
  assert.ok(detail.files.some((file) => file.path === ".gitignore"));
  const patch = await diff(runner, repo, target.changeId, ".gitignore");
  assert.match(patch.patch, /^diff --git/mu);
  assert.match(patch.patch, /^\+\+\+ b\/\.gitignore/mu);
});

test("host: revset and path guards reject unsafe input", () => {
  assert.equal(isSafeRevset("::@"), true);
  assert.equal(isSafeRevset("all()"), true);
  assert.equal(isSafeRevset("--config=ui.editor=vim"), false);
  assert.equal(isSafeRevset(""), false);
  assert.equal(isSafePath(".gitignore"), true);
  assert.equal(isSafePath("../escape"), false);
  assert.equal(isSafePath("C:\\Windows"), false);
});
