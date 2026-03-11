import { isSupportedLocale } from "../i18n/index.ts";
import {
  StorageController,
  type SessionMetadata,
  type Message,
  type ProjectState,
} from "../lib/storage/storage-controller.ts";
import type { ThemeMode } from "./theme.ts";

const LEGACY_KEY = "openclaw.control.settings.v1";
const MIGRATION_COMPLETE_KEY = "openclaw.storage.migrated.v1";

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
  locale?: string;
};

const storage = new StorageController();

export function getDefaultSettings(): UiSettings {
  const defaultUrl = (() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  })();

  return {
    gatewayUrl: defaultUrl,
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
  };
}

/**
 * Legacy sync loader for initial state.
 * Returns what's in localStorage or defaults.
 */
export function loadSettings(): UiSettings {
  const defaults = getDefaultSettings();
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...defaults,
      ...parsed,
      locale: isSupportedLocale(parsed.locale) ? parsed.locale : undefined,
    } as UiSettings;
  } catch {
    return defaults;
  }
}

/**
 * Migration shim: Check if migration is needed and perform it once.
 */
export async function ensureStorageMigrated(): Promise<void> {
  if (localStorage.getItem(MIGRATION_COMPLETE_KEY)) {
    return;
  }

  const legacySettings = loadSettings();
  await storage.saveUIState({
    id: "global",
    updatedAt: Date.now(),
    ...legacySettings,
  });

  localStorage.setItem(MIGRATION_COMPLETE_KEY, "true");
}

export async function loadUIState(): Promise<UiSettings> {
  await ensureStorageMigrated();
  const state = await storage.getUIState();
  const defaults = getDefaultSettings();
  if (!state) {
    return defaults;
  }
  return {
    ...defaults,
    ...state,
  } as UiSettings;
}

export async function saveUIState(settings: UiSettings): Promise<void> {
  await storage.saveUIState({
    ...settings,
    id: "global",
    updatedAt: Date.now(),
  });
  // Keep localStorage in sync for now to support legacy call sites
  localStorage.setItem(LEGACY_KEY, JSON.stringify(settings));
}

export async function persistSessionMessages(sessionId: string, messages: any[]): Promise<void> {
  if (!sessionId) return;

  const internalMessages: Message[] = messages.map((m, i) => ({
    id: m.id || `${sessionId}-${i}-${m.timestamp || Date.now()}`,
    sessionId,
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    createdAt: m.timestamp || Date.now(),
    updatedAt: Date.now(),
    metadata: m.metadata,
  }));

  await storage.saveMessages(internalMessages);

  // Update session preview
  const lastMsg = internalMessages[internalMessages.length - 1];
  if (lastMsg) {
    const existing = await storage.getSession(sessionId);
    await storage.saveSession({
      id: sessionId,
      title: existing?.title || sessionId,
      lastMessagePreview: lastMsg.content.slice(0, 100),
      updatedAt: Date.now(),
      createdAt: existing?.createdAt || Date.now(),
    });
  }
}

// Session management
export async function loadSession(sessionId: string): Promise<SessionMetadata | null> {
...  return storage.getSession(sessionId);
}

export async function saveSession(session: SessionMetadata): Promise<void> {
  return storage.saveSession(session);
}

export async function listSessions(): Promise<SessionMetadata[]> {
  const sessions = await storage.listSessions();
  return [...sessions].toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSession(sessionId: string): Promise<void> {
  return storage.deleteSession(sessionId);
}

// Message management
export async function loadMessages(sessionId: string): Promise<Message[]> {
  return storage.getMessages(sessionId);
}

export async function saveMessages(messages: Message[]): Promise<void> {
  return storage.saveMessages(messages);
}

// Project state management
export async function loadProjectState(sessionId: string): Promise<ProjectState | null> {
  return storage.getProjectState(sessionId);
}

export async function saveProjectState(state: ProjectState): Promise<void> {
  return storage.saveProjectState(state);
}

// Legacy saveSettings export
export function saveSettings(next: UiSettings) {
  saveUIState(next).catch(console.error);
}
