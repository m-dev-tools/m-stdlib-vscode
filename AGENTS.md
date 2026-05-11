---
# Machine-readable project descriptor — schema v1 (2026-05-05).
name: m-stdlib-vscode
kind: [editor-extension, language-tooling]
status: active
languages: [typescript]

distribution:
  github: m-dev-tools/m-stdlib-vscode
  marketplace_id: rafael5.m-stdlib-vscode

location: ~/m-dev-tools/m-stdlib-vscode

exposes:
  extension_info: "dist/extension-info.json"
  package_json:   "package.json"
  snippets:       "snippets/m.json"
  bundled_manifest: "assets/stdlib-manifest.json (snapshot of m-stdlib/dist/stdlib-manifest.json, refreshed at release time)"

consumes:
  formats:
    - "m-stdlib/dist/stdlib-manifest.json (schema v1)"
  services: []
  upstream_data:
    - "m-stdlib — runtime input: hover docs, goto-def line numbers, completion lists all come from the resolved stdlib-manifest.json"

companions:
  - project: m-stdlib
    relation: "primary input — the manifest this extension reads is m-stdlib's `make manifest` output; m-stdlib has architectural priority"
  - project: m-cli
    relation: "shares the `$M_CLI_MANIFEST` env var as a discovery hint; if a user has m-cli set up, the extension picks up the same manifest without per-workspace config"
  - project: tree-sitter-m-vscode
    relation: "sibling editor extension — different concern (syntax highlighting via tree-sitter); both extensions co-exist in a `.m` buffer without conflict"

incompatibilities:
  - "Not a full M language server. Scope is exactly the m-stdlib public surface (`STD*` modules + their public labels); non-stdlib symbols are deliberately left alone."
  - "Not a syntax highlighter. That's tree-sitter-m-vscode."
  - "ObjectScript out of scope — M only."

docs:
  primary: README.md
---

# m-stdlib-vscode — Claude project context

VS Code extension that surfaces m-stdlib's `dist/stdlib-manifest.json`
as hover docs, goto-definition, and completion inside any open `.m`
file. The manifest is the single source of truth; this extension is a
thin presentation layer over it.

The full design rationale, manifest-discovery order, and per-feature
behaviour is in `README.md`.

## What this is

- A VS Code extension (`rafael5.m-stdlib-vscode`) that registers
  hover, definition, and completion providers for the `m` language.
- A manifest reader: at activation it walks a documented discovery
  order to resolve `dist/stdlib-manifest.json`, then watches the
  resolved file for changes and rebuilds its in-memory index on save.
- A snippet pack (`snippets/m.json`) for the canonical m-stdlib
  idioms (the same set documented in m-stdlib's how-to guides).
- A bundled manifest snapshot (`assets/stdlib-manifest.json`) so the
  extension works on a stock install with no other repo on disk;
  refreshed at release time by copying m-stdlib's `dist/stdlib-manifest.json`.

## What this is NOT

- A full M (MUMPS) language server. Non-`STD*` symbols are out of scope.
- A syntax highlighter. The TextMate / tree-sitter grammar that
  tokenises `.m` files lives in **tree-sitter-m-vscode**; the two
  extensions are deliberately independent so a user can install either
  one without the other.
- A linter. M linting belongs to `m-cli`.
- A test runner. M testing belongs to `m-cli` + `m-test-engine`.
- A regenerator of m-stdlib's manifest. The manifest is produced by
  `make manifest` in `m-stdlib`; this extension only reads it.

## Setup

```bash
npm ci                       # install vscode + tsc + @types/node
```

Node ≥ 18 is required for the TypeScript build. No M toolchain
required — the manifest is read as JSON and the extension never
shells out to YottaDB / IRIS.

## Test

```bash
npm test                     # tsc --noEmit + node --test on tests/*.test.ts
```

The `npm test` script runs `tsc -p ./ --noEmit` (full type-check of
`src/` and `tests/`) followed by `node --test --experimental-strip-types tests/*.test.ts`
(unit tests for the manifest resolver, token recogniser, and snippet
schema). No VS Code instance is launched; the tests exercise the pure
TypeScript modules in isolation.

## Build / generate

```bash
npm run compile              # tsc -p ./ → out/extension.js
npm run watch                # tsc -watch (development host loop)
```

The `out/` directory is the VS Code runtime entry point (`main` in
`package.json`). It is gitignored — published `.vsix` packages
include it via `npm run vscode:prepublish`.

The `dist/` directory in this repo is separate from `out/` and is
**not** a TypeScript build output. `dist/extension-info.json` and
`dist/repo.meta.json` are hand-authored Phase-0 contract payloads
that describe the extension to the org-level AI-discoverability
catalog. When `package.json` changes a value referenced by
`dist/extension-info.json` (version, publisher, engine pin, settings
schema), update the dist file in the same commit — the
`check-manifest` gate only verifies the dist file exists, not that it
agrees with `package.json`, so drift is on the author.

## Verify

The `verification_commands` declared in `dist/repo.meta.json`:

```bash
make check-manifest          # dist/repo.meta.json valid + exposes.* paths exist
```

Cross-repo guardrail:

```bash
make check-docs-prose        # docs/ holds only prose (this repo has no docs/ at all)
```

## Guardrails

- **Do not hand-edit `dist/extension-info.json` to disagree with
  `package.json`.** The dist file is hand-authored, but it's a mirror
  of `package.json` (version, publisher, engine pin, settings keys,
  marketplace id). When `package.json` changes a mirrored value,
  update the dist file in the same commit.
- **The manifest-discovery order is contract.** Consumers
  (m-stdlib's docs, m-cli's `--manifest` flag, the bundled-manifest
  fallback story) reference the four-step order: setting →
  `$M_CLI_MANIFEST` → workspace walk-up → bundled assets. Reordering
  or removing a step is a breaking change requiring coordinated docs
  updates in m-stdlib.
- **`m-stdlib` has architectural priority over `m-stdlib-vscode`.**
  This extension is a downstream consumer of m-stdlib's manifest
  schema. If a needed manifest field is missing, propose adding it
  to m-stdlib first; do not synthesise it client-side.
- **Do not expand scope beyond `STD*`.** A "full M language server"
  is out of scope and would conflict with tree-sitter-m-vscode and
  any future m-cli LSP work. Hover / goto-def / completion stay
  scoped to symbols the manifest knows about; everything else is
  passed through to other providers.
- **Do not hand-edit `dist/repo.meta.json` `verified_on` to a future
  date.** The org smoke test rejects manifests older than 90 days;
  bump the date only when the manifest changes materially (new
  exposes payload, version bump, publisher change).
- **Bundled `assets/stdlib-manifest.json` is a release-time snapshot,
  not a live artefact.** Do not regenerate it from a local m-stdlib
  checkout outside a release flow — that would silently desync
  installed users from what their `m-stdlib.manifestPath` setting
  resolves to. Refresh it only when bumping the extension version.
