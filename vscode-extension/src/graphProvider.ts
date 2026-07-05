/**
 * Copepod Graph WebView Provider.
 *
 * Renders an interactive SVG node graph (like the trace view in the reference image)
 * showing PRs, issues, files, and their connections with satisfaction scores.
 *
 * Graph layout:
 * - Center node: The currently open file
 * - Left nodes: PRs that touched this file
 * - Right nodes: Issues resolved by those PRs
 * - Edges: Connections between PRs ↔ Files and PRs ↔ Issues
 * - Color coding: Green (fresh) / Yellow (aging) / Red (stale) based on satisfaction
 */

import * as vscode from "vscode";
import { CopepodApiClient } from "./apiClient";
import { detectGitRepo } from "./gitDetector";

export class CopepodGraphProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _apiClient: CopepodApiClient,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.refresh();
  }

  async refresh() {
    if (!this._view) { return; }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this._view.webview.html = this._renderHtml("empty", null, null);
      return;
    }

    if (!this._apiClient.isConfigured()) {
      const config = vscode.workspace.getConfiguration("copepod");
      const apiKey = config.get<string>("apiKey", "");
      const gitInfo = await detectGitRepo();
      if (apiKey && gitInfo) {
        this._view.webview.html = this._renderHtml("loading", null, null);
        const resolved = await this._apiClient.resolveRepoId(gitInfo.fullName);
        if (resolved) {
          this.refresh();
          return;
        }
      }
      this._view.webview.html = this._renderHtml("unconfigured", null, null);
      return;
    }

    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
    this._view.webview.html = this._renderHtml("loading", filePath, null);

    try {
      // Fetch both file context and PR history
      const [fileCtx, prHistory] = await Promise.all([
        this._apiClient.getFileContext(filePath),
        this._apiClient.getPRHistory(filePath),
      ]);

      const graphData = this._buildGraphData(filePath, fileCtx, prHistory);
      this._view.webview.html = this._renderHtml("ready", filePath, graphData);
    } catch (err: any) {
      this._view.webview.html = this._renderHtml("error", filePath, null, err.message);
    }
  }

  private _buildGraphData(
    filePath: string,
    fileCtx: any,
    prHistory: any,
  ): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Center node: the file
    const fileNodeId = "file-0";
    nodes.push({
      id: fileNodeId,
      type: "file",
      label: this._basename(filePath),
      detail: filePath,
      count: fileCtx?.raw_results_count || 0,
      satisfaction: -1, // n/a for files
    });

    // Parse context to extract PR and issue references
    const context = fileCtx?.context || "";
    const entries = prHistory?.entries || [];

    // Extract PR nodes from context
    const prRegex = /(?:PR|Pull Request)\s*#?(\d+)/gi;
    const issueRegex = /Issue\s*#?(\d+)/gi;
    const seenPRs = new Set<string>();
    const seenIssues = new Set<string>();

    // Scan all text for PRs and issues
    const allText = context + " " + entries.map((e: any) => e.context).join(" ");

    let match;
    while ((match = prRegex.exec(allText)) !== null) {
      const prNum = match[1];
      if (!seenPRs.has(prNum)) {
        seenPRs.add(prNum);
        const nodeId = `pr-${prNum}`;
        // Estimate satisfaction from context mentions (heuristic)
        const mentionCount = (allText.match(new RegExp(`#${prNum}`, "g")) || []).length;
        const satisfaction = Math.min(1.0, 0.3 + mentionCount * 0.15);

        nodes.push({
          id: nodeId,
          type: "pr",
          label: `PR #${prNum}`,
          detail: this._extractPRTitle(allText, prNum),
          count: mentionCount,
          satisfaction,
        });
        edges.push({ from: nodeId, to: fileNodeId });
      }
    }

    while ((match = issueRegex.exec(allText)) !== null) {
      const issueNum = match[1];
      if (!seenIssues.has(issueNum)) {
        seenIssues.add(issueNum);
        const nodeId = `issue-${issueNum}`;
        nodes.push({
          id: nodeId,
          type: "issue",
          label: `Issue #${issueNum}`,
          detail: this._extractIssueTitle(allText, issueNum),
          count: 1,
          satisfaction: -1,
        });

        // Connect issues to PRs that resolve them
        for (const prNum of seenPRs) {
          edges.push({ from: `pr-${prNum}`, to: nodeId });
        }
      }
    }

    // If we have entries but no parsed PRs, create generic context nodes
    if (nodes.length === 1 && entries.length > 0) {
      entries.forEach((entry: any, i: number) => {
        const nodeId = `ctx-${i}`;
        const label = entry.context?.slice(0, 30) || `Context ${i + 1}`;
        nodes.push({
          id: nodeId,
          type: "context",
          label,
          detail: entry.context || "",
          count: 1,
          satisfaction: 0.5,
        });
        edges.push({ from: nodeId, to: fileNodeId });
      });
    }

    return { nodes, edges };
  }

  private _basename(filePath: string): string {
    const parts = filePath.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || filePath;
  }

  private _extractPRTitle(text: string, prNum: string): string {
    const regex = new RegExp(`PR\\s*#?${prNum}\\s+(?:titled\\s+)?['"]?([^'"\\n]{5,60})`, "i");
    const match = text.match(regex);
    return match ? match[1].trim() : `Pull Request #${prNum}`;
  }

  private _extractIssueTitle(text: string, issueNum: string): string {
    const regex = new RegExp(`Issue\\s*#?${issueNum}\\s+(?:titled\\s+)?['"]?([^'"\\n]{5,60})`, "i");
    const match = text.match(regex);
    return match ? match[1].trim() : `Issue #${issueNum}`;
  }

  private _renderHtml(
    state: "empty" | "unconfigured" | "loading" | "ready" | "error",
    filePath: string | null,
    graphData: GraphData | null,
    errorMsg?: string,
  ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${GRAPH_STYLES}</style>
  <script>${GRAPH_SCRIPT}</script>
</head>
<body>
  ${this._renderHeader(filePath)}
  ${this._renderBody(state, graphData, errorMsg)}
</body>
</html>`;
  }

  private _renderHeader(filePath: string | null): string {
    if (!filePath) { return ""; }
    return `
    <div class="header">
      <div class="header-icon">🦐</div>
      <div class="header-text">
        <div class="header-title">Trace: ${this._basename(filePath)}</div>
        <div class="header-path">${filePath}</div>
      </div>
    </div>`;
  }

  private _renderBody(
    state: string,
    graphData: GraphData | null,
    errorMsg?: string,
  ): string {
    if (state === "empty") {
      return `<div class="center-msg"><span class="icon-big">📄</span><p>Open a file to view its<br>decision graph</p></div>`;
    }
    if (state === "unconfigured") {
      return `<div class="center-msg"><span class="icon-big">⚙️</span><p>Configure Copepod</p><p class="dim">Run <code>Copepod: Configure Connection</code><br>from the command palette</p></div>`;
    }
    if (state === "loading") {
      return `<div class="center-msg"><div class="loader"><span>●</span><span>●</span><span>●</span></div><p>Loading decision graph...</p></div>`;
    }
    if (state === "error") {
      return `<div class="center-msg error"><span class="icon-big">⚠️</span><p>${errorMsg || "Unknown error"}</p></div>`;
    }

    // Ready state — render graph
    if (!graphData || graphData.nodes.length === 0) {
      return `<div class="center-msg"><span class="icon-big">📭</span><p>No decision history found<br>for this file</p></div>`;
    }

    return `
    <div class="search-bar">
      <input type="text" id="searchInput" placeholder="🔍 Search nodes..." />
    </div>
    <div class="graph-container" id="graphContainer">
      <svg id="graphSvg" width="100%" height="100%">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--edge-color)" />
          </marker>
        </defs>
        <g id="graphGroup"></g>
      </svg>
    </div>
    <div class="legend">
      <span class="legend-item"><span class="dot dot-file"></span>File</span>
      <span class="legend-item"><span class="dot dot-pr"></span>PR</span>
      <span class="legend-item"><span class="dot dot-issue"></span>Issue</span>
      <span class="legend-item"><span class="dot dot-green"></span>Fresh</span>
      <span class="legend-item"><span class="dot dot-yellow"></span>Aging</span>
      <span class="legend-item"><span class="dot dot-red"></span>Stale</span>
    </div>
    <div id="tooltip" class="tooltip"></div>
    <script>
      initGraph(${JSON.stringify(graphData)});
    </script>`;
  }
}

interface GraphNode {
  id: string;
  type: "file" | "pr" | "issue" | "context";
  label: string;
  detail: string;
  count: number;
  satisfaction: number; // -1 = n/a, 0-1 = score
}

interface GraphEdge {
  from: string;
  to: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ────────────────────────────────────────────────────────────────────────
// Graph Styles (matches the dark trace view aesthetic from the reference)
// ────────────────────────────────────────────────────────────────────────
const GRAPH_STYLES = `
  :root {
    --bg: #0c0c0e;
    --surface: #161618;
    --border: rgba(255,255,255,0.07);
    --text: #e4e4e7;
    --text-dim: rgba(228,228,231,0.45);
    --accent: #818cf8;
    --edge-color: rgba(129,140,248,0.35);
    --node-file: #818cf8;
    --node-pr: #22c55e;
    --node-issue: #f59e0b;
    --node-ctx: #64748b;
    --green: #22c55e;
    --yellow: #f59e0b;
    --red: #ef4444;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
    font-size: 12px;
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .header-icon { font-size: 16px; }
  .header-title { font-size: 13px; font-weight: 600; }
  .header-path { font-size: 10px; color: var(--text-dim); margin-top: 1px; }

  .search-bar {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .search-bar input {
    width: 100%;
    padding: 5px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-family: inherit;
    font-size: 11px;
    outline: none;
  }

  .search-bar input:focus {
    border-color: var(--accent);
  }

  .graph-container {
    flex: 1;
    overflow: hidden;
    position: relative;
    cursor: grab;
  }

  .graph-container:active { cursor: grabbing; }

  /* ── Nodes ─────────────────────────────────────────── */
  .node {
    cursor: pointer;
    transition: filter 120ms ease;
  }

  .node:hover { filter: brightness(1.3); }

  .node-rect {
    rx: 4;
    ry: 4;
    stroke-width: 1.5;
    transition: stroke 120ms ease;
  }

  .node:hover .node-rect { stroke-width: 2.5; }

  .node-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    fill: var(--text);
    pointer-events: none;
  }

  .node-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    fill: var(--text-dim);
    pointer-events: none;
  }

  .node-dot {
    r: 4;
    transition: r 120ms ease;
  }

  .node:hover .node-dot { r: 5; }

  /* ── Edges ─────────────────────────────────────────── */
  .edge {
    stroke: var(--edge-color);
    stroke-width: 1.5;
    fill: none;
    transition: stroke 200ms ease;
  }

  .edge:hover {
    stroke: var(--accent);
    stroke-width: 2;
  }

  .edge-highlight {
    stroke: var(--accent);
    stroke-width: 2;
    opacity: 0.8;
  }

  /* ── Decision Diamond ──────────────────────────────── */
  .diamond {
    fill: var(--surface);
    stroke: var(--edge-color);
    stroke-width: 1.5;
  }

  /* ── Tooltip ───────────────────────────────────────── */
  .tooltip {
    position: fixed;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.5;
    max-width: 280px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 100ms ease;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }

  .tooltip.visible { opacity: 1; }

  .tooltip-title { font-weight: 600; margin-bottom: 3px; }

  .tooltip-detail { color: var(--text-dim); font-size: 10px; }

  .tooltip-satisfaction {
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .tooltip-bar {
    height: 3px;
    border-radius: 2px;
    flex: 1;
    background: rgba(255,255,255,0.1);
    overflow: hidden;
  }

  .tooltip-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 300ms ease;
  }

  /* ── Legend ─────────────────────────────────────────── */
  .legend {
    display: flex;
    gap: 10px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    color: var(--text-dim);
    flex-wrap: wrap;
  }

  .legend-item { display: flex; align-items: center; gap: 4px; }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .dot-file { background: var(--node-file); }
  .dot-pr { background: var(--node-pr); }
  .dot-issue { background: var(--node-issue); }
  .dot-green { background: var(--green); }
  .dot-yellow { background: var(--yellow); }
  .dot-red { background: var(--red); }

  /* ── Center Message ────────────────────────────────── */
  .center-msg {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-dim);
    padding: 2rem;
    gap: 8px;
  }

  .icon-big { font-size: 28px; }
  .dim { font-size: 11px; opacity: 0.6; }
  .error { color: var(--red); }

  .loader span {
    display: inline-block;
    animation: pulse 1.5s ease-in-out infinite;
    color: var(--accent);
    font-size: 16px;
  }
  .loader span:nth-child(2) { animation-delay: 0.2s; }
  .loader span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  /* ── Satisfaction color bars on nodes ───────────────── */
  .sat-bar {
    height: 3px;
    rx: 1.5;
  }
