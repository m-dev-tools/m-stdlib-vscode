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
 *   4. fall back to the manifest bundled with the extension
 *      (`<extension>/assets/stdlib-manifest.json`) — versioned to the
 *      extension release, so installing the .vsix is enough to get a
 *      working setup with no other repo on disk.
 *
 * Earlier versions fell back to `~/projects/m-stdlib/dist/...`. That
 * coupled the extension to the maintainer's filesystem layout; it was
 * removed in Tier 4 of the m-dev-tools self-containment sprint
 * (2026-05-09). Maintainers who want "live" manifest tracking still
 * point `m-stdlib.manifestPath` or `$M_CLI_MANIFEST` at their
 * checkout's `dist/stdlib-manifest.json`.
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
  /** Used only to expand `~` in `explicit` and `$M_CLI_MANIFEST` paths.
   *  Defaults to `os.homedir()`; tests pass an isolated tmp dir. */
  homeDir?: string;
  /** Final fallback — manifest bundled with the extension at
   *  `<extension>/assets/stdlib-manifest.json`. Defaults to that path
   *  computed via `__dirname` so production callers don't have to
   *  thread it through. Tests pass a non-existent path to exercise
   *  the "nothing resolves" case. */
  bundledManifestPath?: string;
}

/** Path to the manifest bundled with the extension itself. The compiled
 *  module sits in `out/manifest.js`; resolving `..` gets us back to the
 *  extension root, where `assets/stdlib-manifest.json` lives. The same
 *  expression resolves correctly when imported from compiled JS during
 *  normal extension activation.
 *
 *  Computed lazily because `__dirname` only exists in CommonJS scope —
 *  in tests, Node's `--experimental-strip-types` loads this `.ts` file
 *  as an ES module where `__dirname` is `ReferenceError`. The `typeof`
 *  guard makes module evaluation safe in both modes; tests pass an
 *  explicit `bundledManifestPath`, so the ESM branch never has to
 *  produce a real path.
 */
export function defaultBundledManifestPath(): string {
  if (typeof __dirname !== "undefined") {
    return path.resolve(__dirname, "..", "assets", "stdlib-manifest.json");
  }
  // ESM-only path (tests). Return a sentinel that safeIsFile() will reject.
  return "";
}

/** Resolve the path to the manifest per the discovery order in the
 *  module docstring. Returns null when no candidate is reachable.
 */
export function findManifest(opts: ResolveOptions = {}): string | null {
  const {
    explicit,
    env = process.env,
    workspaceFolders = [],
    homeDir = os.homedir(),
    bundledManifestPath = defaultBundledManifestPath(),
  } = opts;

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

  return safeIsFile(bundledManifestPath) ? bundledManifestPath : null;
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
