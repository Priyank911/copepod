"use client";

import { useState, useEffect, useRef } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// Custom SVG Icons matching the technical CAD/drafting blueprint theme
const BrowserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="2" y="3" width="20" height="18" rx="1" ry="1" />
    <line x1="2" y1="8" x2="22" y2="8" />
    <line x1="6" y1="5" x2="6" y2="5.01" />
    <line x1="10" y1="5" x2="10" y2="5.01" />
  </svg>
);

const PlugIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M12 2v6M12 18v4" />
    <rect x="7" y="8" width="10" height="10" rx="2" />
    <line x1="9" y1="18" x2="9" y2="22" />
    <line x1="15" y1="18" x2="15" y2="22" />
  </svg>
);

const RulerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M22 2L2 22h20V2z" />
    <line x1="18" y1="14" x2="15" y2="11" />
    <line x1="14" y1="18" x2="11" y2="15" />
    <line x1="10" y1="22" x2="7" y2="19" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline", marginLeft: "3px" }}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// CAD-style intersection marker at cell corners
function CornerMarkers() {
  return (
    <>
      <div style={{ position: "absolute", top: -5, left: -3.5, fontSize: "10px", color: "var(--cpd-text-tertiary)", pointerEvents: "none", zIndex: 10 }}>+</div>
      <div style={{ position: "absolute", top: -5, right: -3.5, fontSize: "10px", color: "var(--cpd-text-tertiary)", pointerEvents: "none", zIndex: 10 }}>+</div>
      <div style={{ position: "absolute", bottom: -5, left: -3.5, fontSize: "10px", color: "var(--cpd-text-tertiary)", pointerEvents: "none", zIndex: 10 }}>+</div>
      <div style={{ position: "absolute", bottom: -5, right: -3.5, fontSize: "10px", color: "var(--cpd-text-tertiary)", pointerEvents: "none", zIndex: 10 }}>+</div>
    </>
  );
}

// CAD-style decoration arrows in cell footer
function CardArrows() {
  return (
    <div style={{ display: "flex", gap: "6px", fontSize: "10px", color: "var(--cpd-text-tertiary)", fontFamily: "var(--font-mono)", cursor: "default", userSelect: "none" }}>
      <span>←</span>
      <span>→</span>
    </div>
  );
}

// Custom SVG CAD Logo for Copepod
const CopepodLogo = () => (
  <svg width="42" height="42" viewBox="0 0 100 100" fill="none" stroke="var(--cpd-text-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
    <circle cx="50" cy="50" r="45" strokeDasharray="3 3" opacity="0.25" />
    <circle cx="50" cy="50" r="30" strokeDasharray="2 2" opacity="0.15" />
    <path d="M50 20 C60 30, 60 70, 50 80 C40 70, 40 30, 50 20 Z" />
    <line x1="43" y1="38" x2="57" y2="38" />
    <line x1="41" y1="48" x2="59" y2="48" />
    <line x1="43" y1="58" x2="57" y2="58" />
    <line x1="45" y1="68" x2="55" y2="68" />
    <path d="M47 22 C32 16, 22 26, 16 36" />
    <path d="M53 22 C68 16, 78 26, 84 36" />
    <line x1="48" y1="80" x2="45" y2="88" />
    <line x1="52" y1="80" x2="55" y2="88" />
  </svg>
);

// Live Cognee logs simulator data
const SIMULATED_LOGS = [
  { type: "sys", text: "SYS // INITIALIZING COGNEE ENGINE FOR owner/repo..." },
  { type: "sys", text: "SYS // ATTACHING DATABASE: KuzuDB AND LanceDB LOCAL INSTANCES" },
  { type: "ingest", text: "INGEST // FETCHING COMMIT HISTORY & PR METADATA FROM GITHUB" },
  { type: "ingest", text: "INGEST // FOUND 42 MERGED PRs, 18 CLOSED ISSUES, 114 TARGET FILES" },
  { type: "parse", text: "PARSE  // src/auth/session.ts -> analyzing dependencies & calls..." },
  { type: "parse", text: "PARSE  // Extracting context from PR #118: 'Revamp session tokens'" },
  { type: "cognee", text: "COGNEE // Constructing cognitive knowledge graph nodes..." },
  { type: "cognee", text: "COGNEE // [FACT ADDED] User(mohit) -> [MERGED] -> PR(118)" },
  { type: "cognee", text: "COGNEE // [FACT ADDED] PR(118) -> [MODIFIED] -> src/auth/session.ts" },
  { type: "cognee", text: "COGNEE // [FACT ADDED] src/auth/session.ts -> [RESOLVES] -> Issue(104)" },
  { type: "sys", text: "SYS // Ingestion completed: 118 nodes, 342 relations persisted." },
  { type: "mcp", text: "MCP // Client session established: Claude-3.5-Sonnet-Agent" },
  { type: "query", text: "QUERY // 'Why did we change session token management?'" },
  { type: "recall", text: "RECALL // Index search on LanceDB -> traversing KuzuDB paths..." },
  { type: "recall", text: "RECALL // Matches: PR(118) ('Revamp session tokens') resolve Issue(104)" },
  { type: "query", text: "QUERY // Context constructed. Satisfaction score: 94%." },
  { type: "webhook", text: "WEBHOOK // Push event received. Triggering delta update..." },
  { type: "ingest", text: "INGEST // Syncing commit c8f9d12 (1 file modified)" },
  { type: "cognee", text: "COGNEE // Updating node references & pruning stale graph paths..." },
  { type: "sys", text: "SYS // Sync completed. Studio memory graph validated." }
];

