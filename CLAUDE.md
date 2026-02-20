# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This repo (`moltbot`) is a local fork/workspace of **OpenClaw** — a multi-channel personal AI gateway. The authoritative agent instructions live in `AGENTS.md`; this file synthesizes the most critical guidance for Claude Code sessions.

---

## Commands

### Install & Build

```bash
pnpm install                   # Install all deps
pnpm build                     # Full build: bundle UI, compile TS, copy assets
pnpm ui:build                  # Build web UI only
pnpm canvas:a2ui:bundle        # Bundle the A2UI canvas component (required before build)
```

### Type-checking & Linting

```bash
pnpm tsgo                      # Fast TypeScript check (native TS compiler preview)
pnpm check                     # format:check + tsgo + lint:safe-reads + lint
pnpm lint                      # oxlint --type-aware
pnpm lint:fix                  # oxlint --fix + oxfmt --write
pnpm format                    # oxfmt --check
pnpm lint:safe-reads           # Enforce safeReadTextFile usage in memory + tools dirs
```

### Testing

```bash
pnpm test                      # Parallel unit test runner (vitest, forks pool)
pnpm test:fast                 # Unit tests only, no extensions, no gateway
pnpm test:coverage             # Unit tests with v8 coverage report
pnpm test:e2e                  # E2E tests (vitest.e2e.config.ts)
pnpm test:live                 # Live provider tests (requires CLAWDBOT_LIVE_TEST=1)
```

**Run a single test file:**

```bash
pnpm vitest run src/logging/redact.test.ts
pnpm vitest run src/security/safe-file-read.test.ts
```

**Run by test name pattern:**

```bash
pnpm vitest run --reporter=verbose -t "redacts API keys"
```

### Development

```bash
pnpm dev                       # Run CLI via bun in dev mode
pnpm openclaw                  # Run CLI
pnpm gateway:dev               # Start gateway only (skips channels for fast iteration)
pnpm gateway:watch             # Watch + restart gateway on changes
```

### Commits

Use the repo's scoped committer instead of raw git:

```bash
node scripts/committer "<msg>" <file...>
```

Commit message style: `Module: action description` (e.g., `security: add safe-file-read enforcement`).

---

## Architecture Overview

OpenClaw is a **gateway-centric AI assistant**. The gateway is the control plane; the product is the AI agent reachable on every messaging channel.

### Top-level layout

