/**
 * Copepod VS Code Extension — Main entry point.
 *
 * Features:
 * - Auto-detects .git and extracts remote origin URL → repo full_name
 * - Registers a WebView graph panel showing PR/issue/file node graph
 * - Registers a TreeView showing connected repo info
 * - Refreshes graph when active file changes
 * - Right-click "Show Decision Graph" on any file
 */

import * as vscode from "vscode";
import { CopepodGraphProvider } from "./graphProvider";
import { CopepodRepoTreeProvider } from "./repoTreeProvider";
import { detectGitRepo } from "./gitDetector";
import { CopepodApiClient } from "./apiClient";

let graphProvider: CopepodGraphProvider;
let repoTreeProvider: CopepodRepoTreeProvider;
let apiClient: CopepodApiClient;

export async function activate(context: vscode.ExtensionContext) {
  console.log("🦐 Copepod extension activating...");

  // Initialize API client
  apiClient = new CopepodApiClient();

  // Auto-detect git repo
  const gitInfo = await detectGitRepo();
  if (gitInfo) {
    console.log(`🦐 Detected repo: ${gitInfo.fullName} (remote: ${gitInfo.remote})`);
    apiClient.setDetectedRepoId(gitInfo.fullName);
    
    // Resolve repo ID asynchronously and refresh tree view
    apiClient.resolveRepoId(gitInfo.fullName).then((success) => {
      if (success) {
        vscode.commands.executeCommand("copepod.refresh");
      }
    });
  }

  // Register Graph WebView
  graphProvider = new CopepodGraphProvider(context.extensionUri, apiClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("copepod.graphView", graphProvider)
  );

  // Register Repo Tree View
  repoTreeProvider = new CopepodRepoTreeProvider(apiClient, gitInfo);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("copepod.repoInfo", repoTreeProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("copepod.refresh", () => {
      graphProvider.refresh();
      repoTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copepod.configure", async () => {
      const apiKey = await vscode.window.showInputBox({
        prompt: "Enter your Copepod API Key (from Studio → Settings)",
        placeHolder: "cpd_xxxxx",
        password: true,
      });
      if (apiKey) {
        await vscode.workspace.getConfiguration("copepod").update("apiKey", apiKey, true);
        vscode.window.showInformationMessage("🦐 Copepod API key saved!");
        graphProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copepod.showFileGraph", () => {
      graphProvider.refresh();
    })
  );

  // Refresh on file change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      graphProvider.refresh();
    })
  );

  vscode.window.showInformationMessage(
    gitInfo
      ? `🦐 Copepod: Connected to ${gitInfo.fullName}`
      : "🦐 Copepod: No git repo detected. Open a git repository to get started."
  );
}

export function deactivate() {
  console.log("🦐 Copepod extension deactivated");
}
