# Verifier Model Routing — Quick Reference

## Provider Setup (one-time)

```bash
# xAI (primary agent) — already configured
# Confirm:
openclaw models auth list

# Codex OAuth (verifier routine + deep checks)
openclaw models auth login --provider openai-codex
# Follow the OAuth flow in browser, paste redirect URL back

# Verify both providers active:
openclaw models list
# Should show: xai/grok-4-1-fast-reasoning, openai-codex/gpt-5.4
```

## Model Routing Map

```
┌─────────────────────────────────────────────────────────┐
│                    AGENT RUNTIME                         │
│                                                         │
│  Primary Agent: xai/grok-4-1-fast-reasoning             │
│  (all goal execution, tool calls, reasoning)            │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                 VERIFIER LAYER                           │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │   Routine Check     │  │     Deep Check            │  │
│  │                     │  │                           │  │
│  │ openai-codex/       │  │ openai-codex/             │  │
│  │   gpt-5.4           │  │   gpt-5.4                 │  │
│  │   fastMode: true    │  │   fastMode: false          │  │
│  │                     │  │                           │  │
│  │ • Periodic scan     │  │ • Sonnet escalation       │  │
│  │ • Inline gate       │  │ • LCM context included    │  │
│  │   (haiku path)      │  │ • Budget-capped           │  │
│  │ • ~800 input tokens │  │ • ~2500 input tokens      │  │
│  └────────┬────────────┘  └────────────┬──────────────┘  │
│           │                            │                 │
│           │  ┌─────────────────────┐   │                 │
│           └──│     FALLBACK        │───┘                 │
│              │                     │                     │
│              │ xai/grok-4-1-      │                     │
│              │   fast-reasoning    │                     │
│              │ (expensive but safe)│                     │
│              └─────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

## Cost Profile

| Check Type | Model                       | FastMode | Auth          | Cost                |
| ---------- | --------------------------- | -------- | ------------- | ------------------- |
| Routine    | openai-codex/gpt-5.4        | true     | ChatGPT OAuth | Subscription (flat) |
| Deep       | openai-codex/gpt-5.4        | false    | ChatGPT OAuth | Subscription (flat) |
| Fallback   | xai/grok-4-1-fast-reasoning | n/a      | xAI API key   | Per-token           |

Routine and deep checks are both covered by ChatGPT subscription — no per-token cost.
Fallback only fires when Codex OAuth is down or rate-limited.

## Escalation Flow with Models

```
Tool call intercepted
  │
  ├─ reversible? → pass through (no model call)
  │
  └─ irreversible?
       │
       ├─ cache warm + on-track? → pass through (no model call)
       │
       └─ cache cold/stale?
            │
            ▼
       ┌─────────────────────────────┐
       │ ROUTINE CHECK               │
       │ openai-codex/gpt-5.4       │
       │ fastMode: true              │
       │                             │
       │ → aligned: yes → pass       │
       │ → aligned: unclear → bump   │
       │    scan frequency            │
       │ → aligned: no               │
       │    confidence >= threshold   │
       │    → nudge / block           │
       │    confidence < threshold    │
       │    → escalate to deep check  │
       └──────────────┬──────────────┘
                      │
                      ▼
       ┌─────────────────────────────┐
       │ DEEP CHECK                  │
       │ openai-codex/gpt-5.4       │
       │ fastMode: false             │
       │ + LCM reasoning traces      │
       │                             │
       │ Budget check first:         │
       │ • Available → proceed       │
       │ • Exhausted → soft block    │
       │                             │
       │ If LCM unavailable:         │
       │ • confidence *= 0.7         │
       │                             │
       │ → verdict: proceed → pass   │
       │ → verdict: modify → nudge   │
       │ → verdict: block → block    │
       └─────────────────────────────┘
```

## Fallback Scenarios

| Scenario                     | Behavior                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| Codex OAuth down             | Routine + deep fall back to Grok (per-token cost)                |
| Codex rate-limited           | Same fallback to Grok                                            |
| Grok also down               | Routine → return "unclear" (safe). Deep → return "block" (safe)  |
| Gateway restart (cold cache) | All checks go through on-demand path until first periodic scan   |
| LCM plugin not installed     | Deep check proceeds without traces, confidence discounted by 0.7 |

## Config in openclaw.json

Add this section alongside your existing config:

```jsonc
{
  // ... existing agents config ...

  "verifier": {
    "scanIntervalMins": 5,
    "scanIntervalUnclearMins": 2,
    "cacheTtlMs": 150000,
    "softThreshold": 0.4,
    "hardThreshold": 0.7,
    "calibration": {
      "minThreshold": 0.25,
      "maxThreshold": 0.85,
      "decayAlpha": 0.3,
    },
    "escalation": {
      "sonnetBudgetPerGoalPerHour": 3,
      "cooldownMs": 60000,
      "baseEscalationThreshold": 0.6,
      "lcmUnavailableConfidenceDiscount": 0.7,
    },
    "tokenBudget": {
      "toolInputTruncateChars": 120,
      "auditWindowMaxEntries": 30,
      "auditWindowMaxMinutes": 15,
    },
    "models": {
      "routine": "openai-codex/gpt-5.4",
      "routineParams": { "fastMode": true },
      "deep": "openai-codex/gpt-5.4",
      "deepParams": { "fastMode": false },
      "fallback": "xai/grok-4-1-fast-reasoning",
      "fallbackParams": {},
    },
  },
}
```

## Operational Rollout

### 1. Enable the verifier in `~/.openclaw/openclaw.json`

```jsonc
{
  "verifier": {
    "enabled": true,
    "models": {
      "routine": "openai-codex/gpt-5.4",
      "deep": "openai-codex/gpt-5.4",
      "fallback": "xai/grok-4-1-fast-reasoning",
    },
  },
}
```

The `models` block is optional because these are already the defaults in
`DEFAULT_VERIFIER_CONFIG`, but keeping it in the config makes the verifier
setup self-documenting.

### 2. Verify the Codex auth profile exists

```bash
# Check existing auth profiles for the default agent
cat ~/.openclaw/agents/*/auth-profiles.json | grep -o '"openai-codex[^"]*"' | head -5
```

If no Codex profile exists, run onboarding or direct auth login:

```bash
openclaw onboard --provider openai-codex
```

Or:

```bash
openclaw models auth login --provider openai-codex
```

If OpenClaw was already onboarded with Codex OAuth, this profile should
already exist.

### 3. Verify the fallback auth profile (optional)

```bash
cat ~/.openclaw/agents/*/auth-profiles.json | grep -o '"xai[^"]*"' | head -5
```

If xAI auth is missing, the fallback chain in `src/verifier/llm-call.ts`
will degrade to safe defaults instead of crashing:

- routine check parse failure path returns `aligned: "unclear"` with `confidence: 0.3`
- deep check parse failure path returns a safe block verdict

### 4. Smoke test

```bash
# Rebuild
pnpm build

# Run verifier tests
pnpm test -- src/verifier/
```

Then start the gateway, trigger an agent turn, and watch logs for:

```text
Verifier calling openai-codex/gpt-5.4
```

## Files Generated

| File                             | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `src/verifier/types.ts`          | All types, interfaces, constants, schema version                     |
| `src/verifier/llm-call.ts`       | LlmCallFn factory, response parsing, budget tracker, fallback chain  |
| `src/verifier/gateway-wiring.ts` | Cache impl, config merge, initializeVerifier(), integration snippets |
| `openclaw.verifier.jsonc`        | Annotated config block to merge into openclaw.json                   |
