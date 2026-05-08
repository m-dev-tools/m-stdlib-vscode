/**
 * Unit tests for src/tokens.ts.
 *
 * Run via `npm test` — the script invokes `node --test
 * --experimental-strip-types` so TypeScript files run directly
 * without a separate compile step. Pure logic only; nothing in
 * here imports vscode.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { labelPrefixAt, modulePrefixAt, tokenAt } from "../src/tokens.ts";

describe("tokenAt", () => {
  it("matches bare module reference `^STDJSON`", () => {
    const line = "  zwrite ^STDJSON";
    const tok = tokenAt(line, line.indexOf("^") + 1);
    assert.ok(tok);
    assert.equal(tok.kind, "module");
    assert.equal(tok.module, "STDJSON");
    assert.equal(tok.label, "");
    assert.equal(tok.isExtrinsic, false);
  });

  it("matches `label^STDJSON`", () => {
    const line = '  do parse^STDJSON("[1]",.t)';
    const tok = tokenAt(line, line.indexOf("^"));
    assert.ok(tok);
    assert.equal(tok.kind, "label");
    assert.equal(tok.module, "STDJSON");
    assert.equal(tok.label, "parse");
    assert.equal(tok.isExtrinsic, false);
  });

  it("flags `$$label^STDJSON` as extrinsic", () => {
    const line = '  set rc=$$parse^STDJSON("[1]",.t)';
    const tok = tokenAt(line, line.indexOf("parse"));
    assert.ok(tok);
    assert.equal(tok.kind, "label");
    assert.equal(tok.module, "STDJSON");
    assert.equal(tok.label, "parse");
    assert.equal(tok.isExtrinsic, true);
  });

  it("returns null for non-STD modules", () => {
    const line = "  do foo^MYAPP";
    const tok = tokenAt(line, line.indexOf("^"));
    assert.equal(tok, null);
  });

  it("returns null when cursor isn't near a `^`", () => {
    const line = "  set x=1";
    assert.equal(tokenAt(line, 5), null);
  });

  it("recognises module on cursor inside the module name", () => {
    const line = "  do parse^STDJSON()";
    // Cursor in the middle of "STDJSON".
    const tok = tokenAt(line, line.indexOf("^") + 4);
    assert.ok(tok);
    assert.equal(tok.module, "STDJSON");
    assert.equal(tok.kind, "label");
  });

  it("emits inclusive start, exclusive end column extents", () => {
    const line = "  do parse^STDJSON()";
    const tok = tokenAt(line, line.indexOf("^"));
    assert.ok(tok);
    assert.equal(line.slice(tok.startCol, tok.endCol), "parse^STDJSON");
  });
});

describe("modulePrefixAt", () => {
  it("returns prefix for `^STD`", () => {
    const line = "  do ^STD";
    assert.equal(modulePrefixAt(line, line.length), "STD");
  });

  it("returns empty string for bare `^`", () => {
    const line = "  do ^";
    assert.equal(modulePrefixAt(line, line.length), "");
  });

  it("returns null when prefix doesn't start with `S`", () => {
    const line = "  do ^FO";
    assert.equal(modulePrefixAt(line, line.length), null);
  });

  it("returns null when there's no `^` to the left", () => {
    const line = "  STD";
    assert.equal(modulePrefixAt(line, line.length), null);
  });
});

describe("labelPrefixAt", () => {
  it("recognises `parse^STDJSON` with cursor inside `parse`", () => {
    const line = "  do parse^STDJSON";
    const info = labelPrefixAt(line, line.indexOf("parse") + 3);
    assert.ok(info);
    assert.equal(info.module, "STDJSON");
    assert.equal(info.labelPrefix, "par");
  });

  it("returns null when cursor is past the `^`", () => {
    const line = "  do parse^STDJSON";
    assert.equal(labelPrefixAt(line, line.indexOf("^") + 1), null);
  });

  it("returns empty labelPrefix when cursor is at the start of label-region", () => {
    const line = "  do ^STDJSON";
    // Cursor immediately before `^` — labelPrefix should be empty.
    const info = labelPrefixAt(line, line.indexOf("^"));
    assert.ok(info);
    assert.equal(info.module, "STDJSON");
    assert.equal(info.labelPrefix, "");
  });
});
