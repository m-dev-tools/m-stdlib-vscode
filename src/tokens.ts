/**
 * M-source token classification for the providers.
 *
 * The extension recognises three forms of STD* reference at a cursor
 * position:
 *
 *   1. ``^STDJSON``               — bare module reference (e.g. inside
 *                                   ``zwrite ^STDJSON``)
 *   2. ``label^STDJSON``          — qualified label call
 *                                   (``do parse^STDJSON(...)``)
 *   3. ``$$label^STDJSON``        — extrinsic-function form
 *                                   (``$$parse^STDJSON(...)``)
 *
 * `tokenAt(line, col)` parses any of these into a `TokenRef` describing
 * what was matched and its character extents on the line. Providers
 * use the extents to anchor hover hits / jump targets / replacement
 * ranges for completions.
 *
 * The classifier is intentionally text-based — the extension does not
 * spawn tree-sitter-m. v1's scope is "stdlib symbols only" per the
 * discoverability plan §5.1; richer parsing waits for a real M LSP.
 */

export type TokenKind = "module" | "label";

export interface TokenRef {
  /** What kind of reference matched at the cursor. */
  kind: TokenKind;
  /** Module name (always uppercase ``STD*``). */
  module: string;
  /** Label name when kind = "label"; empty when kind = "module". */
  label: string;
  /** Whether the match started with ``$$`` (extrinsic-function form).
   *  Surface signal only; doesn't affect resolution. */
  isExtrinsic: boolean;
  /** 0-based start column of the matched span (inclusive). */
  startCol: number;
  /** 0-based end column of the matched span (exclusive). */
  endCol: number;
}

/** Recognise:
 *    optional `$$` prefix
 *    optional `<labelName>` (alphanumeric, must start with a letter)
 *    `^`
 *    `<MODULE>` (one of `STD[A-Z0-9]+`)
 *
 *  Both forms — bare `^STDJSON` and `label^STDJSON` — share the trailing
 *  `^STDXXX` anchor; we scan outward from the `^` char that contains the
 *  cursor (or the nearest one to the cursor's right).
 */
const STD_MODULE_RE = /^STD[A-Z0-9]{1,30}$/;
const LABEL_NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;

export function tokenAt(line: string, col: number): TokenRef | null {
  // Find a `^` near the cursor. The cursor can be anywhere inside the
  // token; try the `^` to the right first (covers `^STD<cursor>JSON`),
  // then the one to the left (covers `STDJSON<cursor>`).
  const caretPos = locateCaret(line, col);
  if (caretPos === -1) return null;

  // Module name is the run of A-Z0-9 starting just after `^`. Anchor
  // it with STD* — we ignore non-stdlib `^FOO` references.
  const modStart = caretPos + 1;
  let modEnd = modStart;
  while (modEnd < line.length && isModuleChar(line[modEnd]!)) modEnd++;
  const module = line.slice(modStart, modEnd);
  if (!STD_MODULE_RE.test(module)) return null;

  // Optional `label` to the left of `^`. We walk backwards over A-Za-z0-9
  // (label names start with a letter) but stop before any other punctuation.
  let labelEnd = caretPos;
  let labelStart = caretPos;
  while (labelStart > 0 && isLabelChar(line[labelStart - 1]!)) labelStart--;
  const label = line.slice(labelStart, labelEnd);
  const hasLabel = label !== "" && LABEL_NAME_RE.test(label);

  // Optional `$$` immediately before the label (or before `^` for the
  // bare form). Tracked for diagnostics; doesn't gate matching.
  let isExtrinsic = false;
  let prefixStart = hasLabel ? labelStart : caretPos;
  if (prefixStart >= 2 && line.slice(prefixStart - 2, prefixStart) === "$$") {
    isExtrinsic = true;
    prefixStart -= 2;
  }

  return {
    kind: hasLabel ? "label" : "module",
    module,
    label: hasLabel ? label : "",
    isExtrinsic,
    startCol: prefixStart,
    endCol: modEnd,
  };
}

