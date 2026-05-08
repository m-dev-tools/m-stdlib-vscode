/**
 * Unit tests for src/manifest.ts — discovery + cache invalidation.
 *
 * No vscode import; pure filesystem logic.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  clearManifestCache,
  findManifest,
  loadManifest,
} from "../src/manifest.ts";

let tmpRoot = "";

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m-stdlib-vscode-test-"));
  clearManifestCache();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("findManifest", () => {
  it("walks up from a workspace folder", () => {
    const distDir = path.join(tmpRoot, "dist");
    fs.mkdirSync(distDir);
    const target = path.join(distDir, "stdlib-manifest.json");
    fs.writeFileSync(target, "{}");
    const deep = path.join(tmpRoot, "a", "b", "c");
    fs.mkdirSync(deep, { recursive: true });
    const resolved = findManifest({
      workspaceFolders: [deep],
      env: {},
      homeDir: "/nonexistent",
    });
    assert.equal(resolved, target);
  });

  it("explicit override wins over walk-up", () => {
    const elsewhere = path.join(tmpRoot, "alt.json");
    fs.writeFileSync(elsewhere, "{}");
    const distDir = path.join(tmpRoot, "dist");
    fs.mkdirSync(distDir);
    fs.writeFileSync(
      path.join(distDir, "stdlib-manifest.json"),
      '{"would-not-be-picked":true}'
    );
    const resolved = findManifest({
      explicit: elsewhere,
      workspaceFolders: [tmpRoot],
      env: {},
      homeDir: "/nonexistent",
    });
    assert.equal(resolved, elsewhere);
  });

  it("env var overrides walk-up but loses to explicit", () => {
    const envTarget = path.join(tmpRoot, "env.json");
    fs.writeFileSync(envTarget, "{}");
    const distDir = path.join(tmpRoot, "dist");
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, "stdlib-manifest.json"), "{}");
    const viaEnv = findManifest({
      env: { M_CLI_MANIFEST: envTarget },
      workspaceFolders: [tmpRoot],
      homeDir: "/nonexistent",
    });
    assert.equal(viaEnv, envTarget);
  });

  it("returns null when nothing resolves", () => {
    const r = findManifest({
      workspaceFolders: [tmpRoot],
      env: {},
      homeDir: "/nonexistent",
    });
    assert.equal(r, null);
  });

  it("expands `~` in explicit path", () => {
    const homeDir = tmpRoot;
    const target = path.join(tmpRoot, "manifest.json");
    fs.writeFileSync(target, "{}");
    const r = findManifest({
      explicit: "~/manifest.json",
      env: {},
      homeDir,
    });
    assert.equal(r, target);
  });
});

describe("loadManifest", () => {
  it("parses and returns a manifest", () => {
    const target = path.join(tmpRoot, "m.json");
    fs.writeFileSync(target, JSON.stringify({ stdlib_version: "v0.5.0", modules: {}, errors: {} }));
    const manifest = loadManifest(target);
    assert.equal(manifest.stdlib_version, "v0.5.0");
  });

  it("returns the same object on repeat reads (cache)", () => {
    const target = path.join(tmpRoot, "m.json");
    fs.writeFileSync(target, JSON.stringify({ stdlib_version: "v0.5.0", modules: {}, errors: {} }));
    const a = loadManifest(target);
    const b = loadManifest(target);
    assert.equal(a, b);
  });

  it("re-reads when mtime changes", () => {
    const target = path.join(tmpRoot, "m.json");
    fs.writeFileSync(target, JSON.stringify({ stdlib_version: "v0.5.0", modules: {}, errors: {} }));
    const a = loadManifest(target);
    // Touch with a later mtime.
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(target, future, future);
    fs.writeFileSync(
      target,
      JSON.stringify({ stdlib_version: "v0.6.0", modules: {}, errors: {} })
    );
    const b = loadManifest(target);
    assert.notEqual(a, b);
    assert.equal(b.stdlib_version, "v0.6.0");
  });
});
