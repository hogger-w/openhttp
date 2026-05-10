import { ChevronDown, ChevronRight, Database, Folder, MoreHorizontal } from "lucide-react";
import type { ContextMenuState, FolderNode } from "../../shared/appTypes";
import { envLabel } from "../../shared/constants";
import type { RequestDraft, WorkspaceState } from "../../types";
import { folderKey, requestKey } from "../requests/requestUtils";

type FolderTreeProps = {
  node: FolderNode;
  depth: number;
  workspace: WorkspaceState;
  selectedFolder: string;
  selectedRequestId: string | null;
  selectedEnvironmentFolder: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (folder: string) => void;
  onOpenRequest: (request: RequestDraft) => void;
  onShowEnvironment: (folder: string) => void;
  onOpenContextMenu: (menu: ContextMenuState) => void;
  onDuplicateRequest: (request: RequestDraft) => void;
  onDeleteRequest: (request: RequestDraft) => void;
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
  onOpenRequest,
  onShowEnvironment,
  onOpenContextMenu,
  onDuplicateRequest,
  onDeleteRequest
}: FolderTreeProps) {
  const isExpanded = expandedFolders.has(folderKey(node.path));
  const environment = workspace.environments[node.path];
  const activeEnvCount = environment?.variables.filter((variable) => variable.active && variable.key.trim()).length || 0;

  return (
    <div className="tree-node">
      <div
        className="folder-row-wrap"
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu({ type: "folder", folder: node.path, x: event.clientX, y: event.clientY });
        }}
      >
        <button
          className={`tree-folder-row ${selectedFolder === node.path ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => onToggleFolder(node.path)}
          title={node.path || workspace.name}
        >
          <span className="tree-indent-icon">{isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
          <span className="tree-type-icon"><Folder size={16} /></span>
          <span>{node.name}</span>
        </button>
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
            return (
              <div className="request-row-wrap" key={id}>
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
              onOpenRequest={onOpenRequest}
              onShowEnvironment={onShowEnvironment}
              onOpenContextMenu={onOpenContextMenu}
              onDuplicateRequest={onDuplicateRequest}
              onDeleteRequest={onDeleteRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}
