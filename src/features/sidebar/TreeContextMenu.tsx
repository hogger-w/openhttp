import type { RefObject } from "react";
import { Copy, Folder, Plus, Trash2, Wifi, X } from "lucide-react";
import type { ContextMenuState } from "../../shared/appTypes";
import type { RequestDraft } from "../../types";

export function TreeContextMenu({
  menu,
  refObject,
  onCreateRequest,
  onCreateFolder,
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
          添加HTTP
        </button>
        <button onClick={() => onCreateRequest("websocket", menu.folder)}>
          <Wifi size={14} />
          添加WebSocket
        </button>
        <button onClick={() => onCreateFolder(menu.folder)}>
          <Folder size={14} />
          创建文件夹
        </button>
      </div>
    );
  }

  if (menu.type === "tab") {
    return (
      <div className="row-menu floating-menu" ref={refObject} style={style}>
        <button onClick={() => onCloseAllTabs()}>
          <X size={14} />
          关闭所有
        </button>
        <button onClick={() => onCloseTab(menu.tabId)}>
          <X size={14} />
          关闭
        </button>
        <button onClick={() => onCloseOtherTabs(menu.tabId)}>
          <X size={14} />
          关闭其他
        </button>
      </div>
    );
  }

  return (
    <div className="row-menu floating-menu" ref={refObject} style={style}>
      <button onClick={() => onDuplicateRequest(menu.request)}>
        <Copy size={14} />
        复制
      </button>
      <button className="danger" onClick={() => onDeleteRequest(menu.request)}>
        <Trash2 size={14} />
        删除
      </button>
    </div>
  );
}
