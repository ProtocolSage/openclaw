import type { SessionMetadata } from "../../lib/storage/storage-controller.ts";
import type { OpenClawApp } from "../app.ts";
import { listSessions, deleteSession, saveSession, loadSession } from "../storage.ts";

type LibraryHost = OpenClawApp & {
  librarySessions: SessionMetadata[];
};

export async function loadLibrarySessions(host: OpenClawApp) {
  const libraryHost = host as LibraryHost;
  host.sessionsLoading = true; // Reusing existing session loading state for now or add host.libraryLoading
  try {
    const sessions = await listSessions();
    libraryHost.librarySessions = sessions;
  } catch (err) {
    console.error("Failed to load library sessions:", err);
    host.lastError = String(err);
  } finally {
    host.sessionsLoading = false;
  }
}

export async function deleteLibrarySession(host: OpenClawApp, id: string) {
  try {
    await deleteSession(id);
    await loadLibrarySessions(host);
  } catch (err) {
    console.error("Failed to delete library session:", err);
    host.lastError = String(err);
  }
}

export async function renameLibrarySession(host: OpenClawApp, id: string, newTitle: string) {
  try {
    const session = await loadSession(id);
    if (session) {
      await saveSession({
        ...session,
        title: newTitle,
        updatedAt: Date.now(),
      });
      await loadLibrarySessions(host);
    }
  } catch (err) {
    console.error("Failed to rename library session:", err);
    host.lastError = String(err);
  }
}
