import { Database, X } from "lucide-react";
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { ContextMenuState, WorkbenchTab } from "../../shared/appTypes";

type TabDragSession = {
  tabId: string;
  startX: number;
  startScrollLeft: number;
  pointerId: number;
  hasMoved: boolean;
  fromIndex: number;
  targetIndex: number;
  tabWidth: number;
};

type TabDragPreview = {
  tabId: string;
  deltaX: number;
  fromIndex: number;
  targetIndex: number;
  tabWidth: number;
};

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
  const dragRef = useRef<TabDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const dropFrameRef = useRef<number | null>(null);
  const [dragPreview, setDragPreview] = useState<TabDragPreview | null>(null);
  const [isDropping, setIsDropping] = useState(false);
  const draggingTabId = dragPreview?.tabId || null;

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

  const getDragTargetIndex = (drag: TabDragSession, deltaX: number) => {
    const lastIndex = tabOrderRef.current.length - 1;
    if (drag.tabWidth <= 0 || lastIndex <= 0) {
      return drag.fromIndex;
    }

    const threshold = drag.tabWidth / 2;
    const indexOffset =
      deltaX > 0 ? Math.floor((deltaX + threshold) / drag.tabWidth) : Math.ceil((deltaX - threshold) / drag.tabWidth);
    return Math.min(Math.max(drag.fromIndex + indexOffset, 0), lastIndex);
  };

  const startTabDrag = (event: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".tab-close")) {
      return;
    }

    const fromIndex = tabOrderRef.current.findIndex((tab) => tab.id === tabId);
    if (fromIndex < 0) {
      return;
    }

    if (dropFrameRef.current !== null) {
      window.cancelAnimationFrame(dropFrameRef.current);
      dropFrameRef.current = null;
    }
    setIsDropping(false);

    dragRef.current = {
      tabId,
      startX: event.clientX,
      startScrollLeft: tabsRef.current?.scrollLeft ?? 0,
      pointerId: event.pointerId,
      hasMoved: false,
      fromIndex,
      targetIndex: fromIndex,
      tabWidth: event.currentTarget.getBoundingClientRect().width
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
    event.preventDefault();
    autoScrollTabs(event.clientX);

    const currentScrollLeft = tabsRef.current?.scrollLeft ?? drag.startScrollLeft;
    const deltaX = event.clientX - drag.startX + currentScrollLeft - drag.startScrollLeft;
    const targetIndex = getDragTargetIndex(drag, deltaX);
    drag.targetIndex = targetIndex;

    setDragPreview({
      tabId: drag.tabId,
      deltaX,
      fromIndex: drag.fromIndex,
      targetIndex,
      tabWidth: drag.tabWidth
    });
  };

  const finishTabDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    suppressClickRef.current = drag.hasMoved;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsDropping(true);
    if (drag.hasMoved && drag.targetIndex !== drag.fromIndex) {
      onReorder(drag.tabId, drag.targetIndex);
    }
    setDragPreview(null);

    dropFrameRef.current = window.requestAnimationFrame(() => {
      dropFrameRef.current = window.requestAnimationFrame(() => {
        setIsDropping(false);
        dropFrameRef.current = null;
      });
    });

    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const cancelTabDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const getTabDragStyle = (tabId: string, index: number): CSSProperties | undefined => {
    if (!dragPreview) {
      return undefined;
    }

    if (dragPreview.tabId === tabId) {
      return { transform: `translateX(${dragPreview.deltaX}px)` };
    }

    if (dragPreview.targetIndex > dragPreview.fromIndex && index > dragPreview.fromIndex && index <= dragPreview.targetIndex) {
      return { transform: `translateX(${-dragPreview.tabWidth}px)` };
    }

    if (dragPreview.targetIndex < dragPreview.fromIndex && index >= dragPreview.targetIndex && index < dragPreview.fromIndex) {
      return { transform: `translateX(${dragPreview.tabWidth}px)` };
    }

    return undefined;
  };

  return (
    <div
      ref={tabsRef}
      className={`request-tabs ${draggingTabId ? "dragging" : ""} ${isDropping ? "dropping" : ""}`}
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
      {tabs.map((tab, index) => {
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
            style={getTabDragStyle(tab.id, index)}
            onPointerDown={(event) => startTabDrag(event, tab.id)}
            onPointerMove={moveTabDrag}
            onPointerUp={finishTabDrag}
            onPointerCancel={cancelTabDrag}
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
