# m-stdlib-vscode — Phase-0 AI-discoverability contract gates.
#
# The VS Code extension build itself runs through npm scripts:
#
#     npm ci          # install vscode + tsc + @types/node
#     npm test        # tsc --noEmit + node --test on tests/*.test.ts
#     npm run compile # tsc -p ./ → out/extension.js
#
# This Makefile only carries the cross-repo gates so verification_commands
# in dist/repo.meta.json line up with the other org repos.

.PHONY: manifest check-manifest check-docs-prose

# ── Phase-0 AI-discoverability contract ───────────────────────────────
#
# Tier-2 entry to the org catalog. See
# https://github.com/m-dev-tools/.github/blob/main/docs/AI-discoverability-plan.md
#
# `dist/extension-info.json` and `dist/repo.meta.json` are hand-authored,
# not regenerated. The source of truth for what they mirror lives in
# `package.json` (version, publisher, engine pin, settings schema,
# marketplace id). When `package.json` changes a mirrored value, update
# the dist file in the same commit (this is captured in AGENTS.md
# § Guardrails).
#
# `make manifest` is therefore a pointer no-op — it exists so
# verification_commands in dist/repo.meta.json line up with other org
# repos that DO have a generator.

manifest:
	@echo "m-stdlib-vscode: dist/extension-info.json is hand-authored alongside package.json."
	@echo "  see AGENTS.md § Build / generate for the rebuild-when-it-changes guardrail."

check-manifest:
	python3 tools/check-manifest.py

# Guardrail: docs/ holds only human-readable prose. Same target name
# as the tier-1 repos so cross-repo muscle memory works.
check-docs-prose:
	@if [ ! -d docs ]; then echo "check-docs-prose: no docs/ directory ✓"; exit 0; fi; \
	violations=$$(find docs -type f \
	    ! -name '*.md' ! -name '*.markdown' \
	    ! -name '*.png' ! -name '*.jpg' ! -name '*.jpeg' \
	    ! -name '*.gif' ! -name '*.svg' ! -name '*.webp' \
	    ! -name '.gitkeep'); \
	if [ -n "$$violations" ]; then \
	  echo "ERROR: non-prose files under docs/ — move to a top-level domain dir:" >&2; \
	  echo "$$violations" >&2; \
	  exit 1; \
	fi; \
	echo "check-docs-prose: docs/ is prose-only ✓"
