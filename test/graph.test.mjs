import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { layoutGraph } = require("../lib/client-build/graph.cjs");

test("graph: linear history stays on one lane", () => {
  const rows = layoutGraph([
    { changeId: "a", commitId: "a", parents: ["b"] },
    { changeId: "b", commitId: "b", parents: ["c"] },
    { changeId: "c", commitId: "c", parents: [] }
  ]);
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0]);
});

test("graph: a merge opens a second lane and closes it again", () => {
  const rows = layoutGraph([
    { changeId: "m", commitId: "m", parents: ["a", "b"] },
    { changeId: "a", commitId: "a", parents: ["root"] },
    { changeId: "b", commitId: "b", parents: ["root"] },
    { changeId: "root", commitId: "root", parents: [] }
  ]);
  assert.equal(rows[0].lane, 0);
  assert.equal(rows[1].lane, 0);
  assert.equal(rows[2].lane, 1);
  assert.equal(rows[3].lane, 0);
  assert.ok(rows[0].lanes >= 2);
});

test("graph: an unknown head starts its own lane", () => {
  const rows = layoutGraph([
    { changeId: "x", commitId: "x", parents: [] },
    { changeId: "y", commitId: "y", parents: [] }
  ]);
  assert.deepEqual(rows.map((row) => row.lane), [0, 0]);
});
