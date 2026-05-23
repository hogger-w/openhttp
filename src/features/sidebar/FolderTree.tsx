import type { CSSProperties, DragEvent } from "react";
import { ChevronDown, ChevronRight, Database, Folder, MoreHorizontal } from "lucide-react";
import type { ContextMenuState, FolderNode, RequestDropTarget } from "../../shared/appTypes";
import { envLabel } from "../../shared/constants";
import type { RequestDraft, RequestMovePayload, WorkspaceState } from "../../types";
import { folderKey, requestKey } from "../requests/requestUtils";

const requestDragMimeType = "application/x-openhttp-request";

function hasRequestDragData(event: DragEvent<HTMLElement>, draggedRequestId: string | null) {
  return draggedRequestId !== null || Array.from(event.dataTransfer.types).includes(requestDragMimeType);
}

function requestFromDragEvent(event: DragEvent<HTMLElement>, workspace: WorkspaceState) {
  const draggedId = event.dataTransfer.getData(requestDragMimeType) || event.dataTransfer.getData("text/plain");
  if (!draggedId) {
    return null;
  }

  return workspace.requests.find((request) => requestKey(request) === draggedId || request.id === draggedId) || null;
}

type FolderTreeProps = {
  node: FolderNode;
  depth: number;
  workspace: WorkspaceState;
  selectedFolder: string;
  selectedRequestId: string | null;
  selectedEnvironmentFolder: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (folder: string) => void;
  onSelectFolder: (folder: string) => void;
  onOpenRequest: (request: RequestDraft) => void;
  onShowEnvironment: (folder: string) => void;
  onOpenContextMenu: (menu: ContextMenuState) => void;
  onDuplicateRequest: (request: RequestDraft) => void;
  onDeleteRequest: (request: RequestDraft) => void;
  draggedRequestId: string | null;
  dropTarget: RequestDropTarget | null;
  onDraggedRequestChange: (requestId: string | null) => void;
  onDropTargetChange: (target: RequestDropTarget | null) => void;
  onMoveRequest: (payload: RequestMovePayload) => void;
};

