# Implementation Plan: Session Persistence & Library

## Phase 1: Persistence Foundation

- [x] Research and select an IndexedDB wrapper (e.g., idb or dexie) or plan raw implementation
- [x] Define IndexedDB schema for sessions, messages, and project state
- [x] Implement `StorageController` to handle IndexedDB lifecycle

## Phase 2: Project State

- [x] Implement state serialization for active project and UI layout
- [x] Integrate auto-save into the main application loop
- [x] Implement state restoration on initial load

## Phase 3: Library UI

- [x] Create the `LibraryView` component
- [x] Implement session listing with metadata (timestamps, last message preview)
- [x] Add session deletion and renaming functionality
- [x] Implement "Resume" action to switch active session state

## Phase 4: Message Persistence & Previews

- [ ] Integrate message persistence into the chat loop
- [ ] Implement local history loading for faster initial rendering
- [ ] Add auto-update for session `lastMessagePreview` and `updatedAt`
