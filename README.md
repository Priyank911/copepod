<p align="center">
  <img src="https://raw.githubusercontent.com/topoteretes/cognee/main/docs/img/cognee_logo.png" width="280" alt="Cognee Logo" />
</p>

<h1 align="center">🦐 Copepod</h1>

<p align="center">
  <strong>The Institutional Memory Layer for GitHub Repositories</strong>
</p>

<p align="center">
  <a href="https://github.com/topoteretes/cognee">
    <img src="https://img.shields.io/badge/Memory%20Engine-Cognee-blueviolet?style=flat-square" alt="Memory Engine: Cognee" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License: MIT" />
  <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/Built%20For-Cognee%20Hackathon%202026-ff69b4?style=flat-square" alt="Built For: Cognee Hackathon" />
</p>

---

## 💡 What is Copepod?

Every software engineering team accumulates **invisible context** over time:
* Why a particular function was written defensively with complex try-catch statements.
* Why a simpler approach was rejected in favor of a more elaborate design pattern.
* Why a line of code that looks like a bug is actually a critical workaround for an undocumented API limitation.

This context is the team's **institutional memory**. Unfortunately, it is scattered across transient channels: pull request descriptions, code review comments, closed issue threads, and developers' heads. When engineers leave, or a production outage strikes at 2 AM, this context is gone.

**Copepod solves developer amnesia.** It ingests your repository's entire history (PRs, issues, AST code structure) and constructs a semantic knowledge graph using [Cognee](https://github.com/topoteretes/cognee) as the graph memory engine. It exposes this memory through three powerful interfaces: a **Web Studio**, an **MCP Server**, and an interactive **VS Code Graph Sidebar**.

---

## ⚡ Key Surfaces

### 1. 🖥️ Web Studio (Next.js)
A Next.js frontend built with a **minimalist, grid-based engineering blueprint aesthetic** inspired by drafting sheets.
* Track repository ingestion progress in real-time using Server-Sent Events (SSE).
* Chat with your repository's history to query developer intent.
* View exact source citations linking answers back to the relevant PR numbers, issues, or code symbols.

### 2. 🔌 MCP Bridge (Model Context Protocol)
Exposes the repository's institutional memory directly to your local AI coding assistants (like **Claude Code, Cursor, Cline, or Copilot**).
* **`ask(question)`**: Let AI agents query the repo's decision history before rewriting code.
* **`file_context(file_path)`**: Instantly returns a structured breakdown of every pull request and issue that has ever modified the active file.

### 3. 📐 VS Code Extension (Decision Graph)
A custom sidebar containing an **interactive SVG-based node hierarchy graph**.
* **Auto-Detection**: Auto-detects the active repository by scanning `.git/config` for origin remotes.
* **Visual Traces**: Renders a center file node connected to its modifying Pull Requests (left) and resolved Issues (right), featuring curved interactive paths and diamond gateway intersections.
* **Code Trust Scorer**: Calculates a **Code Satisfaction Score (0.0 - 1.0)** for code stability based on recency, commits-since-merge, and regression history, visualised as green, yellow, or red trust bars.

---

## 🧠 Cognee Memory Lifecycle

Copepod implements a complete memory lifecycle using Cognee's four core operations:

```
                  ┌───────────────────────────────┐
                  │           REMEMBER            │
                  │   Ingest PRs, Issues, AST    │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
 ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
 │    IMPROVE    │◄───────┤    RECALL     ├───────►│    FORGET     │
 │ Reinforce on  │        │ Ask Studio,   │        │ Prune deleted │
 │  merged PRs   │        │  MCP, VS Code │        │  files/repos  │
 └───────────────┘        └───────────────┘        └───────────────┘
```

1. **`remember()` (Ingestion)**: Triggers during initial repository setup and incremental GitHub webhook events (PR merges, issue closures).
2. **`recall()` (Retrieval)**: Executes during search and chat queries from the Web Studio, VS Code Sidebar, MCP tools, and automated triage.
3. **`improve()` (Refinement)**: Triggers when a pull request referencing Copepod context is successfully merged. It validates that the recalled context was accurate, reinforcing the knowledge graph.
4. **`forget()` (Pruning)**: Cleans up memory when a repository is disconnected or when file deletion events are received via push webhooks.

---

## 🏗️ Architecture & Zero-Cost Infrastructure

Copepod is designed to run self-hosted with **$0 infrastructure cost**:

