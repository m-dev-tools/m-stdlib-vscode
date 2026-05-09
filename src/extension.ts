/**
 * m-stdlib VS Code extension — entry point.
 *
 * Activates on the `m` language id (any `.m` file open in the editor).
 * Registers three providers, all driven by the manifest at
 * `dist/stdlib-manifest.json` from m-stdlib's WA4 generator:
 *
 *   - StdlibHoverProvider       — hover synopsis + signature on
 *                                 `^STD*` and `label^STDxxx` tokens.
 *   - StdlibDefinitionProvider  — Cmd/Ctrl-click jumps to the source
 *                                 location recorded in the manifest.
 *   - StdlibCompletionProvider  — `^STD` triggers module completions;
 *                                 `<prefix>^STDxxx` triggers label
 *                                 completions for that module.
 *
 * Hard scope: stdlib symbols only. Not a full M LSP. Per the
 * discoverability plan §5.1 the extension's lifetime ends at the
 * point where a real M language server takes over.
 */

import * as vscode from "vscode";
import { StdlibCompletionProvider } from "./completion.js";
import { StdlibDefinitionProvider } from "./definition.js";
import { StdlibHoverProvider } from "./hover.js";
import { clearManifestCache, findManifest } from "./manifest.js";

const M_LANGUAGE: vscode.DocumentSelector = { language: "m", scheme: "file" };

export function activate(context: vscode.ExtensionContext): void {
  const hover = vscode.languages.registerHoverProvider(
    M_LANGUAGE,
    new StdlibHoverProvider()
  );
  const definition = vscode.languages.registerDefinitionProvider(
    M_LANGUAGE,
    new StdlibDefinitionProvider()
  );
  // Trigger completions on `^` so the user gets module suggestions
  // immediately upon typing it. Standard ctrl-space invocation works
  // anywhere too.
  const completion = vscode.languages.registerCompletionItemProvider(
    M_LANGUAGE,
    new StdlibCompletionProvider(),
    "^"
  );

  // Watch the manifest file for changes. When the m-stdlib developer
  // runs `make manifest` after editing a `; doc:` block, the editor
  // picks up the new content within ~1 frame without needing a reload.
  // The cache invalidation in loadManifest() handles the actual reload;
  // this watcher just nudges it.
  const watcherDisposables = installManifestWatcher();

  context.subscriptions.push(hover, definition, completion, ...watcherDisposables);

  // Surface a one-time "manifest not found" diagnostic in the status
  // bar so users on a fresh install know what's expected. Stays for
  // ~5s, then auto-clears.
  surfaceInitialStatus();
}

export function deactivate(): void {
  // Nothing to do — the providers are released via context.subscriptions.
}

/** Set up file-system watchers so the cache picks up regenerated
 *  manifests without an editor reload. We watch the resolved path
 *  per workspace folder; a workspace with multiple m-stdlib roots
 *  gets one watcher per root.
 */
function installManifestWatcher(): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const resolved = findManifest({ workspaceFolders: [folder.uri.fsPath] });
    if (resolved === null) continue;
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(resolved).with({ path: resolved.replace(/[^/]+$/, "") }),
      "stdlib-manifest.json"
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onChange = () => clearManifestCache();
    disposables.push(
      watcher,
      watcher.onDidChange(onChange),
      watcher.onDidCreate(onChange),
      watcher.onDidDelete(onChange)
    );
  }
  return disposables;
}

function surfaceInitialStatus(): void {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folderPaths = folders.map((f) => f.uri.fsPath);
  const cfg = vscode.workspace.getConfiguration("m-stdlib");
  const explicit = cfg.get<string>("manifestPath", "");
  const resolved = findManifest({
    explicit,
    workspaceFolders: folderPaths,
  });
  if (resolved === null) {
    const item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0
    );
    item.text = "$(warning) m-stdlib: manifest not found";
    item.tooltip =
      "The m-stdlib extension can't find dist/stdlib-manifest.json — " +
      "this should not happen on a normal install (the extension ships " +
      "with a bundled manifest). Verify the .vsix is intact, set " +
      "m-stdlib.manifestPath in settings, or export $M_CLI_MANIFEST.";
    item.show();
    setTimeout(() => item.dispose(), 5000);
  }
}
