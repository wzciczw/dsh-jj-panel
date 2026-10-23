import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, resolveJjPath } from "../lib/host/jj.js";
import { diff, log, show, snapshot } from "../lib/host/queries.js";
import { isSafePath, isSafeRevset } from "../lib/host/validate.js";

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

function jjrun(args, cwd) {
  execFileSync(jj, ["--no-pager", "--color=never", ...args], { cwd, encoding: "utf8", timeout: 15000 });
}

/** Build a small real repository once: two described changes on top of a root. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-jj-panel-test-"));
  process.env.JJ_USER = "Test User";
  process.env.JJ_EMAIL = "test@example.com";
  jjrun(["git", "init", "--colocate"], dir);
  writeFileSync(join(dir, "a.txt"), "one\n");
  jjrun(["describe", "-m", "first change"], dir);
  jjrun(["new"], dir);
  writeFileSync(join(dir, "b.txt"), "two\n");
  jjrun(["describe", "-m", "second change"], dir);
  return dir;
}

const repo = process.env.JJ_TEST_REPO ?? (hasJj ? makeRepo() : "");
const runner = createRunner(jj, { timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });

integration("host: snapshot resolves the repository root and jj version", async () => {
  const value = await snapshot(runner, repo);
  assert.ok(value.root.length > 0);
  assert.match(value.version, /jj \d+\.\d+/u);
  assert.ok(value.current === null || typeof value.current.changeId === "string");
});

integration("host: log returns commits with change ids and parents", async () => {
  const commits = await log(runner, repo, "::@", 100);
  assert.ok(commits.length >= 2, `expected commits, got ${String(commits.length)}`);
  const first = commits[0];
  assert.ok(first !== undefined);
  assert.match(first.changeId, /^[a-z0-9]+$/u);
  assert.match(first.commitId, /^[0-9a-f]+$/u);
  assert.ok(first.parents.length >= 1);
  const subjects = commits.map((commit) => commit.subject);
  assert.ok(subjects.includes("second change") || subjects.includes("first change"));
});

integration("host: show and diff return files and a git patch", async () => {
  const commits = await log(runner, repo, "::@", 100);
  const target = commits.find((commit) => commit.subject === "second change") ?? commits[0];
  assert.ok(target !== undefined);
  const detail = await show(runner, repo, target.changeId);
  const files = detail.files.map((file) => file.path);
  assert.ok(files.includes("b.txt") || files.includes("a.txt"), `unexpected files: ${files.join(",")}`);
  const file = files.includes("b.txt") ? "b.txt" : "a.txt";
  const patch = await diff(runner, repo, target.changeId, file);
  assert.match(patch.patch, /^diff --git/mu);
  assert.match(patch.patch, new RegExp(`^\\+\\+\\+ b/${file}`, "mu"));
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

test("host: absent repository surfaces as an error, not a crash", async () => {
  if (!hasJj) return;
  const missing = join(tmpdir(), `dsh-jj-panel-missing-${String(Date.now())}`);
  assert.equal(existsSync(missing), false);
  await assert.rejects(() => snapshot(runner, missing));
});
