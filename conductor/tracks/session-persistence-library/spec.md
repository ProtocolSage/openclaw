# Specification: Session Persistence & Library

## Goal

Implement a robust session persistence layer using IndexedDB to store project state and conversation history, and provide a library view for users to manage their sessions.

## Key Features

- **IndexedDB Integration:** Reliable local storage for large session datasets, replacing or supplementing `localStorage`.
- **Project State Management:** Persist the active project, open files, and agent state across reloads.
- **Library View:** A dedicated UI section to browse, search, and resume past sessions.

## Technical Constraints

- Must work within the existing Vite/TypeScript UI stack.
- Should follow the established security model.
- Avoid external database dependencies (keep it local-first).
