// Lightweight in-memory queue for human-readable system events that should be
// prefixed to the next prompt. We intentionally avoid persistence to keep
// events ephemeral. Events are session-scoped and require an explicit key.

export type SystemEventStatus = "started" | "needs-input" | "finished" | "failed";

export interface CodingAgentEvent {
  kind: "coding-agent";
  status: SystemEventStatus;
  processSessionId: string;
  metadata?: {
    cmdSummary?: string;
    lastLog?: string[];
  };
}

export interface TextSystemEventInput {
  text: string;
  contextKey?: string | null;
}

export interface SystemEvent {
  text: string;
  ts: number;
  contextKey?: string | null;
  kind?: "coding-agent";
  status?: SystemEventStatus;
  processSessionId?: string;
  metadata?: {
    cmdSummary?: string;
    lastLog?: string[];
  };
}

export type SystemEventInput = string | TextSystemEventInput | CodingAgentEvent;

const MAX_EVENTS = 20;

type SessionQueue = {
  queue: SystemEvent[];
  lastText: string | null;
  lastContextKey: string | null;
};

const queues = new Map<string, SessionQueue>();

type SystemEventOptions = {
  sessionKey: string;
  contextKey?: string | null;
};

function requireSessionKey(key?: string | null): string {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) {
    throw new Error("system events require a sessionKey");
  }
  return trimmed;
}

function normalizeContextKey(key?: string | null): string | null {
  if (!key) {
    return null;
  }
  const trimmed = key.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function isSystemEventContextChanged(
  sessionKey: string,
  contextKey?: string | null,
): boolean {
  const key = requireSessionKey(sessionKey);
  const existing = queues.get(key);
  const normalized = normalizeContextKey(contextKey);
  return normalized !== (existing?.lastContextKey ?? null);
}

function getCodingAgentEventText(input: CodingAgentEvent): string {
  const summary = input.metadata?.cmdSummary?.trim();
  const fallback = input.processSessionId
    ? `process ${input.processSessionId}`
    : "coding agent event";
  return `[coding-agent:${input.status}] ${summary || fallback}`;
}

function isCodingAgentEvent(input: SystemEventInput): input is CodingAgentEvent {
  return (
    typeof input === "object" && input !== null && "kind" in input && input.kind === "coding-agent"
  );
}

function normalizeSystemEventInput(
  input: SystemEventInput,
  options: SystemEventOptions,
): SystemEvent | null {
  const contextKey =
    normalizeContextKey(options.contextKey) ??
    (typeof input === "object" && "contextKey" in input
      ? normalizeContextKey(input.contextKey)
      : null);

  if (typeof input === "string") {
    const text = input.trim();
    if (!text) {
      return null;
    }
    return {
      text,
      ts: Date.now(),
      contextKey,
    };
  }

  if (isCodingAgentEvent(input)) {
    return {
      text: getCodingAgentEventText(input),
      ts: Date.now(),
      contextKey,
      kind: input.kind,
      status: input.status,
      processSessionId: input.processSessionId,
      metadata: input.metadata
        ? {
            cmdSummary: input.metadata.cmdSummary,
            lastLog: input.metadata.lastLog ? [...input.metadata.lastLog] : undefined,
          }
        : undefined,
    };
  }

  const text = input.text.trim();
  if (!text) {
    return null;
  }
  return {
    text,
    ts: Date.now(),
    contextKey,
  };
}

export function enqueueSystemEvent(input: SystemEventInput, options: SystemEventOptions): boolean {
  const key = requireSessionKey(options?.sessionKey);
  const event = normalizeSystemEventInput(input, options);
  if (!event) {
    return false;
  }
  const entry =
    queues.get(key) ??
    (() => {
      const created: SessionQueue = {
        queue: [],
        lastText: null,
        lastContextKey: null,
      };
      queues.set(key, created);
      return created;
    })();

  entry.lastContextKey = event.contextKey ?? null;
  if (entry.lastText === event.text) {
    return false;
  }
  entry.lastText = event.text;
  entry.queue.push(event);
  if (entry.queue.length > MAX_EVENTS) {
    entry.queue.shift();
  }
  return true;
}

export function drainSystemEventEntries(sessionKey: string): SystemEvent[] {
  const key = requireSessionKey(sessionKey);
  const entry = queues.get(key);
  if (!entry || entry.queue.length === 0) {
    return [];
  }
  const out = entry.queue.slice();
  entry.queue.length = 0;
  entry.lastText = null;
  entry.lastContextKey = null;
  queues.delete(key);
  return out;
}

export function drainSystemEvents(sessionKey: string): string[] {
  return drainSystemEventEntries(sessionKey).map((event) => event.text);
}

export function peekSystemEventEntries(sessionKey: string): SystemEvent[] {
  const key = requireSessionKey(sessionKey);
  return queues.get(key)?.queue.map((event) => ({ ...event })) ?? [];
}

export function peekSystemEvents(sessionKey: string): string[] {
  return peekSystemEventEntries(sessionKey).map((event) => event.text);
}

export function hasSystemEvents(sessionKey: string) {
  const key = requireSessionKey(sessionKey);
  return (queues.get(key)?.queue.length ?? 0) > 0;
}

export function resetSystemEventsForTest() {
  queues.clear();
}
