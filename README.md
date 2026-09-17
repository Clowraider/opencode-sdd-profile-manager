# OpenCode SDD Profile Manager

![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)
![OpenCode](https://img.shields.io/badge/OpenCode-%3E%3D%201.17.11-111827)
![Tests](https://img.shields.io/badge/tests-600%20passing-22c55e)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-2.2.1-orange)

A keyboard-first OpenCode TUI plugin for creating, managing, versioning, and activating AI model profiles across Spec-Driven Development (SDD) agents. Built around a **Model Priority Architecture (High, Medium, Low, Auxiliaries)**, granular reasoning effort configuration, resilient fallback routing, and local Engram memory integration.

---

## Visual Showcase

### 1. Fast Profile Selector
Switch active profiles instantly with fuzzy search and persistent activation across OpenCode sessions.

<p align="center">
  <img src="img/Captura%20desde%202026-09-17%2012-09-45.png" alt="OpenCode SDD Profile Selector Dialog" width="720" />
</p>

### 2. Tiered Model Navigation
Agents are organized into operational priority tiers to quickly inspect assignments, effort levels, and fallbacks.

<p align="center">
  <img src="img/Captura%20desde%202026-09-17%2012-10-02.png" alt="Profile View showing High, Medium, Low, and Auxiliary Priority Tiers" width="720" />
</p>

### 3. Model Priority Strategy
Balance cognitive reasoning power, latency, and token consumption by aligning model tiers with task complexity.

<p align="center">
  <img src="img/Captura%20desde%202026-09-09%2022-00-17.png" alt="SDD Model Priority Strategy and Agent Mapping" width="720" />
</p>

---

## Agent Priority Architecture

Rather than treating every agent identically, the Profile Manager groups 25+ agents into four distinct operational tiers:

| Priority Tier | Recommended Model Strategy | Covered Agents |
|---|---|---|
| 🔴 **Prioridad alta** (High Priority) | **Flagship reasoning models** with extended thinking. Dedicated to architecture, implementation, adversarial verification, and risk auditing where accuracy is paramount. | `Orchestrator` (`sdd-ORCHETATOR` / `gentle-orchestrator`), `sdd-propose`, `sdd-design`, `sdd-apply`, `sdd-verify`, `review-risk` (R1), `review-reliability` (R3), `review-resilience` (R4), `review-refuter`, `review-validator`, `jd-judge-a`, `jd-judge-b`, `jd-fix-agent` |
| 🟡 **Prioridad media** (Medium Priority) | **Balanced models** with strong comprehension and high throughput. Ideal for exploration, specification drafting, task planning, and readability review. | `sdd-explore`, `sdd-spec`, `sdd-tasks`, `review-readability` (R2) |
| 🟢 **Prioridad baja** (Low Priority) | **Fast & economical models**. Low-latency, deterministic execution for context bootstrapping, artifact archiving, and interactive onboarding. | `sdd-init`, `sdd-archive`, `sdd-onboard` |
| ⚙️ **Auxiliares** (Auxiliaries) | **Specialized utilities**. Model auditing, platform-specific validation, memory compaction, and session summarization. | `model-audit`, `gentle-ai-windows-validator`, `compaction`, `summary`, `title` |

---

## Key Features

- **Tiered Agent Catalog**: Agents are structured by priority (🔴 High, 🟡 Medium, 🟢 Low, and Auxiliaries) for intuitive visual scanning and configuration.
- **Grouped Bulk Actions**: Assign a model or reasoning effort to an entire priority tier in one step, or target all agents with complete auxiliary coverage.
- **Granular Reasoning Effort**: Set reasoning effort levels (`low`, `medium`, `high`, `xhigh`, `max`, or provider default) per agent or per tier.
- **Resilient Fallbacks**: Define secondary and tertiary fallback models to ensure sub-agent execution recovers smoothly from API rate limits or outages.
- **Profile Import & Export**: Export individual profiles or entire multi-profile bundles to portable JSON, and import them seamlessly across team members.
- **Orchestrator Normalization**: Transparent compatibility and alias synchronization between `sdd-ORCHETATOR` and canonical `gentle-orchestrator`.
- **Atomic Snapshots & Rollback**: Automatic version snapshots protect configurations before bulk edits, allowing one-click rollback to prior stable states.
- **Engram Memory Integration**: Browse and inspect project memory observations via local HTTP loopback (`http://127.0.0.1:7437`).

---

## Quick Start

1. Open OpenCode and press **`Alt+K`** (or type **`/sdd-model`** in chat).
2. Select **Manage SDD profiles**.
3. Choose **Create new SDD profile** and enter a name (e.g. `google-pro-01`).
4. In **Acciones masivas...**, assign models and reasoning effort by priority tier (🔴 High, 🟡 Medium, 🟢 Low) or individually.
5. Select **Activate profile** to apply the configuration to OpenCode.
6. Reopen the profile list to verify the active profile indicator.

Profiles and snapshot histories are stored in your home directory:

```text
~/.config/opencode/profiles/             # JSON profile configurations
~/.config/opencode/profile-versions/    # Version snapshot backups
```

---

## Installation

### Option A — Versioned Release (Recommended)

Download the latest release archive (`sdd-profile-manager-v2.2.1.zip` or `.tar.gz`) from GitHub Releases.

1. Extract into your OpenCode plugins directory:
   - **Linux / macOS**: `~/.config/opencode/plugins/sdd-profile-manager`
   - **Windows**: `C:\Users\<user>\.config\opencode\plugins\sdd-profile-manager`

2. Register the plugin in `tui.json` (`~/.config/opencode/tui.json`):

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": [
       "~/.config/opencode/plugins/sdd-profile-manager/dist/tui.js"
     ]
   }
   ```

3. Restart OpenCode.

### Option B — Canonical npm Package

Configure OpenCode to load the package directly:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-sdd-profile-manager"
  ]
}
```

