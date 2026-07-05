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
import { marked } from "marked";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface UserProfile {
  id: number;
  github_login: string;
  github_name: string | null;
  avatar_url: string | null;
  api_key: string | null;
}

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
  context_snippet?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  reasoning_steps?: string[];
}

export default function StudioPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeRepo, setActiveRepo] = useState<Repo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [addRepoInput, setAddRepoInput] = useState("");
  const [addingRepo, setAddingRepo] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [repoProgress, setRepoProgress] = useState<Record<number, number>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourcesRef = useRef<Record<number, EventSource>>({});

  // Fetch repos on mount
  useEffect(() => {
    fetchRepos();
    fetchUser();

    // Cleanup all EventSources on unmount
    return () => {
      Object.values(eventSourcesRef.current).forEach((es) => es.close());
    };
  }, []);

  // Track progress of syncing repos using SSE
  useEffect(() => {
    repos.forEach((repo) => {
      if (!repo.is_ingested && !eventSourcesRef.current[repo.id]) {
        try {
          const es = new EventSource(`${BACKEND_URL}/repos/${repo.id}/progress`, {
            withCredentials: true,
          });

          es.onmessage = (e) => {
            try {
              const data = JSON.parse(e.data);
              const pct = data.progress ?? 0;
              setRepoProgress((prev) => ({ ...prev, [repo.id]: pct }));

              if (data.status === "completed") {
                setRepos((prev) =>
                  prev.map((r) => (r.id === repo.id ? { ...r, is_ingested: true } : r))
                );
                setActiveRepo((prev) =>
                  prev && prev.id === repo.id ? { ...prev, is_ingested: true } : prev
                );
                es.close();
                delete eventSourcesRef.current[repo.id];
              } else if (data.status === "failed") {
                es.close();
                delete eventSourcesRef.current[repo.id];
              }
            } catch (err) {
              console.error("Error parsing progress SSE event:", err);
            }
          };

          es.onerror = () => {
            es.close();
            delete eventSourcesRef.current[repo.id];
          };

          eventSourcesRef.current[repo.id] = es;
        } catch (err) {
          console.error(`Failed to connect progress SSE for repo ${repo.id}:`, err);
        }
      }
    });
  }, [repos]);

  const fetchUser = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch (e) {
      console.error("Failed to fetch user:", e);
    }
  };

  const deleteRepo = async (repoId: number, repoName: string) => {
    if (
      !window.confirm(
        `Are you sure you want to permanently remove "${repoName}"?\nThis will delete its webhooks, database record, and prune its Cognee knowledge graph memory.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/repos/${repoId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        // Close event source if any
        if (eventSourcesRef.current[repoId]) {
          eventSourcesRef.current[repoId].close();
          delete eventSourcesRef.current[repoId];
        }

        // Clean up progress state
        setRepoProgress((prev) => {
          const updated = { ...prev };
          delete updated[repoId];
          return updated;
        });

        setRepos((prev) => prev.filter((r) => r.id !== repoId));

        if (activeRepo?.id === repoId) {
          setActiveRepo(null);
          setMessages([]);
          setSources([]);
        }
      } else {
        alert("Failed to delete repository from Copepod.");
      }
    } catch (e) {
      console.error("Failed to delete repo:", e);
      alert("Network error: Could not complete repository deletion.");
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch history when active repo changes
  useEffect(() => {
    if (activeRepo) {
      fetchChatHistory(activeRepo.id);
    } else {
      setMessages([]);
      setSources([]);
      setSelectedSource(null);
    }
  }, [activeRepo]);

  const fetchChatHistory = async (repoId: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/repos/${repoId}/chat/history`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        const mappedMessages: Message[] = data.map((msg: any) => ({
          role: msg.role,
          content: msg.content,
          sources: msg.sources || [],
          reasoning_steps: msg.reasoning_steps || [],
        }));
        setMessages(mappedMessages);
        const botMessages = mappedMessages.filter((m) => m.role === "assistant");
        if (botMessages.length > 0) {
          const lastBotMsg = botMessages[botMessages.length - 1];
          setSources(lastBotMsg.sources || []);
          if (lastBotMsg.sources && lastBotMsg.sources.length > 0) {
            setSelectedSource(lastBotMsg.sources[0]);
          } else {
            setSelectedSource(null);
          }
        } else {
          setSources([]);
          setSelectedSource(null);
        }
      }
    } catch (e) {
      console.error("Failed to fetch chat history:", e);
    }
  };

  const clearChatHistory = async () => {
    if (!activeRepo) return;
    if (!window.confirm("Are you sure you want to clear your chat history for this repository?")) {
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/repos/${activeRepo.id}/chat/history`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setMessages([]);
        setSources([]);
        setSelectedSource(null);
      } else {
        alert("Failed to clear chat history.");
      }
    } catch (e) {
      console.error("Failed to clear chat history:", e);
      alert("Network error: Could not clear chat history.");
    }
  };

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
          reasoning_steps: data.reasoning_steps,
        };
        setMessages((prev) => [...prev, botMsg]);
        if (data.sources?.length > 0) {
          setSources(data.sources);
          setSelectedSource(data.sources[0]);
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
          {repos.map((repo) => {
            const pct = repoProgress[repo.id] || 0;
            const radius = 6;
            const strokeWidth = 1.5;
            const strokeDasharray = 2 * Math.PI * radius;
            const strokeDashoffset = strokeDasharray - (strokeDasharray * pct) / 100;

            return (
              <div
                key={repo.id}
                className={`studio-repo-item ${activeRepo?.id === repo.id ? "active" : ""}`}
                onClick={() => {
                  setActiveRepo(repo);
                  setMessages([]);
                  setSources([]);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.5rem 0.75rem",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                  <span style={{ opacity: 0.5 }}>⊢</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 12,
                    }}
                    title={repo.full_name}
                  >
                    {repo.full_name}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {!repo.is_ingested ? (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 4 }}
                      title={`Ingesting progress: ${pct}%`}
                    >
                      <svg width="14" height="14" style={{ transform: "rotate(-90deg)" }}>
                        <circle
                          cx="7"
                          cy="7"
                          r={radius}
                          fill="transparent"
                          stroke="var(--studio-border)"
                          strokeWidth={strokeWidth}
                        />
                        <circle
                          cx="7"
                          cy="7"
                          r={radius}
                          fill="transparent"
                          stroke="#eab308" /* yellow/amber */
                          strokeWidth={strokeWidth}
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          style={{ transition: "stroke-dashoffset 0.3s ease" }}
                        />
                      </svg>
                      <span
                        style={{
                          fontSize: 9,
                          color: "var(--studio-text-dim)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {pct}%
                      </span>
                    </div>
                  ) : (
                    <span className="badge badge-green" style={{ fontSize: 9 }}>
                      READY
                    </span>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRepo(repo.id, repo.full_name);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--studio-text-dim)",
                      cursor: "pointer",
                      fontSize: 11,
                      padding: "2px 4px",
                      opacity: 0.6,
                      transition: "opacity 0.2s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                    title="Remove Repository"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}

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

        {/* ── User Profile ────────────────────────────── */}
        {user && (
          <div
            style={{
              padding: "0.75rem",
              borderTop: "1px solid var(--studio-border)",
              marginTop: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.github_login}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: "1px solid var(--studio-border)",
                  }}
                />
              )}
              <div style={{ overflow: "hidden" }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--studio-text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {user.github_name || user.github_login}
                </div>
                <div style={{ fontSize: 10, color: "var(--studio-text-dim)" }}>
                  @{user.github_login}
                </div>
              </div>
            </div>

            {/* API Key section */}
            {user.api_key && (
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--studio-text-dim)",
                    marginBottom: 3,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  API Key (for MCP / VS Code)
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <code
                    style={{
                      flex: 1,
                      fontSize: 10,
                      padding: "3px 6px",
                      background: "var(--studio-bg)",
                      border: "1px solid var(--studio-border)",
                      borderRadius: 3,
                      color: "var(--studio-text-dim)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      navigator.clipboard.writeText(user.api_key || "");
                    }}
                    title="Click to copy"
                  >
                    {showApiKey ? user.api_key : "•".repeat(20)}
                  </code>
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--studio-text-dim)",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: 2,
                    }}
                    title={showApiKey ? "Hide" : "Show"}
                  >
                    {showApiKey ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
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
            {activeRepo && messages.length > 0 && (
              <button
                onClick={clearChatHistory}
                style={{
                  background: "transparent",
                  border: "1px solid var(--studio-border)",
                  borderRadius: 4,
                  padding: "4px 8px",
                  color: "var(--studio-text-dim)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
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
                Clear History
              </button>
            )}
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

            {messages.map((msg, i) => {
              const isBot = msg.role === "assistant";
              return (
              <div
                key={i}
                className={`msg ${msg.role === "user" ? "msg-user" : "msg-bot"} fade-in-up`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                  <div 
                    className="markdown-content"
                    dangerouslySetInnerHTML={{ __html: marked.parse(msg.content || "") as string }} 
                  />

                  {isBot && msg.reasoning_steps && msg.reasoning_steps.length > 0 && (
                    <details style={{ marginTop: "0.75rem", fontSize: 11, color: "var(--studio-text-dim)" }}>
                      <summary style={{ cursor: "pointer", outline: "none", userSelect: "none", color: "var(--studio-accent)" }}>
                        View Reasoning Trace
                      </summary>
                      <div style={{ 
                        marginTop: "0.375rem", 
                        padding: "0.625rem", 
                        background: "var(--studio-surface)", 
                        border: "1px solid var(--studio-border)", 
                        borderRadius: 6,
                        fontFamily: "var(--font-mono)",
                        lineHeight: "1.4"
                      }}>
                        {msg.reasoning_steps.map((step, idx) => (
                          <div key={idx} style={{ marginBottom: "0.25rem" }}>{step}</div>
                        ))}
                      </div>
                    </details>
                  )}

                {msg.sources && msg.sources.length > 0 && (
                  <div style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {msg.sources.map((s, j) => (
                        <span 
                          key={j} 
                          className="msg-citation"
                          onClick={() => setSelectedSource(s)}
                          style={{ cursor: "pointer" }}
                        >
                        {s.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              );
            })}

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
      <aside className="source-panel" style={{ overflowY: "auto", maxHeight: "100vh" }}>
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
          Sources & Reasonings
        </h3>

        {selectedSource && (
          <div className="source-detail-card fade-in-up" style={{ 
            padding: "1rem",
            background: "var(--studio-surface)",
            border: "1px solid var(--studio-accent)",
            borderRadius: 8,
            marginBottom: "1.5rem",
            fontSize: 12
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <strong style={{ color: "var(--studio-accent)", fontSize: 13 }}>{selectedSource.title}</strong>
              <button 
                onClick={() => setSelectedSource(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--studio-text-dim)",
                  cursor: "pointer",
                  fontSize: 12
                }}
              >
                ✕ Close
              </button>
            </div>
            <div style={{ color: "var(--studio-text-dim)", fontSize: 11, marginBottom: "0.75rem" }}>
              Type: {selectedSource.type} &bull; Relevance: {Math.round(selectedSource.relevance * 100)}%
            </div>
            <div style={{ 
              background: "var(--studio-bg)", 
              padding: "0.75rem", 
              borderRadius: 6, 
              border: "1px solid var(--studio-border)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
              color: "var(--studio-text)"
            }}>
              {selectedSource.context_snippet || "No additional text snippet available."}
            </div>
          </div>
        )}

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
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <span style={{ fontSize: 10, color: "var(--studio-text-dim)", fontWeight: 500 }}>
              CLICK CARD TO VIEW DETAILED REASONING SNIPPET:
            </span>
            {sources.map((s, i) => (
              <div 
                key={i} 
                className="source-card fade-in-up" 
                onClick={() => setSelectedSource(s)}
                style={{ 
                  animationDelay: `${i * 80}ms`,
                  cursor: "pointer",
                  border: selectedSource?.title === s.title ? "1px solid var(--studio-accent)" : "1px solid var(--studio-border)"
                }}
              >
              <div className="source-card-title">{s.title}</div>
              <div className="source-card-meta">
                <span>Type: {s.type}</span>
                <br />
                <span>Relevance: {Math.round(s.relevance * 100)}%</span>
              </div>
            </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