function LogSimulator() {
  const [logs, setLogs] = useState<typeof SIMULATED_LOGS>([]);
  const [activeTab, setActiveTab] = useState<"all" | "ingest" | "recall">("all");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs(SIMULATED_LOGS.slice(0, 6));
    let index = 6;

    const interval = setInterval(() => {
      setLogs((prev) => {
        const nextLog = SIMULATED_LOGS[index % SIMULATED_LOGS.length];
        index++;
        const newLogs = [...prev, nextLog];
        if (newLogs.length > 40) {
          newLogs.shift();
        }
        return newLogs;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const filteredLogs = logs.filter((log) => {
    if (activeTab === "all") return true;
    if (activeTab === "ingest") return log.type === "ingest" || log.type === "parse" || log.type === "cognee" || log.type === "sys" || log.type === "webhook";
    if (activeTab === "recall") return log.type === "query" || log.type === "recall" || log.type === "mcp";
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--cpd-bg-alt)", border: "1px solid var(--cpd-divider-strong)", padding: "10px", fontFamily: "var(--font-mono)", fontSize: "11px", boxSizing: "border-box", minHeight: 180 }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--cpd-divider-strong)", paddingBottom: "6px", marginBottom: "8px", color: "var(--cpd-text-secondary)", flexShrink: 0 }}>
        <span>CONSOLES // COGNEE_CORE_LOGS</span>
        <div style={{ display: "flex", gap: "8px" }}>
          <span onClick={() => setActiveTab("all")} style={{ cursor: "pointer", color: activeTab === "all" ? "var(--cpd-text-primary)" : "var(--cpd-text-tertiary)", textDecoration: activeTab === "all" ? "underline" : "none" }}>[ALL]</span>
          <span onClick={() => setActiveTab("ingest")} style={{ cursor: "pointer", color: activeTab === "ingest" ? "var(--cpd-text-primary)" : "var(--cpd-text-tertiary)", textDecoration: activeTab === "ingest" ? "underline" : "none" }}>[INGEST]</span>
          <span onClick={() => setActiveTab("recall")} style={{ cursor: "pointer", color: activeTab === "recall" ? "var(--cpd-text-primary)" : "var(--cpd-text-tertiary)", textDecoration: activeTab === "recall" ? "underline" : "none" }}>[RECALL]</span>
        </div>
      </div>
      
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px", paddingRight: "4px" }} className="custom-scroll">
        {filteredLogs.map((log, idx) => {
          let badgeColor = "#2563eb";
          if (log.type === "ingest" || log.type === "parse" || log.type === "webhook") badgeColor = "#b45309";
          else if (log.type === "cognee") badgeColor = "#be185d";
          else if (log.type === "mcp" || log.type === "query" || log.type === "recall") badgeColor = "#4f46e5";
          
          return (
            <div key={idx} style={{ lineHeight: "1.4", wordBreak: "break-all" }}>
              <span style={{ color: badgeColor, fontWeight: 600, marginRight: "6px" }}>[{log.type.toUpperCase()}]</span>
              <span style={{ color: "var(--cpd-text-secondary)" }}>{log.text}</span>
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <span style={{ color: "var(--cpd-text-secondary)" }}>&gt;</span>
          <span className="pulse-dot" style={{ width: "6px", height: "12px", background: "var(--cpd-text-primary)", display: "inline-block" }} />
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="blueprint-viewport">
      {/* Grid overlay */}
      <div className="grid-overlay" />

      {/* ── Technical Header ────────────────────────────────────────── */}
      <header className="blueprint-header">
        <div>
          <h1 className="blueprint-header-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <img src="/logo-dark.svg" style={{ width: "26px", height: "26px" }} alt="Copepod Logo" /> COPEPOD
          </h1>
          <p style={{ fontSize: "10px", color: "var(--cpd-text-secondary)", marginTop: "4px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
            Institutional Memory for GitHub Repositories
          </p>
        </div>
        <div className="blueprint-header-meta">
          INTEGRATION: COGNEE KNOWLEDGE GRAPH ARCHITECTURE<br />
          STATUS: OPERATIONAL // V1.0.0-PROD
        </div>
      </header>

      {/* ── Main Blueprint Grid ──────────────────────────────────────── */}
      <div className="blueprint-grid">
        
        {/* ── Description ──────────────────────────────────────── */}
        <section className="sheet-box" style={{ gridColumn: "span 2" }}>
          <CornerMarkers />
          <h2 className="sheet-heading">DESCRIPTION</h2>
          <div className="sheet-content-scroll sheet-copy">
            <p style={{ marginBottom: "10px" }}>
              Every engineering team accumulates invisible context over time: why a
              particular function was written defensively, why one approach was chosen
              over a simpler alternative, why code that looks wrong is actually intentional.
            </p>
            <p style={{ marginBottom: "10px" }}>
              That context lives in pull request descriptions, issue threads, review
              comments, and people&apos;s heads. When someone leaves the team, when a new
              contributor joins, or when a production incident hits at 2am — that context
              is effectively gone.
            </p>
            <p>
              Copepod makes it permanent and retrievable. It turns PR history and decisions into a queryable knowledge graph powered by <a href="https://cognee.ai" target="_blank" rel="noreferrer">Cognee<ExternalLinkIcon /></a>.
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px", flexShrink: 0 }}>
            <CardArrows />
          </div>
        </section>

        {/* ── Live Log Simulator ───────────────────────────────── */}
        <section className="sheet-box">
          <CornerMarkers />
          <h2 className="sheet-heading">LIVE SYNCHRONIZATION MONITOR</h2>
          <div style={{ flex: 1, minHeight: 0 }}>
            <LogSimulator />
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section className="sheet-box">
          <CornerMarkers />
          <h2 className="sheet-heading">FEATURES SPECIFICATIONS</h2>
          <div className="sheet-content-scroll sheet-copy" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <strong style={{ color: "var(--cpd-text-primary)", display: "block", fontSize: "11px", marginBottom: "2px" }}>[SPEC-01] SMART INGESTION</strong>
              <p style={{ fontSize: "11px" }}>Ingests merged PRs, closed issues, review comments, and code structure. Converts into structured relationship sentences.</p>
            </div>
            <div>
              <strong style={{ color: "var(--cpd-text-primary)", display: "block", fontSize: "11px", marginBottom: "2px" }}>[SPEC-02] LIVE UPDATES</strong>
              <p style={{ fontSize: "11px" }}>GitHub webhooks keep the knowledge graph current. Every merged PR and closed issue is delta-ingested in seconds.</p>
            </div>
            <div>
              <strong style={{ color: "var(--cpd-text-primary)", display: "block", fontSize: "11px", marginBottom: "2px" }}>[SPEC-03] AUTO ISSUE TRIAGE</strong>
              <p style={{ fontSize: "11px" }}>When a new issue opens, Copepod automatically comments with relevant past issues, likely affected files, and regressions.</p>
            </div>
            <div>
              <strong style={{ color: "var(--cpd-text-primary)", display: "block", fontSize: "11px", marginBottom: "2px" }}>[SPEC-04] ZERO COST RUNTIME</strong>
              <p style={{ fontSize: "11px" }}>Groq + fastembed + KuzuDB + LanceDB. High efficiency, fast performance, self-hosted on a single machine.</p>
            </div>
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────────────── */}
        <section className="sheet-box">
          <CornerMarkers />
          <h2 className="sheet-heading">HOW IT WORKS // PIPELINE</h2>
          <div className="sheet-content-scroll sheet-copy" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "11px", whiteSpace: "pre-wrap", lineHeight: "1.3", color: "var(--cpd-text-tertiary)", marginBottom: "4px" }}>
{`[01 CONNECT] ──> [02 INGEST]
                    │
                    ▼
[04 SYNC]    <── [03 QUERY]`}
            </div>
            <p style={{ fontSize: "11px" }}>
              <strong>1. Connect</strong> — Connect your GitHub repository with a single click.
            </p>
            <p style={{ fontSize: "11px" }}>
              <strong>2. Ingest</strong> — Ingests all PRs, issues, and code structure into a Cognee knowledge graph — isolated per repository.
            </p>
            <p style={{ fontSize: "11px" }}>
              <strong>3. Query</strong> — Ask questions in the Studio, use the MCP tools in your IDE, or check the VS Code sidebar.
            </p>
            <p style={{ fontSize: "11px" }}>
              <strong>4. Sync</strong> — Webhooks keep everything live. Merged PRs validate and reinforce the graph database.
            </p>
          </div>
        </section>

        {/* ── Memory Operations ────────────────────────────────── */}
        <section className="sheet-box">
          <CornerMarkers />
          <h2 className="sheet-heading">COGNEE MEMORY LIFECYCLE</h2>
          <div className="sheet-content-scroll sheet-copy" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "10px", whiteSpace: "pre-wrap", lineHeight: "1.3", color: "var(--cpd-text-tertiary)" }}>
{`[REMEMBER] ───────> [RECALL]
     ▲                 │
     │                 ▼
 [FORGET]  <─────── [IMPROVE]`}
            </div>
            <p style={{ fontSize: "11px" }}>
              <span className="badge badge-green">REMEMBER</span> Ingestion and webhook deltas populate the knowledge graph.
            </p>
            <p style={{ fontSize: "11px" }}>
              <span className="badge" style={{ background: "rgba(37, 99, 235, 0.06)", color: "var(--cpd-accent)", border: "1px solid currentColor" }}>RECALL</span> Context queries retrieve graph nodes and paths.
            </p>
            <p style={{ fontSize: "11px" }}>
              <span className="badge badge-yellow">IMPROVE</span> PR outcomes validate and weight the memory paths.
            </p>
            <p style={{ fontSize: "11px" }}>
              <span className="badge badge-red">FORGET</span> Deletions and repository cleanup prune stale nodes.
            </p>
          </div>
        </section>

        {/* ── Three Surfaces ───────────────────────────────────── */}
        <section className="sheet-box" style={{ gridColumn: "span 2" }}>
          <CornerMarkers />
          <h2 className="sheet-heading">USER INTEGRATION SURFACES</h2>
          <div className="sheet-content-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <div>
              <h3 style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px", color: "var(--cpd-text-primary)" }}>
                <BrowserIcon /> WEB STUDIO
              </h3>
              <p className="sheet-copy" style={{ fontSize: "11px" }}>
                Chat interface with source citations. Ask questions, see which PRs
                and issues the answer came from. Real-time ingestion progress.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px", color: "var(--cpd-text-primary)" }}>
                <PlugIcon /> MCP BRIDGE
              </h3>
              <p className="sheet-copy" style={{ fontSize: "11px" }}>
                Two tools for AI coding agents: <code>ask()</code> for general
                questions and <code>file_context()</code> for file-specific history.
                Works with Claude Code, Cursor, Cline.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px", color: "var(--cpd-text-primary)" }}>
                <RulerIcon /> VS CODE EXTENSION
              </h3>
              <p className="sheet-copy" style={{ fontSize: "11px" }}>
                Sidebar showing PR decision tree for the currently open file.
                Color-coded satisfaction scores tell you how much to trust
                existing code context.
              </p>
            </div>
          </div>
        </section>

        {/* ── CTA / Connect ─────────────────────────────────────── */}
        <section className="sheet-box hatched-bg" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <CornerMarkers />
          <h2 className="sheet-heading" style={{ borderBottomColor: "var(--cpd-text-primary)" }}>GET STARTED</h2>
          <div className="sheet-copy" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "10px", margin: "10px 0" }}>
            <p style={{ fontSize: "11px", fontWeight: 500, color: "var(--cpd-text-primary)" }}>
              CONNECT YOUR GITHUB ACCOUNT AND START QUERYING INSTITUTIONAL MEMORY IN MINUTES.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <a href={`${BACKEND_URL}/auth/github/login`} className="btn-primary" style={{ width: "100%" }}>
                LOGIN WITH GITHUB →
              </a>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: "9px", color: "var(--cpd-text-secondary)" }}>SECURE OAUTH</span>
            <CardArrows />
          </div>
        </section>

      </div>

      {/* ── Technical Footer Bar ────────────────────────────────────── */}
      <footer style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: "10px",
        borderTop: "1px dashed var(--cpd-divider-strong)",
        fontSize: "10px",
        color: "var(--cpd-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        flexShrink: 0
      }}>
        <div style={{ display: "flex", gap: "16px" }}>
          <span>BUILT ON COGNEE</span>
          <span>|</span>
          <span>OPEN SOURCE</span>
          <span>|</span>
          <span>DESIGN SYSTEM V1</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <CopepodLogo />
          <span>COPEPOD SPEC // 2026</span>
        </div>
      </footer>

      {/* Embedded CSS adjustments for layout responsive/scroll heights */}
      <style jsx global>{`
        /* Custom scrollbar adjustments for cards */
        .custom-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.35);
        }
        
        @media (max-width: 768px) {
          .blueprint-viewport {
            height: auto !important;
            max-height: none !important;
            overflow: auto !important;
          }
          .blueprint-grid {
            border: none !important;
          }
          .sheet-box {
            border: 1px dashed var(--cpd-divider-strong) !important;
            margin-bottom: 8px !important;
            height: auto !important;
          }
          .sheet-content-scroll {
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
          }
        }
      `}</style>
    </main>
  );
}