export function FolderTree({
  node,
  depth,
  workspace,
  selectedFolder,
  selectedRequestId,
  selectedEnvironmentFolder,
  expandedFolders,
  onToggleFolder,
  onSelectFolder,
  onOpenRequest,
  onShowEnvironment,
  onOpenContextMenu,
  onDuplicateRequest,
  onDeleteRequest,
  draggedRequestId,
  dropTarget,
  onDraggedRequestChange,
  onDropTargetChange,
  onMoveRequest
}: FolderTreeProps) {
  const isExpanded = expandedFolders.has(folderKey(node.path));
  const environment = workspace.environments[node.path];
  const activeEnvCount = environment?.variables.filter((variable) => variable.active && variable.key.trim()).length || 0;
  const isFolderDropTarget = dropTarget?.type === "folder" && dropTarget.folder === node.path;

  const clearDropTargetOnLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }

    onDropTargetChange(null);
  };

  const handleFolderDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasRequestDragData(event, draggedRequestId)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    onDropTargetChange({ type: "folder", folder: node.path });
  };

  const handleFolderDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasRequestDragData(event, draggedRequestId)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const draggedRequest = requestFromDragEvent(event, workspace);
    onDropTargetChange(null);
    onDraggedRequestChange(null);

    if (!draggedRequest) {
      return;
    }

    onMoveRequest({
      request: draggedRequest,
      targetFolder: node.path,
      position: "inside"
    });
  };

  return (
    <div className="tree-node">
      <div
        className={`folder-row-wrap ${isFolderDropTarget ? "drop-target" : ""}`}
        onDragOver={handleFolderDragOver}
        onDragLeave={clearDropTargetOnLeave}
        onDrop={handleFolderDrop}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu({ type: "folder", folder: node.path, x: event.clientX, y: event.clientY });
        }}
      >
        <div
          className={`tree-folder-row ${selectedFolder === node.path ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          title={node.path || workspace.name}
        >
          <button
            type="button"
            className="folder-toggle-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFolder(node.path);
            }}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={isExpanded}
            title={isExpanded ? "Collapse folder" : "Expand folder"}
          >
            {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <button
            type="button"
            className="tree-folder-select"
            onClick={() => onSelectFolder(node.path)}
            title={node.path || workspace.name}
          >
            <span className="tree-type-icon"><Folder size={16} /></span>
            <span>{node.name}</span>
          </button>
        </div>
        <button
          className="row-menu-button"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenContextMenu({ type: "folder", folder: node.path, x: rect.right - 150, y: rect.bottom + 4 });
          }}
          title="Folder actions"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>

      {isExpanded && (
        <div>
          <button
            className={`environment-row ${selectedEnvironmentFolder === node.path ? "active" : ""}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => onShowEnvironment(node.path)}
            onContextMenu={(event) => event.preventDefault()}
            title={`${envLabel}: ${node.path || workspace.name}`}
          >
            <span className="tree-indent-icon" />
            <span className="tree-type-icon"><Database size={15} /></span>
            <span>{envLabel}</span>
            <em>{activeEnvCount}</em>
          </button>

          {node.requests.map((request) => {
            const id = requestKey(request);
            const isDragging = draggedRequestId === id;
            const isDropBefore = dropTarget?.type === "request" && dropTarget.requestId === id && dropTarget.position === "before";
            const isDropAfter = dropTarget?.type === "request" && dropTarget.requestId === id && dropTarget.position === "after";
            const dropLineStyle = { "--drop-line-left": `${22 + depth * 16}px` } as CSSProperties;

            const handleRequestDragOver = (event: DragEvent<HTMLDivElement>) => {
              if (!hasRequestDragData(event, draggedRequestId) || draggedRequestId === id) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
              onDropTargetChange({ type: "request", requestId: id, position });
            };

            const handleRequestDrop = (event: DragEvent<HTMLDivElement>) => {
              if (!hasRequestDragData(event, draggedRequestId)) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              const draggedRequest = requestFromDragEvent(event, workspace);
              onDropTargetChange(null);
              onDraggedRequestChange(null);

              if (!draggedRequest || requestKey(draggedRequest) === id) {
                return;
              }

              const rect = event.currentTarget.getBoundingClientRect();
              const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
              onMoveRequest({
                request: draggedRequest,
                targetFolder: request.folder || "",
                targetRelativePath: request.relativePath,
                targetRequestId: request.id || id,
                position
              });
            };

            return (
              <div
                className={`request-row-wrap ${isDragging ? "dragging" : ""} ${isDropBefore ? "drop-before" : ""} ${isDropAfter ? "drop-after" : ""}`}
                draggable
                key={id}
                style={dropLineStyle}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(requestDragMimeType, id);
                  event.dataTransfer.setData("text/plain", id);
                  onDraggedRequestChange(id);
                  onDropTargetChange(null);
                }}
                onDragOver={handleRequestDragOver}
                onDragLeave={clearDropTargetOnLeave}
                onDrop={handleRequestDrop}
                onDragEnd={() => {
                  onDraggedRequestChange(null);
                  onDropTargetChange(null);
                }}
              >
                <button
                  className={`request-row ${selectedRequestId === id ? "active" : ""}`}
                  style={{ paddingLeft: 8 + depth * 16 }}
                  onClick={() => onOpenRequest(request)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenContextMenu({ type: "request", request, x: event.clientX, y: event.clientY });
                  }}
                  title={request.name}
                >
                  <span className="tree-indent-icon" />
                  <span className={`method-pill ${request.type === "websocket" ? "ws" : request.method.toLowerCase()}`}>
                    {request.type === "websocket" ? "WS" : request.method}
                  </span>
                  <span className="request-title">{request.name}</span>
                </button>
                <button
                  className="row-menu-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    onOpenContextMenu({ type: "request", request, x: rect.right - 150, y: rect.bottom + 4 });
                  }}
                  title="Request actions"
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
            );
          })}

          {node.children.map((child) => (
            <FolderTree
              key={child.path}
              node={child}
              depth={depth + 1}
              workspace={workspace}
              selectedFolder={selectedFolder}
              selectedRequestId={selectedRequestId}
              selectedEnvironmentFolder={selectedEnvironmentFolder}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFolder={onSelectFolder}
              onOpenRequest={onOpenRequest}
              onShowEnvironment={onShowEnvironment}
              onOpenContextMenu={onOpenContextMenu}
              onDuplicateRequest={onDuplicateRequest}
              onDeleteRequest={onDeleteRequest}
              draggedRequestId={draggedRequestId}
              dropTarget={dropTarget}
              onDraggedRequestChange={onDraggedRequestChange}
              onDropTargetChange={onDropTargetChange}
              onMoveRequest={onMoveRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}
