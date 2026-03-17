import type {
  Alignment,
  DeepAction,
  DeepVerdict,
  RoutineVerdict,
  Severity,
  VerifierPromptInput,
} from "./types.js";
import { LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT, VERIFIER_SCHEMA_VERSION } from "./types.js";

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

export interface VerifierPromptTemplates {
  haikuSystem: string;
  sonnetSystem: string;
}

export interface BuildVerifierPromptOptions {
  templates?: Partial<VerifierPromptTemplates>;
}

type TemplateVariables = Record<string, string | number>;

const VALID_ALIGNMENTS = new Set<Alignment>(["yes", "no", "unclear"]);
const VALID_SEVERITIES = new Set<Severity>(["low", "medium", "high"]);
const VALID_SONNET_VERDICTS = new Set<DeepAction>(["proceed", "modify", "block"]);

const HAIKU_RESPONSE_SCHEMA = `{
  "schemaVersion": 1,
  "aligned": "yes" | "no" | "unclear",
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "severity": "low" | "medium" | "high"
}`;

const SONNET_RESPONSE_SCHEMA = `{
  "schemaVersion": 1,
  "verdict": "proceed" | "modify" | "block",
  "confidence": 0.0-1.0,
  "reason": "explanation",
  "suggestedCorrection": "string or null"
}`;

export const DEFAULT_HAIKU_SYSTEM_PROMPT_TEMPLATE = `schemaVersion: {schemaVersion}

You are a trajectory verifier for an autonomous agent.
Given the goal, recent actions, and feedback signals,
assess whether the agent's trajectory is aligned with the goal.

Respond with JSON only:
{responseSchema}`;

export const DEFAULT_SONNET_SYSTEM_PROMPT_TEMPLATE = `schemaVersion: {schemaVersion}

Review the agent's full reasoning trace and determine:
1. Is the current action consistent with the goal's intent?
2. Has the agent's approach drifted from earlier reasoning?
3. Should this action proceed, be modified, or be blocked?

Respond with JSON only:
{responseSchema}`;

export const DEFAULT_VERIFIER_PROMPT_TEMPLATES: VerifierPromptTemplates = {
  haikuSystem: DEFAULT_HAIKU_SYSTEM_PROMPT_TEMPLATE,
  sonnetSystem: DEFAULT_SONNET_SYSTEM_PROMPT_TEMPLATE,
};

export interface HaikuParseSuccess {
  ok: true;
  value: RoutineVerdict;
}

export interface HaikuParseFailure {
  ok: false;
  error: HaikuParseError;
  fallback: RoutineVerdict;
}

export type HaikuParseErrorCode =
  | "invalid_json"
  | "invalid_shape"
  | "schema_version_mismatch"
  | "invalid_aligned"
  | "invalid_severity";

export interface HaikuParseError {
  code: HaikuParseErrorCode;
  message: string;
}

export type HaikuParseResult = HaikuParseSuccess | HaikuParseFailure;

export interface SonnetParseSuccess {
  ok: true;
  value: DeepVerdict;
}

export interface SonnetParseFailure {
  ok: false;
  error: SonnetParseError;
  fallbackToHaiku: true;
  fallbackConfidenceMultiplier: number;
}

export type SonnetParseErrorCode =
  | "invalid_json"
  | "invalid_shape"
  | "schema_version_mismatch"
  | "invalid_verdict";

export interface SonnetParseError {
  code: SonnetParseErrorCode;
  message: string;
}

export type SonnetParseResult = SonnetParseSuccess | SonnetParseFailure;

export interface ParseSonnetResponseOptions {
  lcmAvailable?: boolean;
}

export function truncateToolInput(input: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  if (input.length <= maxChars) {
    return input;
  }
  if (maxChars === 1) {
    return "...";
  }
  return `${input.slice(0, maxChars - 3)}...`;
}

export function interpolatePromptTemplate(template: string, variables: TemplateVariables): string {
  return template.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}

export function buildHaikuPrompt(
  input: VerifierPromptInput,
  options?: BuildVerifierPromptOptions,
): PromptMessage[] {
  const templates = resolveTemplates(options?.templates);

  return [
    {
      role: "system",
      content: interpolatePromptTemplate(templates.haikuSystem, {
        responseSchema: HAIKU_RESPONSE_SCHEMA,
        schemaVersion: VERIFIER_SCHEMA_VERSION,
      }),
    },
    {
      role: "user",
      content: buildVerifierPromptBody(input, { includeLcmContext: false }),
    },
  ];
}

