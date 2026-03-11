import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "openclaw-control-plane";
const DB_VERSION = 1;

export interface SessionMetadata {
  id: string;
  title: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  lastMessagePreview?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ProjectState {
  sessionId: string;
  activeProject?: string;
  openFiles: string[];
  selectedFile?: string;
  layout?: Record<string, unknown>;
  agentState?: Record<string, unknown>;
  updatedAt: number;
}

export interface UIState {
  id: "global";
  lastOpenedSessionId?: string;
  sidebarState?: Record<string, unknown>;
  theme?: string;
  updatedAt: number;
  [key: string]: unknown;
}

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
    return db.get("uiState", "global");
  }

  async saveUIState(state: UIState): Promise<void> {
    const db = await this.db;
    await db.put("uiState", { ...state, id: "global" });
  }

  // Sessions
  async getSession(id: string): Promise<SessionMetadata | null> {
    const db = await this.db;
    return db.get("sessions", id);
  }

  async saveSession(session: SessionMetadata): Promise<void> {
    const db = await this.db;
    await db.put("sessions", session);
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const db = await this.db;
    return db.getAll("sessions");
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
    return db.getAllFromIndex("messages", "by-session", sessionId);
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
    return db.get("projectState", sessionId);
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    const db = await this.db;
    await db.put("projectState", state);
  }
}
