/**
 * CompletionItemProvider for STD* symbols.
 *
 * Two trigger shapes:
 *
 *   1. Module suggestions  — typing `^STD` (or `^STDJ`, etc.) lists
 *                            every module whose name starts with the
 *                            typed prefix. The completion replaces
 *                            the typed prefix with the chosen module
 *                            name.
 *
 *   2. Label suggestions   — typing `<prefix>^STDJSON` lists every
 *                            public label of STDJSON whose name starts
 *                            with `<prefix>`. The completion replaces
 *                            just the label-prefix; the `^STDJSON`
 *                            anchor stays.
 *
 * The provider is registered with `^` as a trigger character so VS
 * Code surfaces module suggestions the moment the user types it.
 * Otherwise it relies on the standard ctrl-space invocation.
 */

import * as vscode from "vscode";
import {
  Manifest,
  ManifestLabel,
  ManifestModule,
  findManifest,
  loadManifest,
} from "./manifest.js";
import { labelPrefixAt, modulePrefixAt } from "./tokens.js";

export class StdlibCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    if (!getEnableCompletion()) return null;

    const line = document.lineAt(position.line).text;
    const manifest = resolveManifest(document);
    if (manifest === null) return null;

    // Label-prefix mode wins over module-prefix mode because its
    // anchor (`^MODULE`) is a strict superset — `^STD` alone routes
    // to module mode, but `parse^STDJSON` (cursor inside `parse`)
    // routes to label mode for STDJSON.
    const labelInfo = labelPrefixAt(line, position.character);
    if (labelInfo !== null) {
      const mod = manifest.modules[labelInfo.module];
      if (mod) {
        return labelCompletions(
          mod,
          labelInfo.labelPrefix,
          new vscode.Range(
            position.line,
            labelInfo.labelStart,
            position.line,
            labelInfo.labelEnd
          )
        );
      }
    }

    const modPrefix = modulePrefixAt(line, position.character);
    if (modPrefix !== null) {
      // Replacement range = the typed prefix immediately after `^`.
      const start = position.character - modPrefix.length;
      return moduleCompletions(
        manifest,
        modPrefix,
        new vscode.Range(position.line, start, position.line, position.character)
      );
    }

    return null;
  }
}

function moduleCompletions(
  manifest: Manifest,
  prefix: string,
  replaceRange: vscode.Range
): vscode.CompletionItem[] {
  const out: vscode.CompletionItem[] = [];
  const wantPrefix = prefix.toUpperCase();
  for (const name of Object.keys(manifest.modules).sort()) {
    if (wantPrefix !== "" && !name.startsWith(wantPrefix)) continue;
    const mod = manifest.modules[name]!;
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = (mod.synopsis ?? "").trim();
    item.documentation = buildModuleHover(name, mod);
    item.insertText = name;
    item.range = replaceRange;
    item.sortText = name;
    out.push(item);
  }
  return out;
}

function labelCompletions(
  mod: ManifestModule,
  labelPrefix: string,
  replaceRange: vscode.Range
): vscode.CompletionItem[] {
  const out: vscode.CompletionItem[] = [];
  const want = labelPrefix; // case-sensitive: M label names are camelCase / lowercase
  for (const labelName of Object.keys(mod.labels).sort()) {
    if (want !== "" && !labelName.startsWith(want)) continue;
    const label = mod.labels[labelName]!;
    const item = new vscode.CompletionItem(labelName, vscode.CompletionItemKind.Function);
    item.detail = (label.synopsis ?? "").trim();
    item.documentation = buildLabelHover(label);
    item.insertText = labelName;
    item.range = replaceRange;
    item.sortText = labelName;
    out.push(item);
  }
  return out;
}

function buildModuleHover(
  name: string,
  mod: ManifestModule
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.appendMarkdown(`**module \`${name}\`**\n\n`);
  if (mod.synopsis) md.appendMarkdown(`${mod.synopsis}\n\n`);
  const labels = Object.keys(mod.labels).sort();
  if (labels.length > 0) {
    md.appendMarkdown(`${labels.length} public labels`);
  }
  return md;
}

function buildLabelHover(label: ManifestLabel): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  if (label.signature) md.appendCodeblock(label.signature, "m");
  if (label.synopsis) md.appendMarkdown(`\n${label.synopsis}\n`);
  return md;
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

function getEnableCompletion(): boolean {
  return vscode.workspace
    .getConfiguration("m-stdlib")
    .get<boolean>("enableCompletion", true);
}
