/**
 * Manifest discovery + JSON loading for the m-stdlib VS Code extension.
 *
 * Mirrors the discovery logic in m-cli's `src/m_cli/doc/lookup.py` so
 * the editor extension and the CLI share one mental model:
 *
 *   1. user setting `m-stdlib.manifestPath`        (explicit override)
 *   2. environment variable `M_CLI_MANIFEST`        (CI / scripted)
 *   3. walk up from the workspace folder looking
 *      for `dist/stdlib-manifest.json`              (in-tree checkout)
 *   4. fall back to `~/projects/m-stdlib/dist/stdlib-manifest.json`
 *
 * The result is cached on first successful load and invalidated when
 * the manifest file's mtime changes — see `loadManifest()`.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Schema mirror of dist/stdlib-manifest.json. Keep in sync with
 *  m-stdlib/tools/gen-manifest.py — not every field is consumed by
 *  the extension, but typing the whole shape keeps providers honest. */
export interface ManifestParam {
  name: string;
  type: string;
  doc: string;
}

export interface ManifestRaise {
  code: string;
  doc: string;
}

export interface ManifestSource {
  file: string;
  line: number;
}

export interface ManifestLabel {
  form?: "extrinsic" | "procedure";
  signature: string;
  synopsis: string;
  params?: ManifestParam[];
  returns?: { type: string; doc: string } | null;
  raises?: ManifestRaise[];
  raised_in_body?: string[];
  examples?: string[];
  since?: string;
  stable?: string;
  see_also?: string[];
  deprecated?: string;
  description?: string;
  source: ManifestSource;
}

export interface ManifestModule {
  synopsis: string;
  description?: string;
  errors?: string[];
  labels: { [labelName: string]: ManifestLabel };
  source: ManifestSource;
}

export interface Manifest {
  stdlib_version: string;
  modules: { [moduleName: string]: ManifestModule };
  errors: { [code: string]: { module: string; labels: string[] } };
}

/** Walk up from `start` looking for `dist/stdlib-manifest.json`. Stop at
 *  the filesystem root. Returns null if no candidate matches.
 */
function walkUp(start: string): string | null {
  let cur = path.resolve(start);
  // Cap at a few hundred iterations as a safety belt against symlink
  // loops; real filesystems never get that deep.
  for (let i = 0; i < 256; i++) {
    const candidate = path.join(cur, "dist", "stdlib-manifest.json");
    if (safeIsFile(candidate)) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

function safeIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export interface ResolveOptions {
  /** Empty / undefined = no explicit override. */
  explicit?: string;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Workspace folder(s) the editor knows about. The first folder
   *  whose tree contains `dist/stdlib-manifest.json` wins. */
  workspaceFolders?: string[];
  /** Defaults to `os.homedir()` — overridable in tests. */
  homeDir?: string;
}

/** Resolve the path to the manifest per the discovery order in the
 *  module docstring. Returns null when no candidate is reachable.
 */
export function findManifest(opts: ResolveOptions = {}): string | null {
  const { explicit, env = process.env, workspaceFolders = [], homeDir = os.homedir() } = opts;

  if (explicit && explicit.trim() !== "") {
    const expanded = explicit.startsWith("~")
      ? path.join(homeDir, explicit.slice(1))
      : explicit;
    return safeIsFile(expanded) ? expanded : null;
  }

  const envPath = env.M_CLI_MANIFEST;
  if (envPath && envPath.trim() !== "") {
    const expanded = envPath.startsWith("~")
      ? path.join(homeDir, envPath.slice(1))
      : envPath;
    if (safeIsFile(expanded)) return expanded;
  }

  for (const folder of workspaceFolders) {
    const hit = walkUp(folder);
    if (hit !== null) return hit;
  }

  const fallback = path.join(homeDir, "projects", "m-stdlib", "dist", "stdlib-manifest.json");
  return safeIsFile(fallback) ? fallback : null;
}

/** mtime + path combine into a cache key — cheap enough that we can
 *  re-check on every provider invocation. The full re-parse only runs
 *  when the user has regenerated the manifest. */
let _cachedPath: string | null = null;
let _cachedMtimeMs = 0;
let _cachedManifest: Manifest | null = null;

/** Load (and cache) the manifest at `manifestPath`. Throws on read /
 *  parse failure. Callers should display the error in the VS Code UI. */
export function loadManifest(manifestPath: string): Manifest {
  const stat = fs.statSync(manifestPath);
  if (
    _cachedManifest !== null &&
    _cachedPath === manifestPath &&
    _cachedMtimeMs === stat.mtimeMs
  ) {
    return _cachedManifest;
  }
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const parsed = JSON.parse(raw) as Manifest;
  _cachedPath = manifestPath;
  _cachedMtimeMs = stat.mtimeMs;
  _cachedManifest = parsed;
  return parsed;
}

/** Invalidate the cache. Tests use this; the production code path
 *  relies on mtime-based invalidation in `loadManifest()`. */
export function clearManifestCache(): void {
  _cachedPath = null;
  _cachedMtimeMs = 0;
  _cachedManifest = null;
}
