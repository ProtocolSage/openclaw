import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { pathForTab } from "../navigation.ts";
import { icons } from "../icons.ts";
import type { SessionMetadata } from "../../lib/storage/storage-controller.ts";

export type LibraryProps = {
  loading: boolean;
  sessions: SessionMetadata[];
  currentSessionId: string | null;
  basePath: string;
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
};

export function renderLibrary(props: LibraryProps) {
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; margin-bottom: 16px;">
        <div>
          <div class="card-title">${t("library.title", "Local Library")}</div>
          <div class="card-sub">${t("library.subtitle", "Your persisted local sessions and project history.")}</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("common.loading", "Loading...") : t("common.refresh", "Refresh")}
        </button>
      </div>

      ${props.loading && props.sessions.length === 0
        ? html`<div class="muted">${t("common.loading", "Loading sessions...")}</div>`
        : nothing}

      ${!props.loading && props.sessions.length === 0
        ? html`<div class="muted">${t("library.empty", "No local sessions found. Start a chat to create one.")}</div>`
        : nothing}

      <div class="library-list" style="display: flex; flex-direction: column; gap: 12px;">
        ${props.sessions.map((session) => renderSessionItem(session, props))}
      </div>
    </section>
  `;
}

function renderSessionItem(session: SessionMetadata, props: LibraryProps) {
  const isActive = session.id === props.currentSessionId;
  const updated = formatRelativeTimestamp(session.updatedAt);
  const chatUrl = `${pathForTab("chat", props.basePath)}?session=${encodeURIComponent(session.id)}`;

  return html`
    <div class="card library-item ${isActive ? "library-item--active" : ""}" style="padding: 12px; border: 1px solid var(--border-color); border-radius: 8px;">
      <div class="row" style="justify-content: space-between; align-items: flex-start;">
        <div style="flex: 1; min-width: 0;">
          <div class="row" style="gap: 8px; align-items: center;">
            <a href=${chatUrl} class="library-item__title" style="font-weight: 600; text-decoration: none; color: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${session.title || session.id}
            </a>
            ${isActive ? html`<span class="pill ok" style="font-size: 10px; padding: 2px 6px;">${t("common.active", "Active")}</span>` : nothing}
          </div>
          <div class="muted" style="font-size: 12px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${session.lastMessagePreview || t("library.no_preview", "No messages yet.")}
          </div>
          <div class="muted" style="font-size: 11px; margin-top: 4px;">
            ${t("library.updated", "Updated")} ${updated}
          </div>
        </div>
        <div class="row" style="gap: 8px; margin-left: 16px;">
          <button 
            class="btn btn--icon" 
            title=${t("common.rename", "Rename")}
            @click=${() => {
              const newTitle = prompt(t("library.rename_prompt", "Enter new title:"), session.title);
              if (newTitle && newTitle.trim()) {
                props.onRename(session.id, newTitle.trim());
              }
            }}
          >
            ${icons.edit}
          </button>
          <button 
            class="btn btn--icon danger" 
            title=${t("common.delete", "Delete")}
            @click=${() => {
              if (confirm(t("library.delete_confirm", "Are you sure you want to delete this session?"))) {
                props.onDelete(session.id);
              }
            }}
          >
            ${icons.trash}
          </button>
          <a href=${chatUrl} class="btn" style="text-decoration: none;">
            ${t("library.resume", "Resume")}
          </a>
        </div>
      </div>
    </div>
  `;
}
