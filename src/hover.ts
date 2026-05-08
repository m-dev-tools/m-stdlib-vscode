/**
 * HoverProvider for STD* references in M source.
 *
 * Mirrors the long-form rendering of `m doc <symbol>` (m-cli's
 * `format_label_long` / `format_module_long`) but in VS Code's
 * MarkdownString. The user gets the same content whether they
 * Cmd+hover in the editor or run the CLI command in a terminal.
 */

import * as vscode from "vscode";
import {
  Manifest,
  ManifestLabel,
  ManifestModule,
  findManifest,
  loadManifest,
} from "./manifest.js";
import { TokenRef, tokenAt } from "./tokens.js";

export class StdlibHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    if (!getEnableHover()) return null;

    const line = document.lineAt(position.line).text;
    const tok = tokenAt(line, position.character);
    if (tok === null) return null;

    const manifest = resolveManifest(document);
    if (manifest === null) return null;

    const range = new vscode.Range(
      position.line,
      tok.startCol,
      position.line,
      tok.endCol
    );

    if (tok.kind === "module") {
      const mod = manifest.modules[tok.module];
      if (!mod) return null;
      return new vscode.Hover(renderModuleMarkdown(tok.module, mod), range);
    }

    // tok.kind === "label"
    const mod = manifest.modules[tok.module];
    if (!mod) return null;
    const label = mod.labels[tok.label];
    if (!label) return null;
    return new vscode.Hover(
      renderLabelMarkdown(tok.module, tok.label, label, tok),
      range
    );
  }
}

function resolveManifest(document: vscode.TextDocument): Manifest | null {
  const cfg = vscode.workspace.getConfiguration("m-stdlib", document.uri);
  const explicit = cfg.get<string>("manifestPath", "");
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const folderPath = folder ? folder.uri.fsPath : undefined;
  const path = findManifest({
    explicit,
    workspaceFolders: folderPath ? [folderPath] : [],
  });
  if (path === null) return null;
  try {
    return loadManifest(path);
  } catch {
    return null;
  }
}

function getEnableHover(): boolean {
  return vscode.workspace.getConfiguration("m-stdlib").get<boolean>("enableHover", true);
}

function renderModuleMarkdown(name: string, mod: ManifestModule): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.isTrusted = false;
  md.supportHtml = false;
  md.appendMarkdown(`**module \`${name}\`**\n\n`);
  if (mod.synopsis) {
    md.appendMarkdown(`${mod.synopsis}\n\n`);
  }
  const labelNames = Object.keys(mod.labels).sort();
  if (labelNames.length > 0) {
    md.appendMarkdown(`**public labels** (${labelNames.length}):\n\n`);
    for (const label of labelNames) {
      const syn = (mod.labels[label]!.synopsis ?? "").trim();
      if (syn) {
        md.appendMarkdown(`- \`${label}\` — ${syn}\n`);
      } else {
        md.appendMarkdown(`- \`${label}\`\n`);
      }
    }
    md.appendMarkdown("\n");
  }
  const errors = mod.errors ?? [];
  if (errors.length > 0) {
    md.appendMarkdown(`**raises**: ${errors.map((e) => `\`${e}\``).join(", ")}\n\n`);
  }
  if (mod.source?.file) {
    md.appendMarkdown(`*source: \`${mod.source.file}\`*`);
  }
  return md;
}

function renderLabelMarkdown(
  module: string,
  labelName: string,
  label: ManifestLabel,
  _tok: TokenRef
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.isTrusted = false;
  md.supportHtml = false;

  const sig = label.signature || `${labelName}^${module}`;
  const arrow =
    label.returns && label.returns.type ? ` → ${label.returns.type}` : "";
  md.appendCodeblock(`${sig}${arrow}`, "m");

  if (label.synopsis) {
    md.appendMarkdown(`\n${label.synopsis}\n\n`);
  }

  const params = label.params ?? [];
  if (params.length > 0) {
    md.appendMarkdown(`**params**:\n\n`);
    for (const p of params) {
      const type = p.type ? ` *${p.type}*` : "";
      const doc = p.doc ? ` — ${p.doc}` : "";
      md.appendMarkdown(`- \`${p.name}\`${type}${doc}\n`);
    }
    md.appendMarkdown("\n");
  }

  if (label.returns && (label.returns.type || label.returns.doc)) {
    const type = label.returns.type ? `*${label.returns.type}*` : "";
    const doc = label.returns.doc ? ` — ${label.returns.doc}` : "";
    md.appendMarkdown(`**returns**: ${type}${doc}\n\n`);
  }

  const raises = label.raises ?? [];
  if (raises.length > 0) {
    md.appendMarkdown(`**raises**:\n\n`);
    for (const r of raises) {
      const doc = r.doc ? ` — ${r.doc}` : "";
      md.appendMarkdown(`- \`${r.code}\`${doc}\n`);
    }
    md.appendMarkdown("\n");
  }

  const meta: string[] = [];
  if (label.since) meta.push(`since: \`${label.since}\``);
  if (label.stable) meta.push(`stable: \`${label.stable}\``);
  if (meta.length > 0) {
    md.appendMarkdown(`${meta.join(" · ")}\n\n`);
  }

  const see = label.see_also ?? [];
  if (see.length > 0) {
    md.appendMarkdown(`**see also**: ${see.map((s) => `\`${s}\``).join(", ")}\n\n`);
  }

  const examples = label.examples ?? [];
  if (examples.length > 0) {
    md.appendMarkdown(`**example**:\n\n`);
    for (const ex of examples) {
      md.appendCodeblock(ex, "m");
    }
    md.appendMarkdown("\n");
  }

  if (label.description && label.description.trim() !== "") {
    md.appendMarkdown(`${label.description.trim()}\n\n`);
  }

  if (label.source?.file) {
    const where = label.source.line
      ? `${label.source.file}:${label.source.line}`
      : label.source.file;
    md.appendMarkdown(`*source: \`${where}\`*`);
  }

  return md;
}
