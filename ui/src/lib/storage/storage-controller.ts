import { openDB, type IDBPDatabase } from "idb";
import { z } from "zod";

const DB_NAME = "openclaw-control-plane";
const DB_VERSION = 1;

// --- Schemas ---

export const SessionMetadataSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean().optional(),
  lastMessagePreview: z.string().optional(),
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export const ProjectStateSchema = z.object({
  sessionId: z.string(),
  activeProject: z.string().optional(),
  openFiles: z.array(z.string()),
  selectedFile: z.string().nullable().optional(),
  layout: z.record(z.string(), z.unknown()).optional(),
  agentState: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.number(),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;

export const UIStateSchema = z
  .object({
    id: z.literal("global"),
    lastOpenedSessionId: z.string().optional(),
    sidebarState: z.record(z.string(), z.unknown()).optional(),
    theme: z.string().optional(),
    updatedAt: z.number(),
  })
  .catchall(z.unknown());

export type UIState = z.infer<typeof UIStateSchema>;

// --- Storage Controller ---

export class StorageController {
  private db: Promise<IDBPDatabase>;

  constructor() {
    this.db = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // UI State Store
        if (!db.objectStoreNames.contains("uiState")) {
          db.createObjectStore("uiState", { keyPath: "id" });
        }

        // Sessions Store
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "id" });
        }

        // Messages Store
        if (!db.objectStoreNames.contains("messages")) {
          const messageStore = db.createObjectStore("messages", { keyPath: "id" });
          messageStore.createIndex("by-session", "sessionId");
        }

        // Project State Store
        if (!db.objectStoreNames.contains("projectState")) {
          db.createObjectStore("projectState", { keyPath: "sessionId" });
        }
      },
    });
  }

  // UI State
  async getUIState(): Promise<UIState | null> {
    const db = await this.db;
    const raw = await db.get("uiState", "global");
    if (!raw) {
      return null;
    }
    const parsed = UIStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async saveUIState(state: UIState): Promise<void> {
    const db = await this.db;
    await db.put("uiState", { ...state, id: "global" });
  }

  // Sessions
  async getSession(id: string): Promise<SessionMetadata | null> {
    const db = await this.db;
    const raw = await db.get("sessions", id);
    if (!raw) {
      return null;
    }
    const parsed = SessionMetadataSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async saveSession(session: SessionMetadata): Promise<void> {
    const db = await this.db;
    await db.put("sessions", session);
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const db = await this.db;
    const all = await db.getAll("sessions");
    return all
      .map((raw) => SessionMetadataSchema.safeParse(raw))
      .filter((p) => p.success)
      .map((p) => p.data);
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(["sessions", "messages", "projectState"], "readwrite");
    await tx.objectStore("sessions").delete(id);
    await tx.objectStore("projectState").delete(id);

    // Delete messages associated with session
    const messageStore = tx.objectStore("messages");
    const index = messageStore.index("by-session");
    let cursor = await index.openKeyCursor(IDBKeyRange.only(id));
    while (cursor) {
      await messageStore.delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  // Messages
  async getMessages(sessionId: string): Promise<Message[]> {
    const db = await this.db;
    const all = await db.getAllFromIndex("messages", "by-session", sessionId);
    return all
      .map((raw) => MessageSchema.safeParse(raw))
      .filter((p) => p.success)
      .map((p) => p.data);
  }

  async saveMessages(messages: Message[]): Promise<void> {
    const db = await this.db;
    const tx = db.transaction("messages", "readwrite");
    for (const msg of messages) {
      await tx.store.put(msg);
    }
    await tx.done;
  }

  // Project State
  async getProjectState(sessionId: string): Promise<ProjectState | null> {
    const db = await this.db;
    const raw = await db.get("projectState", sessionId);
    if (!raw) {
      return null;
    }
    const parsed = ProjectStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    const db = await this.db;
    await db.put("projectState", state);
  }
}