export function buildSonnetPrompt(
  input: VerifierPromptInput,
  options?: BuildVerifierPromptOptions,
): PromptMessage[] {
  const templates = resolveTemplates(options?.templates);

  return [
    {
      role: "system",
      content: interpolatePromptTemplate(templates.sonnetSystem, {
        responseSchema: SONNET_RESPONSE_SCHEMA,
        schemaVersion: VERIFIER_SCHEMA_VERSION,
      }),
    },
    {
      role: "user",
      content: buildVerifierPromptBody(input, { includeLcmContext: true }),
    },
  ];
}

export function buildRoutinePrompt(
  input: VerifierPromptInput,
  options?: BuildVerifierPromptOptions,
): PromptMessage[] {
  return buildHaikuPrompt(input, options);
}

export function buildDeepPrompt(
  input: VerifierPromptInput,
  options?: BuildVerifierPromptOptions,
): PromptMessage[] {
  return buildSonnetPrompt(input, options);
}

export function parseHaikuResponse(raw: string): HaikuParseResult {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      fallback: createHaikuFallback(parsed.error.message),
    };
  }

  const schemaResult = validateSchemaVersion(parsed.value.schemaVersion);
  if (!schemaResult.ok) {
    return {
      ok: false,
      error: schemaResult.error,
      fallback: createHaikuFallback(schemaResult.error.message),
    };
  }

  const aligned = parsed.value.aligned;
  if (typeof aligned !== "string" || !VALID_ALIGNMENTS.has(aligned as Alignment)) {
    return {
      ok: false,
      error: createHaikuError("invalid_aligned", "Response aligned must be yes, no, or unclear"),
      fallback: createHaikuFallback("Invalid aligned value"),
    };
  }

  const severity = parsed.value.severity;
  if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity as Severity)) {
    return {
      ok: false,
      error: createHaikuError("invalid_severity", "Response severity must be low, medium, or high"),
      fallback: createHaikuFallback("Invalid severity value"),
    };
  }

  if (typeof parsed.value.reason !== "string" || typeof parsed.value.confidence !== "number") {
    return {
      ok: false,
      error: createHaikuError(
        "invalid_shape",
        "Response must include string reason and numeric confidence",
      ),
      fallback: createHaikuFallback("Invalid response shape"),
    };
  }

  return {
    ok: true,
    value: {
      aligned,
      confidence: clampConfidence(parsed.value.confidence),
      reason: parsed.value.reason,
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      severity,
    },
  };
}

export function parseSonnetResponse(
  raw: string,
  options?: ParseSonnetResponseOptions,
): SonnetParseResult {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) {
    return createSonnetFailure(parsed.error, options);
  }

  const schemaResult = validateSchemaVersion(parsed.value.schemaVersion);
  if (!schemaResult.ok) {
    return createSonnetFailure(schemaResult.error, options);
  }

  const verdict = parsed.value.verdict;
  if (typeof verdict !== "string" || !VALID_SONNET_VERDICTS.has(verdict as DeepAction)) {
    return createSonnetFailure(
      createSonnetError("invalid_verdict", "Response verdict must be proceed, modify, or block"),
      options,
    );
  }

  if (typeof parsed.value.reason !== "string" || typeof parsed.value.confidence !== "number") {
    return createSonnetFailure(
      createSonnetError(
        "invalid_shape",
        "Response must include string reason and numeric confidence",
      ),
      options,
    );
  }

  const suggestedCorrection =
    typeof parsed.value.suggestedCorrection === "string" ? parsed.value.suggestedCorrection : null;

  const discountedConfidence =
    clampConfidence(parsed.value.confidence) *
    (options?.lcmAvailable === false ? LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT : 1);

  return {
    ok: true,
    value: {
      confidence: discountedConfidence,
      reason: parsed.value.reason,
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      suggestedCorrection,
      verdict,
    },
  };
}

export function parseRoutineResponse(raw: string): RoutineVerdict | null {
  const result = parseHaikuResponse(raw);
  return result.ok ? result.value : null;
}

export function parseDeepResponse(raw: string, lcmAvailable: boolean): DeepVerdict | null {
  const result = parseSonnetResponse(raw, { lcmAvailable });
  return result.ok ? result.value : null;
}

function buildVerifierPromptBody(
  input: VerifierPromptInput,
  options: { includeLcmContext: boolean },
): string {
  const sections = [
    formatGoal(input.goal),
    formatTasks(input.recentTasks),
    formatAuditWindow(input.auditWindow),
    formatFeedback(input.recentFeedback),
  ];

  if (input.currentAction) {
    sections.push(formatCurrentAction(input.currentAction));
  }

  if (options.includeLcmContext) {
    sections.push(formatLcmContext(input.lcmContext));
  }

  return sections.join("\n\n");
}

