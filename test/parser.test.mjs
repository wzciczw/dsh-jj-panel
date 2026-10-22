import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonObject, parseLog, parseRefs, parseSummary } from "../lib/host/parser.js";

test("parser: log line with a tab inside the description", () => {
  const line = 'abc123456789\tdef123456789\t111111111111 222222222222\tmain,dev\ttag1\ttrue\tfalse\tfalse\tsub\tject\n';
  const [commit] = parseLog(line);
  assert.ok(commit !== undefined);
  assert.equal(commit.changeId, "abc123456789");
  assert.deepEqual(commit.parents, ["111111111111", "222222222222"]);
  assert.deepEqual(commit.bookmarks, ["main", "dev"]);
  assert.deepEqual(commit.tags, ["tag1"]);
  assert.equal(commit.empty, true);
  assert.equal(commit.subject, "sub\tject");
});

test("parser: summary lines and rename targets", () => {
  const files = parseSummary("M .gitignore\nA docs/new.md\nR old/name.md => new/name.md\n");
  assert.deepEqual(files, [
    { status: "M", path: ".gitignore" },
    { status: "A", path: "docs/new.md" },
    { status: "R", path: "new/name.md" }
  ]);
});

test("parser: refs and JSON objects", () => {
  assert.deepEqual(parseRefs("observatory\tabc123\n"), [{ name: "observatory", target: "abc123" }]);
  const value = parseJsonObject('{"change_id":"abc","parents":[]}');
  assert.equal(value.change_id, "abc");
});
