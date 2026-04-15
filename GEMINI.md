# OpenClaw 🦞

OpenClaw is a self-hosted, multi-channel AI gateway that connects messaging platforms (WhatsApp, Telegram, Discord, iMessage, etc.) to AI agents. It serves as a bridge for personal AI assistants, providing tool use, sessions, memory, and multi-agent routing.

## Project Overview

- **Technologies:** Node.js (22.12+ required), TypeScript (ESM), pnpm, Bun (preferred for execution), Vitest, Lit (UI).
- **Architecture:**
  - **Gateway:** The core process (control plane) managing sessions, routing, and channel connections.
  - **Agents:** Pluggable AI brains (e.g., Pi agent) that process messages and use tools.
  - **Nodes:** Companion apps on macOS, iOS, and Android for system integration (Canvas, camera, voice).
  - **Extensions:** Workspace packages for optional channels (e.g., MS Teams, Matrix) and capabilities.
- **Key Principles:** Security-first, self-hosted, hackable (TypeScript), and agent-native.

## Building and Running

- **Install Dependencies:** `pnpm install`
- **Build Project:** `pnpm build` (compiles TypeScript to `dist/`)
- **Run in Development:** `pnpm dev` or `node scripts/run-node.mjs`
- **CLI Entry:** `openclaw.mjs` (proxies to `dist/entry.js`)
- **Onboarding:** `openclaw onboard` (interactive setup wizard)
- **Start Gateway:** `openclaw gateway run` (runs the server, default port `18789`)
- **UI Development:** `pnpm ui:dev` (starts the Lit-based web control UI)

## Testing and Quality

- **Unit/Integration Tests:** `pnpm test` (Vitest)
- **Coverage:** `pnpm test:coverage` (V8 coverage, 70% threshold)
- **Linting:** `pnpm check` (runs `oxlint` and various custom lint scripts)
- **Formatting:** `pnpm format:fix` (uses `oxfmt`)
- **Protocol Generation:** `pnpm protocol:gen` (generates JSON schemas for the gateway protocol)

## Development Conventions

- **Language:** TypeScript (ESM). Prefer strict typing; avoid `any`.
- **Naming:** Use **OpenClaw** for product/headings; `openclaw` for CLI, package, and config keys.
- **English:** Use American English (e.g., "color", "behavior") in code, comments, docs, and UI.
- **UI:** The Control UI uses **Lit** with **legacy decorators** (`@state()`, `@property()`).
- **Commits:** Use `scripts/committer "<msg>" <file...>` to ensure scoped staging.
- **PRs:** One topic per PR. Mark AI-assisted PRs clearly. Resolve bot review conversations yourself.
- **Docs:** Hosted on Mintlify. Internal links in `docs/` should be root-relative without extensions.
- **Security:** Never commit secrets. Use `openclaw config set` for local configuration.

## Key Directories

- `src/`: Core logic including CLI (`src/cli`), Gateway (`src/gateway`), and Commands (`src/commands`).
- `extensions/`: Plugin packages (e.g., `extensions/whatsapp`, `extensions/telegram`).
- `apps/`: Mobile (Android, iOS) and Desktop (macOS) source code.
- `ui/`: Web-based Control UI source.
- `docs/`: Mintlify documentation source.
- `scripts/`: Build, release, and automation scripts.

## Reference

- **Vision:** See `VISION.md` for high-level goals and roadmap.
- **Contributing:** See `CONTRIBUTING.md` for maintainer info and detailed PR guidelines.
- **Repository Guidelines:** See `AGENTS.md` for exhaustive operational rules, including Parallels smoke playbooks and release procedures.
- **Security Policy:** See `SECURITY.md` for the trust model and reporting vulnerabilities.
