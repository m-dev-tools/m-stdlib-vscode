/**
 * Pin the snippet pack's shape — guards against typos and against
 * the package.json contribution drifting away from the JSON file.
 *
 * The snippet bodies are validated structurally (every snippet has
 * a non-empty body array; every line is a string; the prefix matches
 * the WC2 plan §5.1 spec). We do NOT assert byte-for-byte equality
 * because the prose strings are expected to evolve; the test instead
 * locks the snippet *names* the discoverability tracker WC2 row
 * promises.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

interface Snippet {
  prefix: string;
  scope?: string;
  description?: string;
  body: string[];
}

function loadSnippets(): { [name: string]: Snippet } {
  const text = fs.readFileSync(
    path.join(repoRoot, "snippets", "m.json"),
    "utf-8"
  );
  return JSON.parse(text);
}

function loadPackageJson(): {
  contributes?: { snippets?: { language: string; path: string }[] };
} {
  const text = fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8");
  return JSON.parse(text);
}

describe("snippet pack", () => {
  it("ships the four canonical-pattern triggers from WC2", () => {
    const snippets = loadSnippets();
    const prefixes = new Set(Object.values(snippets).map((s) => s.prefix));
    assert.ok(prefixes.has("stdassert-suite"), "stdassert-suite present");
    assert.ok(prefixes.has("stdfix-with"), "stdfix-with present");
    assert.ok(prefixes.has("stdlog-kv"), "stdlog-kv present");
    assert.ok(prefixes.has("stdjson-parse"), "stdjson-parse present");
  });

  it("scopes every snippet to the m language", () => {
    const snippets = loadSnippets();
    for (const [name, snip] of Object.entries(snippets)) {
      assert.equal(snip.scope, "m", `${name} scope=m`);
    }
  });

  it("has a non-empty body array of strings for each snippet", () => {
    const snippets = loadSnippets();
    for (const [name, snip] of Object.entries(snippets)) {
      assert.ok(Array.isArray(snip.body), `${name} body is array`);
      assert.ok(snip.body.length > 0, `${name} body non-empty`);
      for (const line of snip.body) {
        assert.equal(typeof line, "string", `${name} body line is string`);
      }
    }
  });

  it("every snippet body references a real m-stdlib symbol", () => {
    // Sanity check that the prefix → body mapping is correct: each
    // snippet's body should contain at least one reference to the
    // stdlib module the prefix names. Catches "I copied the wrong
    // body into the wrong snippet" mistakes.
    const snippets = loadSnippets();
    const expected: { [prefix: string]: string } = {
      "stdassert-suite": "STDASSERT",
      "stdfix-with": "STDFIX",
      "stdlog-kv": "STDLOG",
      "stdjson-parse": "STDJSON",
    };
    for (const snip of Object.values(snippets)) {
      const wantModule = expected[snip.prefix];
      if (!wantModule) continue;
      const joined = snip.body.join("\n");
      assert.ok(
        joined.includes(wantModule),
        `${snip.prefix} should reference ${wantModule}`
      );
    }
  });

  it("package.json contributes the snippets file", () => {
    const pkg = loadPackageJson();
    const contrib = pkg.contributes?.snippets ?? [];
    assert.ok(contrib.length >= 1, "snippets contribution registered");
    const m = contrib.find((s) => s.language === "m");
    assert.ok(m, "snippets contribution scopes to language=m");
    const resolved = path.resolve(repoRoot, m.path);
    assert.ok(fs.existsSync(resolved), `${m.path} exists on disk`);
  });
});
