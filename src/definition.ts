/**
 * DefinitionProvider for STD* references — Cmd/Ctrl-click jumps to
 * the source line in the m-stdlib checkout.
 *
 * The manifest carries `source.file` (relative to the m-stdlib repo
 * root) and `source.line` (1-based) for every public label and every
 * module. We resolve the absolute path by anchoring on the manifest
 * file's location: `<repoRoot>/dist/stdlib-manifest.json` →
 * `<repoRoot>/<source.file>`.
 *
 * Falls back to opening the routine file at line 1 when only a
 * module reference is given (modules don't have a `line` field
 * beyond the routine line itself, which is line 1 by convention).
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Manifest, findManifest, loadManifest } from "./manifest.js";
import { tokenAt } from "./tokens.js";

export class StdlibDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Definition> {
    if (!getEnableDefinition()) return null;

    const line = document.lineAt(position.line).text;
    const tok = tokenAt(line, position.character);
    if (tok === null) return null;

    const resolved = resolveManifestWithPath(document);
    if (resolved === null) return null;
    const { manifest, manifestPath } = resolved;

    const mod = manifest.modules[tok.module];
    if (!mod) return null;

    let sourceFile: string;
    let sourceLine: number;
    if (tok.kind === "label") {
      const label = mod.labels[tok.label];
      if (!label) return null;
      sourceFile = label.source.file;
      sourceLine = label.source.line || 1;
    } else {
      sourceFile = mod.source?.file ?? "";
      sourceLine = mod.source?.line ?? 1;
    }
    if (!sourceFile) return null;

    // The manifest's `source.file` is repo-relative (e.g. `src/STDJSON.m`).
    // Anchor on the manifest's directory: <repoRoot>/dist/stdlib-manifest.json
    // → resolve up two levels (`dist/` → repo root) and join with the
    // source path.
    const repoRoot = path.dirname(path.dirname(manifestPath));
    const abs = path.join(repoRoot, sourceFile);
    if (!safeIsFile(abs)) return null;

    // VS Code Position uses 0-based lines; manifest carries 1-based.
    const targetPos = new vscode.Position(Math.max(0, sourceLine - 1), 0);
    return new vscode.Location(vscode.Uri.file(abs), targetPos);
  }
}

function resolveManifestWithPath(
  document: vscode.TextDocument
): { manifest: Manifest; manifestPath: string } | null {
  const cfg = vscode.workspace.getConfiguration("m-stdlib", document.uri);
  const explicit = cfg.get<string>("manifestPath", "");
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const folderPath = folder ? folder.uri.fsPath : undefined;
  const p = findManifest({
    explicit,
    workspaceFolders: folderPath ? [folderPath] : [],
  });
  if (p === null) return null;
  try {
    return { manifest: loadManifest(p), manifestPath: p };
  } catch {
    return null;
  }
}

function getEnableDefinition(): boolean {
  return vscode.workspace
    .getConfiguration("m-stdlib")
    .get<boolean>("enableDefinition", true);
}

function safeIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