/** Return the index of a `^` character that the cursor is inside or
 *  immediately adjacent to. The cursor can be on the `^`, on any
 *  character of the module/label, or just past the module. -1 = none. */
function locateCaret(line: string, col: number): number {
  // Character to the right (the cursor is BEFORE col).
  // Walk a small window so caller doesn't have to know what side of
  // `^` they were on when triggering the provider.
  // Strategy: find the nearest `^` such that col falls within the
  // contiguous label/^/module run that includes it.
  for (let i = Math.max(0, col - 64); i <= Math.min(line.length - 1, col + 64); i++) {
    if (line[i] !== "^") continue;
    // Build the candidate span around this `^`.
    let start = i;
    while (start > 0 && isLabelChar(line[start - 1]!)) start--;
    let end = i + 1;
    while (end < line.length && isModuleChar(line[end]!)) end++;
    if (col >= start && col <= end) return i;
  }
  return -1;
}

function isModuleChar(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}

function isLabelChar(ch: string): boolean {
  return (
    (ch >= "A" && ch <= "Z") ||
    (ch >= "a" && ch <= "z") ||
    (ch >= "0" && ch <= "9")
  );
}

/** Match the partial-completion case: the user has typed `^STD` (or
 *  `^STDJ`, etc.) and wants module suggestions. Returns the prefix
 *  that's already been typed (without the `^`) or null if the cursor
 *  isn't inside such a prefix.
 *
 *  Also matches `label^STD` for module suggestions in label-call form,
 *  and `$$label^STD` likewise. */
export function modulePrefixAt(line: string, col: number): string | null {
  // Walk backward from col looking at chars: must be a contiguous
  // run of A-Z0-9 immediately preceded by `^`. Anything else means
  // the cursor is not in module-completion territory.
  let i = col;
  while (i > 0 && isModuleChar(line[i - 1]!)) i--;
  if (i === 0 || line[i - 1] !== "^") return null;
  const prefix = line.slice(i, col);
  // Only suggest STD* completions (not arbitrary `^FOO`).
  if (prefix.length > 0 && !prefix.startsWith("S")) {
    // Empty prefix passes through (user just typed `^`).
    return null;
  }
  if (prefix.length >= 2 && !prefix.startsWith("ST")) return null;
  if (prefix.length >= 3 && !prefix.startsWith("STD")) return null;
  return prefix;
}

/** Match the label-completion case: `<label-prefix>^STDJSON`. The user
 *  has typed `^STDJSON` after some partial label and wants the module's
 *  labels suggested. We return both the typed label-prefix and the
 *  module name; null if the cursor isn't in this shape.
 *
 *  Triggering: cursor is at the end of (or inside) the label-prefix
 *  region of `<prefix>^MODULE`. We anchor on the `^MODULE` to the
 *  cursor's right and identify the label-prefix immediately before it.
 */
export interface LabelPrefixInfo {
  module: string;
  labelPrefix: string;
  /** 0-based start column of the label-prefix (the replacement range). */
  labelStart: number;
  /** 0-based end column of the label-prefix (exclusive). */
  labelEnd: number;
}

export function labelPrefixAt(line: string, col: number): LabelPrefixInfo | null {
  // Find the `^STD*` to the cursor's right (or at cursor).
  for (let i = col; i < Math.min(line.length, col + 64); i++) {
    if (line[i] !== "^") continue;
    let modEnd = i + 1;
    while (modEnd < line.length && isModuleChar(line[modEnd]!)) modEnd++;
    const module = line.slice(i + 1, modEnd);
    if (!STD_MODULE_RE.test(module)) continue;
    // Walk backward from the `^` to grab the label-prefix.
    let labelEnd = i;
    let labelStart = i;
    while (labelStart > 0 && isLabelChar(line[labelStart - 1]!)) labelStart--;
    if (col < labelStart || col > labelEnd) continue;
    return {
      module,
      labelPrefix: line.slice(labelStart, col),
      labelStart,
      labelEnd,
    };
  }
  return null;
}
