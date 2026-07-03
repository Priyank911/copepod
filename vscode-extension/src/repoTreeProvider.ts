/**
 * Copepod Repo Tree View Provider.
 *
 * Shows the connected repository info in the sidebar:
 * - Repo name (auto-detected from .git)
 * - Connection status
 * - Branch
 * - API endpoint
 */

import * as vscode from "vscode";
import { CopepodApiClient } from "./apiClient";
import { GitRepoInfo } from "./gitDetector";

export class CopepodRepoTreeProvider implements vscode.TreeDataProvider<RepoInfoItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RepoInfoItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private apiClient: CopepodApiClient,
    private gitInfo: GitRepoInfo | null,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RepoInfoItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RepoInfoItem): Promise<RepoInfoItem[]> {
    if (element) { return []; }

    const items: RepoInfoItem[] = [];

    if (this.gitInfo) {
      items.push(new RepoInfoItem(
        `📦 ${this.gitInfo.fullName}`,
        vscode.TreeItemCollapsibleState.None,
        "Repository detected from .git config"
      ));
      items.push(new RepoInfoItem(
        `🌿 ${this.gitInfo.branch}`,
        vscode.TreeItemCollapsibleState.None,
        "Current branch"
      ));
    } else {
      items.push(new RepoInfoItem(
        "⚠️ No .git detected",
        vscode.TreeItemCollapsibleState.None,
        "Open a git repository to use Copepod"
      ));
    }

    const config = vscode.workspace.getConfiguration("copepod");
    const apiUrl = config.get<string>("apiUrl", "http://localhost:8000");
    const apiKey = config.get<string>("apiKey", "");
    const repoId = config.get<string>("repoId", "");

    if (apiKey && repoId) {
      items.push(new RepoInfoItem(
        "🟢 Connected",
        vscode.TreeItemCollapsibleState.None,
        `API: ${apiUrl}`
      ));
    } else {
      items.push(new RepoInfoItem(
        "🔴 Not configured",
        vscode.TreeItemCollapsibleState.None,
        "Run 'Copepod: Configure Connection' to set API key"
      ));
    }

    return items;
  }
}

class RepoInfoItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly description_text: string,
  ) {
    super(label, collapsibleState);
    this.tooltip = description_text;
    this.description = "";
  }
}
