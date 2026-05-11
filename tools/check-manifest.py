#!/usr/bin/env python3
"""Phase-0 contract gate for dist/repo.meta.json.

Validates that:
  1. dist/repo.meta.json parses as JSON.
  2. Required fields from the org-level repo.meta.schema.json contract
     are present.
  3. Each path under `exposes.*` resolves on disk.
  4. (Best-effort) full schema validation if jsonschema is available
     and the canonical schema URL is reachable.

Exits 0 on success; non-zero with structured stderr on failure.

Engine-free, no Node, no Python deps beyond the standard library
unless jsonschema happens to be installed.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

MANIFEST = Path("dist/repo.meta.json")

REQUIRED_FIELDS = (
    "id",
    "repo",
    "role",
    "language",
    "license",
    "agent_instructions",
    "verified_on",
    "exposes",
    "verification_commands",
)


def main() -> int:
    if not MANIFEST.exists():
        print(f"ERROR: {MANIFEST} not found", file=sys.stderr)
        return 1

    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"ERROR: {MANIFEST} is invalid JSON: {exc}", file=sys.stderr)
        return 1

    missing = [f for f in REQUIRED_FIELDS if f not in data]
    if missing:
        print(f"ERROR: missing required fields: {missing}", file=sys.stderr)
        return 1

    fail = False
    for key, rel_path in data["exposes"].items():
        if rel_path.startswith(("http://", "https://")):
            continue
        if not Path(rel_path).exists():
            print(
                f"ERROR: exposes.{key} payload missing on disk: {rel_path}",
                file=sys.stderr,
            )
            fail = True
    if fail:
        return 1

    # Best-effort full schema validation. Skipped silently if jsonschema
    # isn't available (the canonical Track-A validator runs in the org
    # smoke test against the same manifest).
    try:
        from jsonschema import Draft202012Validator  # type: ignore
    except ImportError:
        print(
            "check-manifest: dist/repo.meta.json valid; "
            "all exposes.* present ✓ (jsonschema not installed — "
            "skipping full schema validation)"
        )
        return 0

    schema_uri = data.get("$schema", "")
    try:
        with urllib.request.urlopen(schema_uri, timeout=5) as resp:
            schema = json.load(resp)
    except Exception as exc:  # noqa: BLE001
        print(
            f"check-manifest: dist/repo.meta.json valid; all exposes.* "
            f"present ✓ (skipped live schema fetch: {exc})"
        )
        return 0

    errors = list(Draft202012Validator(schema).iter_errors(data))
    if errors:
        for err in errors:
            path = "/".join(str(p) for p in err.absolute_path) or "<root>"
            print(f"SCHEMA ERROR at {path}: {err.message}", file=sys.stderr)
        return 1

    print(
        "check-manifest: dist/repo.meta.json valid against org schema; "
        "all exposes.* present ✓"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