| Path                                                                                           | Role                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/`                                                                                         | Core TypeScript source                                                         |
| `src/gateway/`                                                                                 | WebSocket/HTTP gateway server, protocol, server-methods                        |
| `src/agents/`                                                                                  | Agent orchestration, Pi embedding, tool dispatch, auth profiles, memory search |
| `src/channels/`                                                                                | Shared channel abstractions (allowlists, auth, rate limits, chat type)         |
| `src/telegram/`, `src/discord/`, `src/slack/`, `src/signal/`, `src/imessage/`, `src/whatsapp/` | Per-channel integrations                                                       |
| `src/memory/`                                                                                  | Vector + hybrid (BM25+embedding) memory, SQLite + sqlite-vec, session sync     |
| `src/security/`                                                                                | Credential vault, audit log, redaction, safe-file-read, container monitor      |
| `src/config/`                                                                                  | Config loading, Zod schema, session keys                                       |
| `src/logging/`                                                                                 | Structured logs, redaction middleware, subsystem loggers                       |
| `src/infra/`                                                                                   | Binaries, dotenv, ports, state migrations, outbound sessions                   |
| `src/cli/`                                                                                     | Commander-based CLI wiring, progress bars, prompts                             |
| `src/providers/`                                                                               | AI provider adapters (Anthropic, OpenAI, Bedrock, Gemini, Ollama, …)           |
| `extensions/`                                                                                  | Workspace-package channel plugins (msteams, matrix, zalo, voice-call, …)       |
| `ui/`                                                                                          | Web-based control UI                                                           |
| `apps/`                                                                                        | macOS, iOS, Android native apps                                                |
| `skills/`                                                                                      | Bundled skill packs                                                            |
| `vendor/a2ui/`                                                                                 | A2UI canvas renderer (vendored; bundle with `pnpm canvas:a2ui:bundle`)         |

### Agent pipeline (`src/agents/`)

The agent layer embeds the `@mariozechner/pi-agent-core` runner and wires it to all channels:

- **`pi-embedded-runner.ts`** — Starts/manages Pi agent sessions per conversation
- **`pi-embedded-subscribe.ts`** — Streams replies back to channels (block chunking, reply tags)
- **`pi-embedded-helpers.ts`** — Utility functions for bootstrap context, sanitization
- **`auth-profiles/`** — OAuth token profiles, rotation, cooldown, vault integration
- **`tools/`** — Tool definitions bridged into Pi (canvas, bash, channel tools, media)
- **`skills.ts`** — Workspace skill loading, prompt injection, skill snapshots
- **`memory-search.ts`** — Exposes memory search config to agents

### Memory system (`src/memory/`)

Hybrid search over markdown files + session transcripts using:

- **SQLite + sqlite-vec** for vector storage
- **BM25 full-text search** for keyword ranking
- Embedding providers: OpenAI, Gemini, Voyage (configurable)
- Files are chunked, hashed, and synced via chokidar file watchers
- `manager.ts` is the central coordinator; `qmd-manager.ts` handles query-scoped memory

### Security layer (`src/security/`) — Phase 5 active

Current branch `phase5-credential-protection` adds:

- **`credential-vault.ts`** — Scoped credential storage (keychain on macOS, file fallback), access logging, hash verification
- **`safe-file-read.ts`** — `safeReadTextFile()` wraps fs reads with injection detection; enforced by `pnpm lint:safe-reads`
- **`redact.ts`** — Pattern-based credential redaction in logs (mode: `off | tools | all`)
- **`external-content.ts`** — `deepInspectForInjection()` for prompt injection detection
- **`audit.ts`** — Structured audit log for security events
- **`container-monitor.ts`** — Sandbox escape detection

### Configuration

- Config schema: `src/config/zod-schema.ts`
- Config types: `src/config/types.base.ts`
- Runtime config loads from `~/.openclaw/config.json` and env vars
- Session files: `~/.openclaw/sessions/`, agent dirs: `~/.openclaw/agents/`

### Plugin SDK (`src/plugin-sdk/`)

Exported as `openclaw/plugin-sdk` for extension authors. Extensions must:

- Keep plugin-only deps in their own `package.json`
- Not use `workspace:*` in `dependencies` (npm install breaks)
- Put `openclaw` in `devDependencies` or `peerDependencies`

---

## Code Conventions

- **TypeScript strict mode** — `noImplicitAny`, no `any` types
- **ESM-only** — `.js` extensions in imports even for `.ts` source files
- **Subsystem loggers** — Use `createSubsystemLogger("module/name")` from `src/logging/subsystem.ts`; never `console.log` in production code
- **Dependency injection** — `createDefaultDeps()` pattern for testability; don't hardcode globals
- **File size target** — ~500 LOC per file; split when clarity/testability improves
- **Tool schemas** — No `anyOf`/`oneOf`/`allOf`; use `Type.Optional(...)` not `| null`; no raw `format` property
- **Safe reads** — In `src/memory/` and `src/agents/tools/`, use `safeReadTextFile()` from `src/security/safe-file-read.ts` instead of raw `fs.readFile` (enforced by lint)
- **Naming** — Product/docs headings: `OpenClaw`; CLI/paths/config keys: `openclaw`

## Test Conventions

- Unit tests: `*.test.ts` colocated with source
- E2E tests: `*.e2e.test.ts` (heavier, spin up real contexts)
- Live tests: `*.live.test.ts` (require API keys)
- Coverage thresholds (v8): 70% lines / 70% functions / 55% branches
- `src/gateway/`, `src/channels/`, `src/agents/`, `src/providers/` are excluded from unit coverage (validated via e2e/manual)

## Current Work (Phase 5 Branch)

Branch `phase5-credential-protection` is in progress. Key modified files:

- `src/agents/auth-profiles/` — Vault-backed credential storage for OAuth tokens
- `src/security/credential-vault.ts` — New secure vault implementation
- `src/security/safe-file-read.ts` — New injection-safe file read utility
- `src/logging/redact.ts` — Expanded credential pattern coverage
- `src/memory/manager.ts`, `qmd-manager.ts`, `session-files.ts` — Migrated to `safeReadTextFile`
- `scripts/check-safe-reads.mjs` — New lint script enforcing safe read usage