```
                       ┌───────────────────────┐
                       │  VS Code / MCP / Web  │
                       └───────────┬───────────┘
                                   │ HTTPS (X-API-Key / JWT)
                                   ▼
                       ┌───────────────────────┐
                       │   FastAPI Backend     │
                       └───────────┬───────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
       ┌─────────────────────────┐   ┌─────────────────────────┐
       │     GitHub Webhooks     │   │      Cognee Engine      │
       │   Delta updates &       │   │   Isolated datasets     │
       │   Automated Triage      │   │   per repository        │
       └─────────────────────────┘   └────────────┬────────────┘
                                                  │
                ┌────────────────┬────────────────┬───────────────┐
                ▼                ▼                ▼               ▼
         ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ ┌─────────────┐
         │  LiteLLM /  │  │  fastembed  │  │   KuzuDB    │ │  LanceDB    │
         │  Groq API   │  │ (Local CPU) │  │  (Graph DB) │ │ (Vector DB) │
         │ (Free LLM)  │  │ (Embeddings)│  │ (Embedded)  │ │ (Embedded)  │
         └─────────────┘  └─────────────┘  └─────────────┘ └─────────────┘
```

* **Dataset Isolation**: Uses deterministic names (`copepod_{user_id}_{owner}_{repo}`) to completely isolate graph datasets per repository.
* **Granular Formatter**: Converts raw GitHub webhook and API JSON payloads into structured English sentences (`app/services/formatter.py`) to maximize Cognee's entity extraction accuracy.
* **Python AST Parser**: Parses files syntax-by-syntax (`app/services/code_parser.py`) to extract functions, classes, decorators, docstrings, and call-graphs as memory statements.
* **Embedded DBs**: Utilizes KuzuDB (graph) and LanceDB (vector) locally inside the Docker container, requiring zero external database hosting.

---

## 🐳 Docker Quick Start (One Command)

Deploy the entire stack (FastAPI Backend + SQLite + Cognee DBs + Studio Web UI) locally in a single command:

```bash
# 1. Clone the project
git clone https://github.com/your-org/copepod.git
cd copepod

# 2. Configure credentials
cp backend/.env.example backend/.env
# Open backend/.env and populate your GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GROQ_API_KEY.

# 3. Launch with Docker Compose
docker compose up --build
```

* **Web Studio**: Access at `http://localhost:3000`
* **FastAPI Backend Docs**: Access at `http://localhost:8000/docs`

*To include the MCP server in your compose stack, run:*
```bash
docker compose --profile mcp up --build
```

---

## 🛠️ Local Development Setup

If you prefer to run components individually outside of Docker:

### 1. Prerequisite: GitHub OAuth App
1. Go to your GitHub profile → **Settings** → **Developer Settings** → **OAuth Apps** → **New OAuth App**.
2. Set **Homepage URL** to `http://localhost:3000`.
3. Set **Authorization callback URL** to `http://localhost:8000/auth/github/callback`.
4. Copy the **Client ID** and generate a **Client Secret**.

### 2. Backend Installation (Python 3.11+)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install package in editable mode
pip install -e .

# Run migrations/startup tables and launch server
uvicorn app.main:app --reload --port 8000
```

### 3. Studio Web UI Installation (Node 18+)
```bash
cd studio
npm install
npm run dev
# The website will spin up at http://localhost:3000
```

### 4. VS Code Extension Installation
1. Open the `vscode-extension` directory in VS Code.
2. Run `npm install` inside the extension directory.
3. Compile the TypeScript: `npm run compile`.
4. Press `F5` to open a new **Extension Development Host** window.
5. In VS Code Settings, configure:
   * `copepod.apiKey`: Obtain this API key from the Web Studio's profile settings.
   * `copepod.repoId`: The UUID of the repository created in the Studio database.

---

## ⚙️ MCP Server Configuration

Add the Copepod MCP server to your local desktop agent (e.g., Claude Desktop) by editing your configuration file:

* **Location (MacOS/Linux)**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Location (Windows)**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this entry to your config:

```json
{
  "mcpServers": {
    "copepod": {
      "command": "python",
      "args": [
        "-m",
        "copepod_mcp.server"
      ],
      "env": {
        "COPEPOD_CONFIG": "/absolute/path/to/your/project/.copepod/config.json"
      }
    }
  }
}
```

Where `.copepod/config.json` inside your project root contains:
```json
{
  "api_url": "http://localhost:8000",
  "api_key": "your-copepod-api-key",
  "repo_id": "your-repo-uuid"
}
```

---

## 🤝 Contributing

Contributions are what make the open-source community an amazing place to learn, inspire, and create.
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with 💜 using <a href="https://github.com/topoteretes/cognee">Cognee</a> for the Cognee Hackathon 🧠
</p>
