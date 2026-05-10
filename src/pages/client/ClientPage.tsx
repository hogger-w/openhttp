import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Activity, Check, FolderOpen, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { FolderTree } from "../../features/sidebar/FolderTree";
import { RequestTabs } from "../../features/tabs/RequestTabs";
import { EnvironmentWorkbench, FolderBreadcrumb, HttpWorkbench, WebSocketWorkbench } from "../../features/workbench/RequestWorkbench";
import type { AppPage, ContextMenuState, FolderNode, FormFileMap, RequestTab, WorkbenchView } from "../../shared/appTypes";
import type {
  EnvironmentConfig,
  EnvironmentVariable,
  HttpRequest,
  RequestDraft,
  ResponseState,
  WebSocketMessage,
  WebSocketRequest,
  WorkspaceState
} from "../../types";
import { requestKey } from "../../features/requests/requestUtils";

type ClientPageProps = {
  isSidebarHidden: boolean;
  leftWidth: number;
  workspace: WorkspaceState | null;
  folderTree: FolderNode | null;
  selectedFolder: string;
  selectedRequestId: string | null;
  selectedEnvironmentFolder: string | null;
  activeView: WorkbenchView;
  activeTab: RequestTab | null;
  draft: RequestDraft | null;
  activeEnvironment?: EnvironmentConfig;
  expandedFolders: Set<string>;
  openTabs: RequestTab[];
  activeTabId: string | null;
  dirtyTabIds: Set<string>;
  environmentDraft: EnvironmentConfig | null;
  isDirty: boolean;
  saveSuccess: boolean;
  isSending: boolean;
  sendStartedAt: number | null;
  wsStatus: "idle" | "connecting" | "open" | "closed" | "error";
  wsMessages: WebSocketMessage[];
  wsOutbound: string;
  formFiles: FormFileMap;
  filter: string;
  draggingRef: MutableRefObject<boolean>;
  setFilter: (value: string) => void;
  setSelectedFolder: (folder: string) => void;
  setActivePage: (page: AppPage) => void;
  setActiveView: (view: WorkbenchView) => void;
  setActiveTabId: (tabId: string | null) => void;
  setSaveSuccess: (value: boolean) => void;
  setFormFiles: Dispatch<SetStateAction<FormFileMap>>;
  setWsOutbound: (value: string) => void;
  openWorkspace: () => void;
  refreshWorkspace: () => void;
  createRequest: (type: "http" | "websocket") => void;
  toggleFolder: (folder: string) => void;
  openRequestTab: (request: RequestDraft) => void;
  showEnvironment: (folder: string) => void;
  openContextMenu: (menu: ContextMenuState) => void;
  duplicateRequest: (request: RequestDraft) => void;
  deleteRequest: (request: RequestDraft) => void;
  closeSocket: () => void;
  closeTab: (tabId: string) => void;
  addEnvironmentVariable: () => void;
  updateEnvironmentVariable: (id: string | undefined, patch: Partial<EnvironmentVariable>) => void;
  removeEnvironmentVariable: (id: string | undefined) => void;
  saveEnvironment: () => void;
  updateActiveDraft: (recipe: (request: RequestDraft) => RequestDraft) => void;
  updateActiveTab: (recipe: (tab: RequestTab) => RequestTab) => void;
  updateHttpDraft: (recipe: (request: HttpRequest) => HttpRequest) => void;
  updateWebSocketDraft: (recipe: (request: WebSocketRequest) => WebSocketRequest) => void;
  saveActiveDraft: () => void;
  sendHttp: () => void;
  downloadResponse: (response: ResponseState) => void;
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  sendWebSocketMessage: () => void;
};