### Option C — Build from Source

```bash
git clone https://github.com/Clowraider/opencode-sdd-profile-manager.git
cd opencode-sdd-profile-manager
nvm use
npm ci
npm run build
```

Register the absolute path to `dist/tui.js` in your `tui.json` and restart OpenCode.

---

## Architecture & Subsystem Boundaries

The plugin operates as an isolated OpenTUI component. It interacts strictly through validated OpenCode host APIs and never mutates unrelated settings:

```text
OpenCode Host (TUI & Server Runtime)
    │
    ├── index.tsx                        # Lifecycle, command registry, status badge
    │
    └── src/dialogs.tsx                  # OpenTUI workflows, sizing, and navigation
            │
            ├── src/catalog.ts           # Tiered catalog (High, Medium, Low, Aux) & eligibility rules
            ├── src/profiles.ts          # Profile I/O, atomic persistence, version snapshots, import/export
            ├── src/profile-reasoning.ts # Reasoning effort provider resolution
            ├── src/orchestrator.ts      # Orchestrator prompt aliases & fallback policy
            ├── src/host-compat.ts       # OpenTUI screen-aware dialog sizing & graceful degradation
            ├── src/memories.ts          # Engram HTTP client for project observations
            └── src/config.ts            # Configuration paths & project resolution
```

---

## Security & Privacy

- **Zero Credential Storage**: Profile configurations never store API keys, tokens, or credentials.
- **Local-First Processing**: All profile switching, catalog queries, and snapshot backups execute strictly on your local workstation.
- **Loopback Engram HTTP Boundary**: Communicates with Engram via `http://127.0.0.1:7437` over local loopback; memory observations never leave your machine.
- **Path Sanitization**: Profile names and file references are strictly validated to prevent directory traversal (`../`).

---

## Verification & Testing

The repository enforces comprehensive test suites and strict type checking:

```bash
# Clean dependency installation
npm ci

# TypeScript typechecking
npm run typecheck

# Vitest test suite (600 passing tests)
npm test

# Verify fallback policies
npm run test:fallback

# Check orchestrator fallback consistency
npm run orchestrator:fallback:check

# Production build
npm run build
```

---

## Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| `Alt+K` does not open dialog | Shortcut conflict or plugin not registered | Use `/sdd-model` in chat. Verify `dist/tui.js` path in `tui.json` and restart OpenCode. |
| Active profile indicator missing | Profile not yet activated | Open the profile in the manager and choose **Activate profile**. |
| Reasoning effort option disabled | Selected model does not expose reasoning levels | Select a model supporting configurable reasoning (e.g. Claude 3.7 Sonnet, o-series, Gemini Flash Thinking). |
| Auxiliaries not updated in bulk assign | Running an older build | Version 2.2.1 resolves full catalog coverage including all auxiliary agents. |
| Engram memories empty in dialog | Engram daemon not running | Ensure Engram is running on `http://127.0.0.1:7437`. Profile management continues functioning independently. |

---

## Documentation Index

| Document | Purpose |
|---|---|
| [`docs/installation.md`](docs/installation.md) | In-depth installation instructions and environment setup |
| [`docs/usage.md`](docs/usage.md) | Guide for profile lifecycle, bulk actions, and reasoning effort |
| [`docs/architecture.md`](docs/architecture.md) | Architectural specifications and subsystem boundaries |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Detailed diagnostic runbooks for keybindings, plugins, and Engram |
| [`docs/testing.md`](docs/testing.md) | Test suite organization, coverage standards, and verification commands |
| [`docs/compatibility.md`](docs/compatibility.md) | Host API contracts and OpenTUI version compatibility |
| [`docs/dialogs.md`](docs/dialogs.md) | Screen-aware dialog sizing and responsive layout rules |
| [`docs/profile-reasoning-effort.md`](docs/profile-reasoning-effort.md) | Reasoning effort configuration and model metadata reference |
| [`docs/publish.md`](docs/publish.md) | Release workflows and artifact distribution |

---

## License & Attribution

Originally derived from [`j0k3r-dev-rgl/sdd-engram-plugin`](https://github.com/j0k3r-dev-rgl/sdd-engram-plugin) under the MIT License. All original copyright and license notices are fully preserved in [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).

Distributed under the [MIT License](LICENSE).
