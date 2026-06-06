import { Database, X } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ContextMenuState, WorkbenchTab } from "../../shared/appTypes";

export function RequestTabs({
  tabs,
  activeTabId,
  dirtyTabIds,
  onActivate,
  onClose,
  onReorder,
  onOpenContextMenu
}: {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  dirtyTabIds: Set<string>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorder: (tabId: string, nextIndex: number) => void;
  onOpenContextMenu: (menu: ContextMenuState) => void;
}) {
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabOrderRef = useRef(tabs);
  const dragRef = useRef<{ tabId: string; startX: number; pointerId: number; hasMoved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

  tabOrderRef.current = tabs;

  if (tabs.length === 0) {
    return null;
  }

  const autoScrollTabs = (clientX: number) => {
    const tabsElement = tabsRef.current;
    if (!tabsElement) {
      return;
    }

    const rect = tabsElement.getBoundingClientRect();
    const edgeSize = 32;
    if (clientX < rect.left + edgeSize) {
      tabsElement.scrollLeft -= 14;
    } else if (clientX > rect.right - edgeSize) {
      tabsElement.scrollLeft += 14;
    }
  };

  const reorderDraggedTab = (tabId: string, clientX: number) => {
    const tabsElement = tabsRef.current;
    const currentTabs = tabOrderRef.current;
    if (!tabsElement || currentTabs.length < 2) {
      return;
    }

    const fromIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    if (fromIndex < 0) {
      return;
    }

    const nextIndex = Array.from(tabsElement.querySelectorAll<HTMLElement>("[data-tab-id]"))
      .filter((element) => element.dataset.tabId !== tabId)
      .reduce((index, element) => {
        const rect = element.getBoundingClientRect();
        return clientX > rect.left + rect.width / 2 ? index + 1 : index;
      }, 0);

    if (nextIndex !== fromIndex) {
      onReorder(tabId, nextIndex);
    }
  };

  const startTabDrag = (event: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".tab-close")) {
      return;
    }

    dragRef.current = {
      tabId,
      startX: event.clientX,
      pointerId: event.pointerId,
      hasMoved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveTabDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (!drag.hasMoved && Math.abs(event.clientX - drag.startX) < 6) {
      return;
    }

    drag.hasMoved = true;
    suppressClickRef.current = true;
    setDraggingTabId(drag.tabId);
    event.preventDefault();
    autoScrollTabs(event.clientX);
    reorderDraggedTab(drag.tabId, event.clientX);
  };

  const finishTabDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    suppressClickRef.current = drag.hasMoved;
    dragRef.current = null;
    setDraggingTabId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  return (
    <div
      ref={tabsRef}
      className={`request-tabs ${draggingTabId ? "dragging" : ""}`}
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
      {tabs.map((tab) => {
        const folder = tab.kind === "environment" ? tab.environment.folder : tab.draft.folder;
        const folderName = folder ? folder.split("/").at(-1) || folder : "";
        const title = tab.kind === "request" ? tab.draft.name : folderName ? `${folderName} Environment` : "Environment";

        return (
          <div
            role="button"
            tabIndex={0}
            data-tab-id={tab.id}
            className={`request-tab ${activeTabId === tab.id ? "active" : ""} ${draggingTabId === tab.id ? "dragging" : ""}`}
            key={tab.id}
            onPointerDown={(event) => startTabDrag(event, tab.id)}
            onPointerMove={moveTabDrag}
            onPointerUp={finishTabDrag}
            onPointerCancel={finishTabDrag}
            onClick={(event) => {
              if (suppressClickRef.current) {
                event.preventDefault();
                event.stopPropagation();
                suppressClickRef.current = false;
                return;
              }
              onActivate(tab.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                onActivate(tab.id);
              }
            }}
            title={folder ? `${title} - ${folder}` : title}
          >
            {dirtyTabIds.has(tab.id) && <span className="tab-dirty-indicator" title="Unsaved changes" />}
            {tab.kind === "request" ? (
              <span className={`tab-kind ${tab.draft.type === "websocket" ? "ws" : tab.draft.method.toLowerCase()}`}>
                {tab.draft.type === "websocket" ? "WS" : tab.draft.method}
              </span>
            ) : (
              <span className="tab-kind env">
                <Database size={12} />
                ENV
              </span>
            )}
            <span className="tab-title">{title}</span>
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
        );
      })}
    </div>
  );
}