function resolveTemplates(templates?: Partial<VerifierPromptTemplates>): VerifierPromptTemplates {
  return {
    haikuSystem: templates?.haikuSystem ?? DEFAULT_VERIFIER_PROMPT_TEMPLATES.haikuSystem,
    sonnetSystem: templates?.sonnetSystem ?? DEFAULT_VERIFIER_PROMPT_TEMPLATES.sonnetSystem,
  };
}

function formatGoal(goal: VerifierPromptInput["goal"]): string {
  const lines = ["Goal:", `- id: ${goal.id}`, `- title: ${goal.title}`, `- status: ${goal.status}`];

  if (goal.deadlineMs !== undefined) {
    lines.push(`- deadlineMs: ${goal.deadlineMs}`);
  }

  if (goal.priority) {
    lines.push(`- priority: ${goal.priority}`);
  }

  return lines.join("\n");
}

function formatTasks(tasks: VerifierPromptInput["recentTasks"]): string {
  if (tasks.length === 0) {
    return "Recent tasks:\n- none";
  }

  return [
    "Recent tasks:",
    ...tasks.map((task) => {
      return `- ${task.title} | status=${task.status} | lastUpdatedAt=${task.lastUpdatedAt}`;
    }),
  ].join("\n");
}

function formatAuditWindow(auditWindow: VerifierPromptInput["auditWindow"]): string {
  if (auditWindow.length === 0) {
    return "Audit window:\n- none";
  }

  return [
    "Audit window:",
    ...auditWindow.map((entry) => {
      return `- ${entry.toolName} | outcome=${entry.outcome} | at=${entry.at}`;
    }),
  ].join("\n");
}

function formatFeedback(feedback: VerifierPromptInput["recentFeedback"]): string {
  if (feedback.length === 0) {
    return "Recent feedback:\n- none";
  }

  return [
    "Recent feedback:",
    ...feedback.map((signal) => `- ${signal.type}: ${signal.payloadSummary}`),
  ].join("\n");
}

function formatCurrentAction(action: NonNullable<VerifierPromptInput["currentAction"]>): string {
  return [
    "Current action:",
    `- toolName: ${action.toolName}`,
    `- toolInputSummary: ${action.toolInputSummary}`,
  ].join("\n");
}

function formatLcmContext(lcmContext: VerifierPromptInput["lcmContext"]): string {
  if (!lcmContext?.available) {
    return "LCM context:\n- unavailable";
  }

  const lines = ["LCM context:"];

  if (lcmContext.reasoningTraces.length === 0) {
    lines.push("- reasoningTraces: none");
  } else {
    lines.push("- reasoningTraces:");
    for (const trace of lcmContext.reasoningTraces) {
      lines.push(`  - ${trace}`);
    }
  }

  if (lcmContext.correctionHistory.length === 0) {
    lines.push("- correctionHistory: none");
  } else {
    lines.push("- correctionHistory:");
    for (const item of lcmContext.correctionHistory) {
      lines.push(`  - ${item}`);
    }
  }

  return lines.join("\n");
}

function createHaikuFallback(reason: string): RoutineVerdict {
  return {
    aligned: "unclear",
    confidence: 0.3,
    reason,
    schemaVersion: VERIFIER_SCHEMA_VERSION,
    severity: "medium",
  };
}

function createSonnetFailure(
  error: SonnetParseError,
  options?: ParseSonnetResponseOptions,
): SonnetParseFailure {
  return {
    error,
    fallbackConfidenceMultiplier:
      options?.lcmAvailable === false ? LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT : 0.7,
    fallbackToHaiku: true,
    ok: false,
  };
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, confidence));
}

function validateSchemaVersion(
  schemaVersion: unknown,
): { ok: true } | { ok: false; error: HaikuParseError | SonnetParseError } {
  if (schemaVersion !== VERIFIER_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: "schema_version_mismatch",
        message: `Response schemaVersion must be ${VERIFIER_SCHEMA_VERSION}`,
      },
    };
  }
  return { ok: true };
}

function parseJsonObject(
  raw: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: HaikuParseError | SonnetParseError } {
  try {
    const parsed = JSON.parse(stripMarkdownFences(raw));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: {
          code: "invalid_shape",
          message: "Response must be a JSON object",
        },
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: "Response is not valid JSON",
      },
    };
  }
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function createHaikuError(code: HaikuParseErrorCode, message: string): HaikuParseError {
  return { code, message };
}

function createSonnetError(code: SonnetParseErrorCode, message: string): SonnetParseError {
  return { code, message };
}
