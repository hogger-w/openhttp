import type { RefObject } from "react";
import { Copy, Folder, FolderOpen, Pencil, Plus, Trash2, Wifi, X } from "lucide-react";
import type { ContextMenuState } from "../../shared/appTypes";
import type { RequestDraft } from "../../types";

export function TreeContextMenu({
  menu,
  refObject,
  onCreateRequest,
  onCreateFolder,
  onRenameFolder,
  onOpenFolderLocation,
  onOpenRequestLocation,
  onDuplicateRequest,
  onDeleteRequest,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs
}: {
  menu: ContextMenuState;
  refObject: RefObject<HTMLDivElement | null>;
  onCreateRequest: (type: "http" | "websocket", folder: string) => void;
  onCreateFolder: (folder: string) => void;
  onRenameFolder: (folder: string) => void;
  onOpenFolderLocation: (folder: string) => void;
  onOpenRequestLocation: (request: RequestDraft) => void;
  onDuplicateRequest: (request: RequestDraft) => void;
  onDeleteRequest: (request: RequestDraft) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseAllTabs: () => void;
}) {
  const style = {
    left: Math.max(8, menu.x),
    top: Math.max(48, menu.y)
  };

  if (menu.type === "folder") {
    return (
      <div className="row-menu floating-menu" ref={refObject} style={style}>
        <button onClick={() => onCreateRequest("http", menu.folder)}>
          <Plus size={14} />
          Add HTTP
        </button>
        <button onClick={() => onCreateRequest("websocket", menu.folder)}>
          <Wifi size={14} />
          Add WebSocket
        </button>
        <button onClick={() => onCreateFolder(menu.folder)}>
          <Folder size={14} />
          New Folder
        </button>
        {menu.folder && (
          <button onClick={() => onRenameFolder(menu.folder)}>
            <Pencil size={14} />
            Rename
          </button>
        )}
        <button onClick={() => onOpenFolderLocation(menu.folder)}>
          <FolderOpen size={14} />
          Open in File Explorer
        </button>
      </div>
    );
  }

  if (menu.type === "tab") {
    return (
      <div className="row-menu floating-menu" ref={refObject} style={style}>
        <button onClick={() => onCloseAllTabs()}>
          <X size={14} />
          Close All
        </button>
        <button onClick={() => onCloseTab(menu.tabId)}>
          <X size={14} />
          Close
        </button>
        <button onClick={() => onCloseOtherTabs(menu.tabId)}>
          <X size={14} />
          Close Others
        </button>
      </div>
    );
  }

  return (
    <div className="row-menu floating-menu" ref={refObject} style={style}>
      <button onClick={() => onOpenRequestLocation(menu.request)}>
        <FolderOpen size={14} />
        Open in File Explorer
      </button>
      <button onClick={() => onDuplicateRequest(menu.request)}>
        <Copy size={14} />
        Duplicate
      </button>
      <button className="danger" onClick={() => onDeleteRequest(menu.request)}>
        <Trash2 size={14} />
        Delete
      </button>
    </div>
  );
}