`;

// ────────────────────────────────────────────────────────────────────────
// Graph Rendering Script (client-side SVG graph with pan/zoom)
// ────────────────────────────────────────────────────────────────────────
const GRAPH_SCRIPT = `
function initGraph(data) {
  const svg = document.getElementById('graphSvg');
  const group = document.getElementById('graphGroup');
  const container = document.getElementById('graphContainer');
  const tooltip = document.getElementById('tooltip');
  const searchInput = document.getElementById('searchInput');

  if (!data || !data.nodes.length) return;

  const NODE_W = 140;
  const NODE_H = 36;
  const PADDING = 30;

  // ── Layout: hierarchical left-to-right ──────────────
  // Column 0: PRs | Column 1: File (center) | Column 2: Issues
  const columns = { pr: [], context: [], file: [], issue: [] };
  data.nodes.forEach(n => {
    if (n.type === 'file') columns.file.push(n);
    else if (n.type === 'pr') columns.pr.push(n);
    else if (n.type === 'issue') columns.issue.push(n);
    else columns.context.push(n);
  });

  // Merge context into PRs column for layout
  const leftNodes = [...columns.pr, ...columns.context];
  const centerNodes = columns.file;
  const rightNodes = columns.issue;

  const positions = {};

  // Position center (file node)
  const maxCol = Math.max(leftNodes.length, rightNodes.length, 1);
  const totalH = maxCol * (NODE_H + 24);

  centerNodes.forEach((n, i) => {
    positions[n.id] = {
      x: PADDING + (NODE_W + 80),
      y: PADDING + totalH / 2 - (centerNodes.length * (NODE_H + 24)) / 2 + i * (NODE_H + 24),
    };
  });

  // Position left nodes (PRs)
  leftNodes.forEach((n, i) => {
    positions[n.id] = {
      x: PADDING,
      y: PADDING + i * (NODE_H + 24),
    };
  });

  // Position right nodes (Issues)
  rightNodes.forEach((n, i) => {
    positions[n.id] = {
      x: PADDING + 2 * (NODE_W + 80),
      y: PADDING + i * (NODE_H + 24),
    };
  });

  // ── Render edges ────────────────────────────────────
  data.edges.forEach(edge => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) return;

    const fromX = from.x + NODE_W;
    const fromY = from.y + NODE_H / 2;
    const toX = to.x;
    const toY = to.y + NODE_H / 2;

    // Determine if edge goes left→right or right→left
    let x1, y1, x2, y2;
    if (fromX < toX) {
      x1 = fromX; y1 = fromY; x2 = toX; y2 = toY;
    } else {
      x1 = from.x; y1 = fromY; x2 = to.x + NODE_W; y2 = toY;
    }

    // Curved path
    const midX = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + midX + ' ' + y2 + ', ' + x2 + ' ' + y2);
    path.setAttribute('class', 'edge');
    path.setAttribute('marker-end', 'url(#arrowhead)');
    path.dataset.from = edge.from;
    path.dataset.to = edge.to;
    group.appendChild(path);
  });

  // ── Add diamond decision nodes at edge intersections ──
  if (leftNodes.length > 1 && centerNodes.length > 0) {
    const cx = positions[centerNodes[0].id].x - 30;
    const cy = positions[centerNodes[0].id].y + NODE_H / 2;
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const s = 8;
    diamond.setAttribute('points',
      (cx) + ',' + (cy - s) + ' ' +
      (cx + s) + ',' + (cy) + ' ' +
      (cx) + ',' + (cy + s) + ' ' +
      (cx - s) + ',' + (cy)
    );
    diamond.setAttribute('class', 'diamond');
    group.appendChild(diamond);
  }

  // ── Render nodes ────────────────────────────────────
  data.nodes.forEach(node => {
    const pos = positions[node.id];
    if (!pos) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'node');
    g.setAttribute('transform', 'translate(' + pos.x + ',' + pos.y + ')');
    g.dataset.nodeId = node.id;

    // Node colors
    const colors = {
      file: { stroke: '#818cf8', fill: 'rgba(129,140,248,0.08)', dot: '#818cf8' },
      pr: { stroke: '#22c55e', fill: 'rgba(34,197,94,0.08)', dot: '#22c55e' },
      issue: { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.08)', dot: '#f59e0b' },
      context: { stroke: '#64748b', fill: 'rgba(100,116,139,0.08)', dot: '#64748b' },
    };
    const c = colors[node.type] || colors.context;

    // Satisfaction override for PR nodes
    let satColor = c.dot;
    if (node.type === 'pr' && node.satisfaction >= 0) {
      if (node.satisfaction >= 0.75) satColor = '#22c55e';
      else if (node.satisfaction >= 0.4) satColor = '#f59e0b';
      else satColor = '#ef4444';
    }

    // Background rect with dashed border (like the reference image)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', '' + NODE_W);
    rect.setAttribute('height', '' + NODE_H);
    rect.setAttribute('fill', c.fill);
    rect.setAttribute('stroke', c.stroke);
    rect.setAttribute('class', 'node-rect');
    if (node.type !== 'file') {
      rect.setAttribute('stroke-dasharray', '4,3');
    }
    g.appendChild(rect);

    // Left dot (connection indicator)
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', node.type === 'file' ? '0' : '-1');
    dot.setAttribute('cy', '' + (NODE_H / 2));
    dot.setAttribute('class', 'node-dot');
    dot.setAttribute('fill', satColor);
    g.appendChild(dot);

    // Right dot
    const dotR = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dotR.setAttribute('cx', '' + (NODE_W + 1));
    dotR.setAttribute('cy', '' + (NODE_H / 2));
    dotR.setAttribute('class', 'node-dot');
    dotR.setAttribute('fill', satColor);
    g.appendChild(dotR);

    // Label text
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '12');
    label.setAttribute('y', '' + (NODE_H / 2 + 1));
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('class', 'node-label');
    label.textContent = node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label;
    g.appendChild(label);

    // Count badge
    if (node.count > 0) {
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      badge.setAttribute('x', '' + (NODE_W - 10));
      badge.setAttribute('y', '' + (NODE_H / 2 + 1));
      badge.setAttribute('dominant-baseline', 'middle');
      badge.setAttribute('text-anchor', 'end');
      badge.setAttribute('class', 'node-badge');
      badge.textContent = '' + node.count;
      g.appendChild(badge);
    }

    // Satisfaction bar under node (for PR nodes)
    if (node.type === 'pr' && node.satisfaction >= 0) {
      const barBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      barBg.setAttribute('x', '4');
      barBg.setAttribute('y', '' + (NODE_H - 6));
      barBg.setAttribute('width', '' + (NODE_W - 8));
      barBg.setAttribute('height', '3');
      barBg.setAttribute('fill', 'rgba(255,255,255,0.06)');
      barBg.setAttribute('class', 'sat-bar');
      g.appendChild(barBg);

      const barFill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      barFill.setAttribute('x', '4');
      barFill.setAttribute('y', '' + (NODE_H - 6));
      barFill.setAttribute('width', '' + ((NODE_W - 8) * node.satisfaction));
      barFill.setAttribute('height', '3');
      barFill.setAttribute('fill', satColor);
      barFill.setAttribute('class', 'sat-bar');
      g.appendChild(barFill);
    }

    // Tooltip events
    g.addEventListener('mouseenter', (e) => {
      showTooltip(e, node);
      highlightEdges(node.id, true);
    });
    g.addEventListener('mouseleave', () => {
      hideTooltip();
      highlightEdges(node.id, false);
    });

    group.appendChild(g);
  });

  // ── Auto-fit viewBox ────────────────────────────────
  const allX = Object.values(positions).map(p => p.x);
  const allY = Object.values(positions).map(p => p.y);
  const minX = Math.min(...allX) - PADDING;
  const minY = Math.min(...allY) - PADDING;
  const maxX = Math.max(...allX) + NODE_W + PADDING * 2;
  const maxY = Math.max(...allY) + NODE_H + PADDING * 2;
  svg.setAttribute('viewBox', minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY));

  // ── Pan and zoom ────────────────────────────────────
  let viewBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  let isPanning = false;
  let startPoint = { x: 0, y: 0 };

  container.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node')) return;
    isPanning = true;
    startPoint = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = (e.clientX - startPoint.x) * (viewBox.w / container.clientWidth);
    const dy = (e.clientY - startPoint.y) * (viewBox.h / container.clientHeight);
    viewBox.x -= dx;
    viewBox.y -= dy;
    startPoint = { x: e.clientX, y: e.clientY };
    svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
  });

  window.addEventListener('mouseup', () => { isPanning = false; });

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 1.1 : 0.9;
    const rect = container.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x;
    const my = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y;

    viewBox.w *= scale;
    viewBox.h *= scale;
    viewBox.x = mx - (mx - viewBox.x) * scale;
    viewBox.y = my - (my - viewBox.y) * scale;
    svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
  }, { passive: false });

  // ── Tooltip ─────────────────────────────────────────
  function showTooltip(e, node) {
    let satHtml = '';
    if (node.type === 'pr' && node.satisfaction >= 0) {
      const pct = Math.round(node.satisfaction * 100);
      const color = node.satisfaction >= 0.75 ? 'var(--green)' : node.satisfaction >= 0.4 ? 'var(--yellow)' : 'var(--red)';
      const label = node.satisfaction >= 0.75 ? 'Fresh' : node.satisfaction >= 0.4 ? 'Aging' : 'Stale';
      satHtml = '<div class="tooltip-satisfaction">' +
        '<span>' + label + ' (' + pct + '%)</span>' +
        '<div class="tooltip-bar"><div class="tooltip-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '</div>';
    }

    tooltip.innerHTML =
      '<div class="tooltip-title">' + escapeHtml(node.label) + '</div>' +
      '<div class="tooltip-detail">' + escapeHtml(node.detail.slice(0, 150)) + '</div>' +
      satHtml;
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 10) + 'px';
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

  // ── Edge highlighting ───────────────────────────────
  function highlightEdges(nodeId, on) {
    document.querySelectorAll('.edge').forEach(edge => {
      if (edge.dataset.from === nodeId || edge.dataset.to === nodeId) {
        if (on) {
          edge.classList.add('edge-highlight');
        } else {
          edge.classList.remove('edge-highlight');
        }
      }
    });
  }

  // ── Search ──────────────────────────────────────────
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.node').forEach(node => {
        const nodeData = data.nodes.find(n => n.id === node.dataset.nodeId);
        if (!nodeData) return;
        const match = !q || nodeData.label.toLowerCase().includes(q) || nodeData.detail.toLowerCase().includes(q);
        node.style.opacity = match ? '1' : '0.15';
      });
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
`;
