/**
 * Copepod API Client.
 *
 * Handles all HTTP communication with the Copepod backend,
 * reading config from VS Code settings.
 */

import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";

export interface FileContextResponse {
  path: string;
  repo: string;
  context: string;
  raw_results_count: number;
}

export interface PRHistoryResponse {
  path: string;
  repo: string;
  entries: Array<{ context: string }>;
}

export interface ChatResponse {
  answer: string;
  sources: Array<{
    type: string;
    title: string;
    url?: string;
    relevance: number;
  }>;
  dataset: string;
  query: string;
}

export class CopepodApiClient {
  private getConfig() {
    const config = vscode.workspace.getConfiguration("copepod");
    return {
      apiUrl: config.get<string>("apiUrl", "http://localhost:8000"),
      apiKey: config.get<string>("apiKey", ""),
      repoId: config.get<string>("repoId", ""),
    };
  }

  isConfigured(): boolean {
    const { apiKey, repoId } = this.getConfig();
    return apiKey.length > 0 && repoId.length > 0;
  }

  async getFileContext(filePath: string): Promise<FileContextResponse | null> {
    const { apiUrl, apiKey, repoId } = this.getConfig();
    if (!apiKey || !repoId) { return null; }

    const url = `${apiUrl}/repos/${repoId}/file-context?path=${encodeURIComponent(filePath)}`;
    return this.httpGet<FileContextResponse>(url, apiKey);
  }

  async getPRHistory(filePath: string): Promise<PRHistoryResponse | null> {
    const { apiUrl, apiKey, repoId } = this.getConfig();
    if (!apiKey || !repoId) { return null; }

    const url = `${apiUrl}/repos/${repoId}/pr-history?path=${encodeURIComponent(filePath)}`;
    return this.httpGet<PRHistoryResponse>(url, apiKey);
  }

  async chat(query: string): Promise<ChatResponse | null> {
    const { apiUrl, apiKey, repoId } = this.getConfig();
    if (!apiKey || !repoId) { return null; }

    const url = `${apiUrl}/repos/${repoId}/chat`;
    return this.httpPost<ChatResponse>(url, apiKey, { query });
  }

  private httpGet<T>(url: string, apiKey: string): Promise<T | null> {
    return new Promise((resolve) => {
      const urlObj = new URL(url);
      const mod = urlObj.protocol === "https:" ? https : http;

      const req = mod.get(
        url,
        {
          headers: { "X-API-Key": apiKey, "Accept": "application/json" },
          timeout: 20000,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try { resolve(JSON.parse(body)); } catch { resolve(null); }
            } else {
              console.error(`🦐 API error: ${res.statusCode} ${body.slice(0, 200)}`);
              resolve(null);
            }
          });
        }
      );
      req.on("error", (err) => {
        console.error("🦐 API connection error:", err.message);
        resolve(null);
      });
      req.on("timeout", () => { req.destroy(); resolve(null); });
    });
  }

  private httpPost<T>(url: string, apiKey: string, data: any): Promise<T | null> {
    return new Promise((resolve) => {
      const urlObj = new URL(url);
      const mod = urlObj.protocol === "https:" ? https : http;
      const payload = JSON.stringify(data);

      const req = mod.request(
        url,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "Accept": "application/json",
          },
          timeout: 60000,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try { resolve(JSON.parse(body)); } catch { resolve(null); }
            } else {
              console.error(`🦐 API error: ${res.statusCode} ${body.slice(0, 200)}`);
              resolve(null);
            }
          });
        }
      );
      req.on("error", (err) => {
        console.error("🦐 API connection error:", err.message);
        resolve(null);
      });
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.write(payload);
      req.end();
    });
  }
}
