# Implementation Plan: Session Persistence & Library

## Phase 1: Persistence Foundation

- [ ] Research and select an IndexedDB wrapper (e.g., idb or dexie) or plan raw implementation
- [ ] Define IndexedDB schema for sessions, messages, and project state
- [ ] Implement `StorageController` to handle IndexedDB lifecycle

## Phase 2: Project State

- [ ] Implement state serialization for active project and UI layout
- [ ] Integrate auto-save into the main application loop
- [ ] Implement state restoration on initial load

## Phase 3: Library UI

- [ ] Create the `LibraryView` component
- [ ] Implement session listing with metadata (timestamps, last message preview)
- [ ] Add session deletion and renaming functionality
- [ ] Implement "Resume" action to switch active session state