export function ClientPage({
  isSidebarHidden,
  leftWidth,
  workspace,
  folderTree,
  selectedFolder,
  selectedRequestId,
  selectedEnvironmentFolder,
  activeView,
  activeTab,
  draft,
  activeEnvironment,
  expandedFolders,
  openTabs,
  activeTabId,
  dirtyTabIds,
  environmentDraft,
  isDirty,
  saveSuccess,
  isSending,
  sendStartedAt,
  wsStatus,
  wsMessages,
  wsOutbound,
  formFiles,
  filter,
  draggingRef,
  setFilter,
  setSelectedFolder,
  setActivePage,
  setActiveView,
  setActiveTabId,
  setSaveSuccess,
  setFormFiles,
  setWsOutbound,
  openWorkspace,
  refreshWorkspace,
  createRequest,
  toggleFolder,
  openRequestTab,
  showEnvironment,
  openContextMenu,
  duplicateRequest,
  deleteRequest,
  closeSocket,
  closeTab,
  addEnvironmentVariable,
  updateEnvironmentVariable,
  removeEnvironmentVariable,
  saveEnvironment,
  updateActiveDraft,
  updateActiveTab,
  updateHttpDraft,
  updateWebSocketDraft,
  saveActiveDraft,
  sendHttp,
  downloadResponse,
  connectWebSocket,
  disconnectWebSocket,
  sendWebSocketMessage
}: ClientPageProps) {
  return (
    <main className="app-shell">
      {!isSidebarHidden && (
        <>
          <aside className="sidebar" style={{ width: leftWidth }}>
            <div className="sidebar-actions">
              <button className="button primary" onClick={openWorkspace} title="Open folder">
                <FolderOpen size={16} />
                Open
              </button>
              <button className="icon-button" onClick={refreshWorkspace} disabled={!workspace} title="Refresh">
                <RefreshCw size={16} />
              </button>
            </div>

            {workspace && (
              <div className="create-actions">
                <button className="button soft" onClick={() => createRequest("http")} title="New HTTP request">
                  <Plus size={15} />
                  HTTP
                </button>
                <button className="button soft" onClick={() => createRequest("websocket")} title="New WebSocket request">
                  <Plus size={15} />
                  WebSocket
                </button>
              </div>
            )}

            <div className="search-box">
              <Search size={15} />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search" />
            </div>

            <section className="collection-tree">
              {workspace && folderTree ? (
                <FolderTree
                  node={folderTree}
                  depth={0}
                  workspace={workspace}
                  selectedFolder={selectedFolder}
                  selectedRequestId={selectedRequestId}
                  selectedEnvironmentFolder={selectedEnvironmentFolder}
                  expandedFolders={expandedFolders}
                  onToggleFolder={toggleFolder}
                  onOpenRequest={openRequestTab}
                  onShowEnvironment={showEnvironment}
                  onOpenContextMenu={openContextMenu}
                  onDuplicateRequest={duplicateRequest}
                  onDeleteRequest={deleteRequest}
                />
              ) : (
                <div className="empty-panel">Open a local folder</div>
              )}
            </section>
          </aside>

          <div
            className="resizer"
            onMouseDown={() => {
              draggingRef.current = true;
              document.body.classList.add("sidebar-resizing");
            }}
          />
        </>
      )}

      <section className="request-workbench">
        <RequestTabs
          tabs={openTabs}
          activeTabId={activeTabId}
          dirtyTabIds={dirtyTabIds}
          onActivate={(tabId) => {
            closeSocket();
            setSaveSuccess(false);
            const nextTab = openTabs.find((tab) => tab.id === tabId);
            setSelectedFolder(nextTab?.draft.folder || "");
            setActivePage("client");
            setActiveView({ type: "request" });
            setActiveTabId(tabId);
          }}
          onClose={closeTab}
          onOpenContextMenu={openContextMenu}
        />

        {activeView.type === "environment" && environmentDraft ? (
          <EnvironmentWorkbench
            workspaceName={workspace?.name || ""}
            environment={environmentDraft}
            onAdd={addEnvironmentVariable}
            onUpdateVariable={updateEnvironmentVariable}
            onRemoveVariable={removeEnvironmentVariable}
            onSave={saveEnvironment}
          />
        ) : activeView.type === "request" && activeTab && draft ? (
          <>
            <header className="request-header">
              <div className="request-name-line">
                <FolderBreadcrumb workspaceName={workspace?.name || "Workspace"} folder={draft.folder || ""} />
                <input
                  className="request-name"
                  value={draft.name}
                  onChange={(event) => updateActiveDraft((request) => ({ ...request, name: event.target.value }))}
                />
                {isDirty && <span className="dirty-dot">Unsaved</span>}
              </div>

              <div className="header-actions">
                <button className={`button save-button ${saveSuccess ? "saved" : ""}`} onClick={saveActiveDraft} disabled={!workspace} title="Save">
                  {saveSuccess && <Check size={16} />}
                  <Save size={16} />
                  Save
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => deleteRequest(draft)}
                  disabled={!draft.relativePath}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </header>

            {draft.type === "http" ? (
              <HttpWorkbench
                draft={draft}
                environment={activeEnvironment}
                httpTab={activeTab.httpTab}
                resultTab={activeTab.resultTab}
                isSending={isSending}
                sendStartedAt={sendStartedAt}
                response={activeTab.response}
                requestError={activeTab.requestError}
                setHttpTab={(httpTab) => updateActiveTab((tab) => ({ ...tab, httpTab }))}
                setResultTab={(resultTab) => updateActiveTab((tab) => ({ ...tab, resultTab }))}
                sendHttp={sendHttp}
                downloadResponse={downloadResponse}
                formFiles={formFiles}
                setFormFiles={setFormFiles}
                updateHttpDraft={updateHttpDraft}
              />
            ) : (
              <WebSocketWorkbench
                draft={draft}
                environment={activeEnvironment}
                status={wsStatus}
                messages={wsMessages}
                outbound={wsOutbound}
                setOutbound={setWsOutbound}
                connect={connectWebSocket}
                disconnect={disconnectWebSocket}
                sendMessage={sendWebSocketMessage}
                updateDraft={updateWebSocketDraft}
              />
            )}
          </>
        ) : (
          <div className="blank-workbench">
            <Activity size={38} />
            <h2>OpenHTTP</h2>
            <button className="button primary" onClick={openWorkspace}>
              <FolderOpen size={16} />
              Open Folder
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
