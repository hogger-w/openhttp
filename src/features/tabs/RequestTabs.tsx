import { X } from "lucide-react";
import type { ContextMenuState, RequestTab } from "../../shared/appTypes";

export function RequestTabs({
  tabs,
  activeTabId,
  dirtyTabIds,
  onActivate,
  onClose,
  onOpenContextMenu
}: {
  tabs: RequestTab[];
  activeTabId: string | null;
  dirtyTabIds: Set<string>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOpenContextMenu: (menu: ContextMenuState) => void;
}) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      className="request-tabs"
      onWheel={(event) => {
        event.preventDefault();
        event.currentTarget.scrollLeft += event.deltaY || event.deltaX;
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const tabElement = (event.target as HTMLElement).closest<HTMLElement>("[data-tab-id]");
        const tabId = tabElement?.dataset.tabId || activeTabId || tabs[0]?.id;
        if (tabId) {
          onOpenContextMenu({ type: "tab", tabId, x: event.clientX, y: event.clientY });
        }
      }}
    >
      {tabs.map((tab) => (
        <div
          role="button"
          tabIndex={0}
          data-tab-id={tab.id}
          className={`request-tab ${activeTabId === tab.id ? "active" : ""}`}
          key={tab.id}
          onClick={() => onActivate(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              onActivate(tab.id);
            }
          }}
          title={tab.draft.name}
        >
          {dirtyTabIds.has(tab.id) && <span className="tab-dirty-indicator" title="Unsaved changes" />}
          <span className={`tab-kind ${tab.draft.type === "websocket" ? "ws" : tab.draft.method.toLowerCase()}`}>
            {tab.draft.type === "websocket" ? "WS" : tab.draft.method}
          </span>
          <span className="tab-title">{tab.draft.name}</span>
          <button
            className="tab-close"
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
            title="Close tab"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
