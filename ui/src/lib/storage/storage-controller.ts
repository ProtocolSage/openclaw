const DB_NAME = "openclaw-control-plane";
const DB_VERSION = 1;
type MessageRole = "user" | "assistant" | "system" | "tool";

export type SessionMetadata = {
  id: string;
  title: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  lastMessagePreview?: string;
};

export type Message = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
};

export type ProjectState = {
  sessionId: string;
  activeProject?: string;
  openFiles: string[];
  selectedFile?: string | null;
  layout?: Record<string, unknown>;
  agentState?: Record<string, unknown>;
  updatedAt: number;
};

export type UIState = {
  id: "global";
  lastOpenedSessionId?: string;
  sidebarState?: Record<string, unknown>;
  theme?: string;
  updatedAt: number;
  [key: string]: unknown;
};

type StorageDatabase = IDBDatabase;

function openDatabase(): Promise<StorageDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Failed to open IndexedDB")),
    );
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("uiState")) {
        db.createObjectStore("uiState", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        const messageStore = db.createObjectStore("messages", { keyPath: "id" });
        messageStore.createIndex("by-session", "sessionId");
      }
      if (!db.objectStoreNames.contains("projectState")) {
        db.createObjectStore("projectState", { keyPath: "sessionId" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    );
    request.addEventListener("success", () => resolve(request.result));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener("error", () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed")),
    );
    tx.addEventListener("abort", () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted")),
    );
    tx.addEventListener("complete", () => resolve());
  });
}

function continueCursor(cursor: IDBCursor): Promise<IDBCursor | null> {
  return new Promise((resolve, reject) => {
    const request = cursor.request;
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB cursor advance failed")),
    );
    request.addEventListener("success", () =>
      resolve((request.result as IDBCursor | null) ?? null),
    );
    cursor.continue();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isMessageRole(value: unknown): value is MessageRole {
  return value === "user" || value === "assistant" || value === "system" || value === "tool";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value;
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function parseSessionMetadata(raw: unknown): SessionMetadata | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = readString(raw.id);
  const title = readString(raw.title);
  const createdAt = readNumber(raw.createdAt);
  const updatedAt = readNumber(raw.updatedAt);
  if (!id || !title || createdAt == null || updatedAt == null) {
    return null;
  }
  return {
    id,
    title,
    createdAt,
    updatedAt,
    projectId: readString(raw.projectId),
    archived: readBoolean(raw.archived),
    lastMessagePreview: readString(raw.lastMessagePreview),
  };
}

function parseMessage(raw: unknown): Message | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = readString(raw.id);
  const sessionId = readString(raw.sessionId);
  const role = raw.role;
  const content = readString(raw.content);
  const createdAt = readNumber(raw.createdAt);
  const updatedAt = readNumber(raw.updatedAt);
  if (
    !id ||
    !sessionId ||
    !isMessageRole(role) ||
    !content ||
    createdAt == null ||
    updatedAt == null
  ) {
    return null;
  }
  return {
    id,
    sessionId,
    role,
    content,
    createdAt,
    updatedAt,
    metadata: readUnknownRecord(raw.metadata),
  };
}

function parseProjectState(raw: unknown): ProjectState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const sessionId = readString(raw.sessionId);
  const openFiles = readStringArray(raw.openFiles);
  const updatedAt = readNumber(raw.updatedAt);
  const selectedFile = raw.selectedFile == null ? raw.selectedFile : readString(raw.selectedFile);
  if (
    !sessionId ||
    !openFiles ||
    updatedAt == null ||
    (raw.selectedFile != null && selectedFile === undefined)
  ) {
    return null;
  }
  return {
    sessionId,
    openFiles,
    updatedAt,
    activeProject: readString(raw.activeProject),
    selectedFile: selectedFile ?? null,
    layout: readUnknownRecord(raw.layout),
    agentState: readUnknownRecord(raw.agentState),
  };
}

function parseUiState(raw: unknown): UIState | null {
  if (!isRecord(raw) || raw.id !== "global") {
    return null;
  }
  const updatedAt = readNumber(raw.updatedAt);
  if (updatedAt == null) {
    return null;
  }
  return {
    ...raw,
    id: "global",
    updatedAt,
    lastOpenedSessionId: readString(raw.lastOpenedSessionId),
    sidebarState: readUnknownRecord(raw.sidebarState),
    theme: readString(raw.theme),
  };
}

// --- Storage Controller ---

export class StorageController {
  private db: Promise<StorageDatabase>;

  constructor() {
    this.db = openDatabase();
  }

  // UI State
  async getUIState(): Promise<UIState | null> {
    const db = await this.db;
    return parseUiState(
      await requestToPromise(
        db.transaction("uiState", "readonly").objectStore("uiState").get("global"),
      ),
    );
  }

  async saveUIState(state: UIState): Promise<void> {
    const db = await this.db;
    const tx = db.transaction("uiState", "readwrite");
    tx.objectStore("uiState").put({ ...state, id: "global" });
    await transactionDone(tx);
  }

  // Sessions
  async getSession(id: string): Promise<SessionMetadata | null> {
    const db = await this.db;
    return parseSessionMetadata(
      await requestToPromise(
        db.transaction("sessions", "readonly").objectStore("sessions").get(id),
      ),
    );
  }

  async saveSession(session: SessionMetadata): Promise<void> {
    const db = await this.db;
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put(session);
    await transactionDone(tx);
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const db = await this.db;
    const all = await requestToPromise(
      db.transaction("sessions", "readonly").objectStore("sessions").getAll(),
    );
    return all
      .map(parseSessionMetadata)
      .filter((value): value is SessionMetadata => Boolean(value));
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(["sessions", "messages", "projectState"], "readwrite");
    tx.objectStore("sessions").delete(id);
    tx.objectStore("projectState").delete(id);

    // Delete messages associated with session
    const messageStore = tx.objectStore("messages");
    const index = messageStore.index("by-session");
    let cursor = await requestToPromise(index.openKeyCursor(IDBKeyRange.only(id)));
    while (cursor) {
      messageStore.delete(cursor.primaryKey);
      cursor = await continueCursor(cursor);
    }
    await transactionDone(tx);
  }

  // Messages
  async getMessages(sessionId: string): Promise<Message[]> {
    const db = await this.db;
    const tx = db.transaction("messages", "readonly");
    const all = await requestToPromise(
      tx.objectStore("messages").index("by-session").getAll(sessionId),
    );
    return all.map(parseMessage).filter((value): value is Message => Boolean(value));
  }

  async replaceSessionMessages(sessionId: string, messages: Message[]): Promise<void> {
    const db = await this.db;
    const tx = db.transaction("messages", "readwrite");
    const messageStore = tx.objectStore("messages");
    const index = messageStore.index("by-session");
    let cursor = await requestToPromise(index.openKeyCursor(IDBKeyRange.only(sessionId)));
    while (cursor) {
      messageStore.delete(cursor.primaryKey);
      cursor = await continueCursor(cursor);
    }
    for (const msg of messages) {
      messageStore.put(msg);
    }
    await transactionDone(tx);
  }

  // Project State
  async getProjectState(sessionId: string): Promise<ProjectState | null> {
    const db = await this.db;
    return parseProjectState(
      await requestToPromise(
        db.transaction("projectState", "readonly").objectStore("projectState").get(sessionId),
      ),
    );
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    const db = await this.db;
    const tx = db.transaction("projectState", "readwrite");
    tx.objectStore("projectState").put(state);
    await transactionDone(tx);
  }
}
