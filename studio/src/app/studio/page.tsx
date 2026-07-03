"use client";

/**
 * Copepod Studio — Three-panel chat interface.
 *
 * Layout:
 * ┌──────────┬──────────────────────┬──────────┐
 * │ Sidebar  │        Chat          │  Sources │
 * │ (repos)  │    (messages)        │ (PRs,    │
 * │          │                      │  issues) │
 * │          │ ──────────────────── │          │
 * │          │   [input field]      │          │
 * └──────────┴──────────────────────┴──────────┘
 */

import { useState, useRef, useEffect, FormEvent } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface Repo {
  id: number;
  full_name: string;
  is_ingested: boolean;
  dataset_name: string;
}

interface Source {
  type: string;
  title: string;
  url?: string;
  relevance: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

export default function StudioPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeRepo, setActiveRepo] = useState<Repo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [addRepoInput, setAddRepoInput] = useState("");
  const [addingRepo, setAddingRepo] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch repos on mount
  useEffect(() => {
    fetchRepos();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchRepos = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/repos`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data);
        if (data.length > 0 && !activeRepo) {
          setActiveRepo(data[0]);
        }
      }
    } catch (e) {
      console.error("Failed to fetch repos:", e);
    }
  };

  const addRepo = async (e: FormEvent) => {
    e.preventDefault();
    if (!addRepoInput.trim()) return;
    setAddingRepo(true);
    try {
      const res = await fetch(`${BACKEND_URL}/repos`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: addRepoInput.trim() }),
      });
      if (res.ok) {
        const newRepo = await res.json();
        setRepos((prev) => [newRepo, ...prev]);
        setActiveRepo(newRepo);
        setAddRepoInput("");
      }
    } catch (e) {
      console.error("Failed to add repo:", e);
    } finally {
      setAddingRepo(false);
    }
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeRepo || loading) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/repos/${activeRepo.id}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMsg.content }),
      });

      if (res.ok) {
        const data = await res.json();
        const botMsg: Message = {
          role: "assistant",
          content: data.answer,
          sources: data.sources,
        };
        setMessages((prev) => [...prev, botMsg]);
        if (data.sources?.length > 0) {
          setSources(data.sources);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, I encountered an error. Please try again." },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error. Is the backend running?" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="studio-layout">
      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside className="studio-sidebar">
        <div className="studio-sidebar-header" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <img src="/logo-light.svg" style={{ width: "20px", height: "20px" }} alt="Copepod Logo" />
          COPEPOD
        </div>

        {/* Add repo form */}
        <form
          onSubmit={addRepo}
          style={{
            padding: "0.5rem",
            borderBottom: "1px solid var(--studio-border)",
          }}
        >
          <input
            type="text"
            value={addRepoInput}
            onChange={(e) => setAddRepoInput(e.target.value)}
            placeholder="owner/repo"
            disabled={addingRepo}
            style={{
              width: "100%",
              padding: "0.375rem 0.625rem",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              background: "var(--studio-bg)",
              border: "1px solid var(--studio-border)",
              borderRadius: 4,
              color: "var(--studio-text)",
              outline: "none",
            }}
          />
        </form>

        <div className="studio-sidebar-list">
          {repos.map((repo) => (
            <div
              key={repo.id}
              className={`studio-repo-item ${activeRepo?.id === repo.id ? "active" : ""}`}
              onClick={() => {
                setActiveRepo(repo);
                setMessages([]);
                setSources([]);
              }}
            >
              <span style={{ opacity: 0.5 }}>⊢</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {repo.full_name}
              </span>
              {repo.is_ingested ? (
                <span className="badge badge-green" style={{ fontSize: 9 }}>READY</span>
              ) : (
                <span className="badge badge-yellow" style={{ fontSize: 9 }}>SYNCING</span>
              )}
            </div>
          ))}

          {repos.length === 0 && (
            <div
              style={{
                padding: "2rem 0.75rem",
                textAlign: "center",
                color: "var(--studio-text-dim)",
                fontSize: 12,
              }}
            >
              No repos connected.
              <br />
              Add one above to get started.
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Chat Area ─────────────────────────────────────── */}
      <main className="studio-main">
        <div className="studio-chat">
          {/* Header bar */}
          <div
            style={{
              padding: "0.75rem 1.5rem",
              borderBottom: "1px solid var(--studio-border)",
              fontSize: 12,
              color: "var(--studio-text-dim)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {activeRepo ? (
                <>
                  <span style={{ color: "var(--studio-text)" }}>{activeRepo.full_name}</span>
                  {" — "}
                  {activeRepo.is_ingested ? "Ready" : "Ingesting..."}
                </>
              ) : (
                "Select a repository"
              )}
            </span>
            <span style={{ fontSize: 11, opacity: 0.5 }}>
              DATASET: {activeRepo?.dataset_name || "—"}
            </span>
          </div>

          {/* Messages */}
          <div className="studio-messages">
            {messages.length === 0 && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "1rem",
                  color: "var(--studio-text-dim)",
                }}
              >
                <img src="/logo-light.svg" style={{ width: "48px", height: "48px" }} alt="Copepod Logo" />
                <div style={{ textAlign: "center", maxWidth: 400, marginTop: "8px" }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--studio-text)", marginBottom: 8 }}>
                    Copepod Studio
                  </p>
                  <p style={{ fontSize: 12, lineHeight: 1.6 }}>
                    Ask anything about your repository&apos;s history.
                    Copepod will query the knowledge graph and cite the PRs
                    and issues it found.
                  </p>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    justifyContent: "center",
                    maxWidth: 520,
                    marginTop: "0.5rem",
                  }}
                >
                  {[
                    "Why was this function written this way?",
                    "What issues are related to the auth module?",
                    "Which PRs touched the payment flow?",
                    "Has this approach been tried before?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        background: "var(--studio-surface)",
                        border: "1px solid var(--studio-border)",
                        borderRadius: 6,
                        color: "var(--studio-text-dim)",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                      onMouseEnter={(e) => {
                        (e.target as HTMLButtonElement).style.borderColor = "var(--studio-accent)";
                        (e.target as HTMLButtonElement).style.color = "var(--studio-text)";
                      }}
                      onMouseLeave={(e) => {
                        (e.target as HTMLButtonElement).style.borderColor = "var(--studio-border)";
                        (e.target as HTMLButtonElement).style.color = "var(--studio-text-dim)";
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`msg ${msg.role === "user" ? "msg-user" : "msg-bot"} fade-in-up`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {msg.content}
                {msg.sources && msg.sources.length > 0 && (
                  <div style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {msg.sources.map((s, j) => (
                      <span key={j} className="msg-citation">
                        {s.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="msg msg-bot fade-in-up" style={{ display: "flex", gap: 6, padding: "0.75rem 1rem" }}>
                <span className="pulse-dot">●</span>
                <span className="pulse-dot" style={{ animationDelay: "0.2s" }}>●</span>
                <span className="pulse-dot" style={{ animationDelay: "0.4s" }}>●</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form className="studio-input-area" onSubmit={sendMessage}>
            <input
              className="studio-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                activeRepo
                  ? `Ask about ${activeRepo.full_name}...`
                  : "Select a repository first"
              }
              disabled={!activeRepo || loading}
            />
          </form>
        </div>
      </main>

      {/* ── Source Panel ────────────────────────────────────────── */}
      <aside className="source-panel">
        <h3
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--studio-text-dim)",
            marginBottom: "1rem",
          }}
        >
          Sources
        </h3>

        {sources.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "2rem 0",
              color: "var(--studio-text-dim)",
              fontSize: 12,
            }}
          >
            Sources will appear here
            <br />
            when you ask a question.
          </div>
        ) : (
          sources.map((s, i) => (
            <div key={i} className="source-card fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="source-card-title">{s.title}</div>
              <div className="source-card-meta">
                <span>Type: {s.type}</span>
                <br />
                <span>Relevance: {Math.round(s.relevance * 100)}%</span>
              </div>
            </div>
          ))
        )}
      </aside>
    </div>
  );
}
