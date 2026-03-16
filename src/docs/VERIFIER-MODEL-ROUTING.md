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

## Files Generated

| File                             | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `src/verifier/types.ts`          | All types, interfaces, constants, schema version                     |
| `src/verifier/llm-call.ts`       | LlmCallFn factory, response parsing, budget tracker, fallback chain  |
| `src/verifier/gateway-wiring.ts` | Cache impl, config merge, initializeVerifier(), integration snippets |
| `openclaw.verifier.jsonc`        | Annotated config block to merge into openclaw.json                   |
