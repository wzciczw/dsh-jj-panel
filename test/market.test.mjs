import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMarketIndex } from "@deepseek-ai/dsh-plugin-market-index";

test("market: index.json validates against the official format-1 validator", () => {
  const indexUrl = "https://raw.githubusercontent.com/wzciczw/dsh-jj-panel/master/market/index.json";
  const document = JSON.parse(readFileSync(new URL("../market/index.json", import.meta.url), "utf8"));
  const parsed = parseMarketIndex(document, indexUrl);
  assert.equal(parsed.format, 1);
  assert.equal(parsed.plugins.length, 1);
  const plugin = parsed.plugins[0];
  assert.equal(plugin.name, "dsh-jj-panel");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(plugin.versions[0]?.version, pkg.version);
  assert.equal(plugin.versions[0]?.source.type, "git");
});
