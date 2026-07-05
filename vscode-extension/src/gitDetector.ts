/**
 * Git repository detector.
 *
 * Reads .git/config to extract the remote origin URL,
 * then parses it into owner/repo format.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface GitRepoInfo {
  fullName: string;    // "owner/repo"
  remote: string;      // Full remote URL
  branch: string;      // Current branch
  workspaceRoot: string;
}

export async function detectGitRepo(): Promise<GitRepoInfo | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return null;
  }

  const root = workspaceFolders[0].uri.fsPath;
  const gitConfigPath = path.join(root, ".git", "config");
  const gitHeadPath = path.join(root, ".git", "HEAD");

  if (!fs.existsSync(gitConfigPath)) {
    return null;
  }

  try {
    // Read git config to find remote origin
    const configContent = fs.readFileSync(gitConfigPath, "utf-8");
    const remote = parseRemoteUrl(configContent);
    if (!remote) {
      return null;
    }

    const fullName = extractFullName(remote);
    if (!fullName) {
      return null;
    }

    // Read current branch
    let branch = "main";
    if (fs.existsSync(gitHeadPath)) {
      const headContent = fs.readFileSync(gitHeadPath, "utf-8").trim();
      const refMatch = headContent.match(/^ref:\s+refs\/heads\/(.+)$/);
      if (refMatch) {
        branch = refMatch[1];
      }
    }

    return {
      fullName,
      remote,
      branch,
      workspaceRoot: root,
    };
  } catch (err) {
    console.error("🦐 Failed to detect git repo:", err);
    return null;
  }
}

function parseRemoteUrl(configContent: string): string | null {
  // Parse .git/config INI format for [remote "origin"] url
  const lines = configContent.split("\n");
  let inOrigin = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[remote "origin"]') {
      inOrigin = true;
      continue;
    }
    if (inOrigin && trimmed.startsWith("[")) {
      break; // Exited origin section
    }
    if (inOrigin && trimmed.startsWith("url")) {
      const match = trimmed.match(/url\s*=\s*(.+)/);
      if (match) {
        return match[1].trim();
      }
    }
  }
  return null;
}

function extractFullName(remoteUrl: string): string | null {
  // Handle various GitHub URL formats:
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // https://github.com/owner/repo

  let url = remoteUrl.trim();
  if (url.endsWith(".git")) {
    url = url.slice(0, -4);
  }

  // HTTPS format
  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/]+)/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // SSH format
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+)/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return null;
}
