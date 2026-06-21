import {
  AlignJustify,
  FolderOpen,
  Info,
  LogOut,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsModal } from "./features/settings/SettingsModal";
import { CreateFolderDialog } from "./features/sidebar/CreateFolderDialog";
import { buildFolderTree } from "./features/sidebar/folderTreeUtils";
import { TreeContextMenu } from "./features/sidebar/TreeContextMenu";
import { CloseDirtyTabsDialog } from "./features/tabs/CloseDirtyTabsDialog";
import { createResponseTextDecoder, prettyBody, responseBodyKind, responseFileExtension, timeStamp } from "./features/requests/bodyUtils";
import {
  cloneRequest,
  compactEnvironment,
  compactRequest,
  createHttpRequest,
  createWebSocketRequest,
  emptyEnvVariable,
  environmentKey,
  environmentSnapshot,
  folderKey,
  isTabDirty,
  normalizeDraftForEdit,
  normalizeEnvironmentForEdit,
  requestKey,
  requestSnapshot
} from "./features/requests/requestUtils";
import { applyRowsToUrl, resolveVariables } from "./features/requests/urlUtils";
import { ClientPage } from "./pages/client/ClientPage";
import { ToolsPage } from "./pages/tools/ToolsPage";
import openHttpIcon from "../assets/oh.png";
import type {
  AppPage,
  CloseDirtyTabsDialogState,
  ContextMenuState,
  CreateFolderDialogState,
  FormFileMap,
  RenameFolderDialogState,
  SettingsSection,
  ToolId,
  WorkbenchTab,
  WorkbenchView
} from "./shared/appTypes";
import { bodylessMethods, rootFolderId } from "./shared/constants";
import type {
  EnvironmentConfig,
  EnvironmentVariable,
  HttpRequest,
  KeyValueRow,
  RequestDraft,
  RequestMovePayload,
  ResponseState,
  UploadProgressState,
  WebSocketMessage,
  WebSocketRequest,
  WorkspaceState
} from "./types";

type WebSocketStatus = "idle" | "connecting" | "open" | "closed" | "error";

type HttpRequestController = {
  abort: () => void;
};

type HttpRequestRuntimeState = {
  isSending: boolean;
  startedAt: number;
  uploadProgress: UploadProgressState | null;
};

type WebSocketSession = {
  status: WebSocketStatus;
  messages: WebSocketMessage[];
  outbound: string;
};

const emptyWebSocketSession: WebSocketSession = {
  status: "idle",
  messages: [],
  outbound: ""
};

const LAST_WORKSPACE_STORAGE_KEY = "openhttp:last-workspace";
const WORKSPACE_SESSION_STORAGE_PREFIX = "openhttp:workspace-session:";

type RequestWorkbenchTab = Extract<WorkbenchTab, { kind: "request" }>;
type EnvironmentWorkbenchTab = Extract<WorkbenchTab, { kind: "environment" }>;

type PersistedRequestTab = {
  kind: "request";
  id: string;
  draft: RequestDraft;
  savedSnapshot: string;
  httpTab: RequestWorkbenchTab["httpTab"];
  resultTab: RequestWorkbenchTab["resultTab"];
};

type PersistedEnvironmentTab = {
  kind: "environment";
  id: string;
  environment: EnvironmentConfig;
  savedSnapshot: string;
};

type PersistedWorkbenchTab = PersistedRequestTab | PersistedEnvironmentTab;

type PersistedWorkspaceSession = {
  version: 1;
  workspacePath: string;
  activeTabId: string | null;
  tabs: PersistedWorkbenchTab[];
};

type RestoredWorkspaceSession = {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
};

function hasOwnPatchValue<T extends object>(patch: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function folderKeysForPath(folder: string) {
  const keys = [rootFolderId];
  const parts = folder.split("/").filter(Boolean);
  let current = "";

  parts.forEach((part) => {
    current = current ? `${current}/${part}` : part;
    keys.push(folderKey(current));
  });

  return keys;
}

function parseXhrResponseHeaders(rawHeaders: string): KeyValueRow[] {
  return rawHeaders
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      return {
        id: crypto.randomUUID(),
        key: separatorIndex === -1 ? line.trim() : line.slice(0, separatorIndex).trim(),
        value: separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).trim(),
        enabled: true
      };
    });
}

function responseBlobFromXhr(xhr: XMLHttpRequest, contentType: string) {
  if (xhr.response instanceof Blob) {
    return xhr.response;
  }

  if (xhr.response instanceof ArrayBuffer) {
    return new Blob([xhr.response], { type: contentType || "application/octet-stream" });
  }

  if (typeof xhr.response === "string") {
    return new Blob([xhr.response], { type: contentType || "text/plain;charset=utf-8" });
  }

  return new Blob([], { type: contentType || "application/octet-stream" });
}

async function decodeResponseBlob(blob: Blob, contentType: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return createResponseTextDecoder(contentType).decode(bytes);
}

function applyEnvironmentVariablePatch(
  environment: EnvironmentConfig,
  id: string | undefined,
  patch: Partial<EnvironmentVariable>
): EnvironmentConfig {
  let variables = environment.variables.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable));
  const edited = variables.find((variable) => variable.id === id);

  if (!edited) {
    return { ...environment, variables };
  }

  const shouldNormalizeActiveKey =
    (hasOwnPatchValue(patch, "active") && Boolean(patch.active)) || (hasOwnPatchValue(patch, "key") && edited.active);

  if (!shouldNormalizeActiveKey) {
    return { ...environment, variables };
  }

  const editedKey = edited.key.trim();

  if (!editedKey) {
    variables = variables.map((variable) => (variable.id === id ? { ...variable, active: false } : variable));
    return { ...environment, variables };
  }

  variables = variables.map((variable) =>
    variable.id !== id && variable.key.trim() === editedKey ? { ...variable, active: false } : variable
  );

  return { ...environment, variables };
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const editable = target.closest("input, select, textarea, [contenteditable='true']");
  if (!editable) {
    return false;
  }

  if (editable instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(editable.type);
  }

  return true;
}

function workspaceSessionStorageKey(workspacePath: string) {
  return `${WORKSPACE_SESSION_STORAGE_PREFIX}${workspacePath}`;
}

function normalizeHttpTab(value: unknown): RequestWorkbenchTab["httpTab"] {
  return value === "params" || value === "headers" || value === "body" ? value : "body";
}

function normalizeResultTab(value: unknown): RequestWorkbenchTab["resultTab"] {
  return value === "headers" || value === "body" ? value : "body";
}

function createRequestWorkbenchTab(
  request: RequestDraft,
  options: {
    httpTab?: RequestWorkbenchTab["httpTab"];
    resultTab?: RequestWorkbenchTab["resultTab"];
    savedSnapshot?: string;
  } = {}
): RequestWorkbenchTab {
  const draft = normalizeDraftForEdit(request);

  return {
    kind: "request",
    id: requestKey(draft),
    draft,
    savedSnapshot: options.savedSnapshot || requestSnapshot(draft),
    httpTab: options.httpTab || "body",
    resultTab: options.resultTab || "body",
    response: null,
    requestError: null
  };
}

function createEnvironmentWorkbenchTab(environment: EnvironmentConfig, savedSnapshot?: string): EnvironmentWorkbenchTab {
  const environmentForEdit = normalizeEnvironmentForEdit(environment);

  return {
    kind: "environment",
    id: environmentKey(environmentForEdit.folder),
    environment: environmentForEdit,
    savedSnapshot: savedSnapshot || environmentSnapshot(environmentForEdit)
  };
}

function tabStoragePayload(tab: WorkbenchTab): PersistedWorkbenchTab {
  if (tab.kind === "request") {
    return {
      kind: "request",
      id: tab.id,
      draft: tab.draft,
      savedSnapshot: tab.savedSnapshot,
      httpTab: tab.httpTab,
      resultTab: tab.resultTab
    };
  }

  return {
    kind: "environment",
    id: tab.id,
    environment: tab.environment,
    savedSnapshot: tab.savedSnapshot
  };
}

function saveWorkspaceSession(workspacePath: string, tabs: WorkbenchTab[], activeTabId: string | null) {
  try {
    const session: PersistedWorkspaceSession = {
      version: 1,
      workspacePath,
      activeTabId,
      tabs: tabs.map(tabStoragePayload)
    };
    const storageKey = workspaceSessionStorageKey(workspacePath);
    const serializedSession = JSON.stringify(session);
    if (localStorage.getItem(storageKey) !== serializedSession) {
      localStorage.setItem(storageKey, serializedSession);
    }
  } catch (error) {
    console.warn("Failed to save workspace session", error);
  }
}

function readWorkspaceSession(workspacePath: string): PersistedWorkspaceSession | null {
  try {
    const raw = localStorage.getItem(workspaceSessionStorageKey(workspacePath));
    if (!raw) {
      return null;
    }

    const session = JSON.parse(raw) as Partial<PersistedWorkspaceSession>;
    if (session.version !== 1 || session.workspacePath !== workspacePath || !Array.isArray(session.tabs)) {
      return null;
    }

    return {
      version: 1,
      workspacePath,
      activeTabId: typeof session.activeTabId === "string" ? session.activeTabId : null,
      tabs: session.tabs as PersistedWorkbenchTab[]
    };
  } catch {
    return null;
  }
}

function requestLookup(workspace: WorkspaceState) {
  const requests = new Map<string, RequestDraft>();

  workspace.requests.forEach((request) => {
    requests.set(requestKey(request), request);
    if (request.id) {
      requests.set(request.id, request);
    }
  });

  return requests;
}

function restoreRequestTab(tab: PersistedRequestTab, requests: Map<string, RequestDraft>): RequestWorkbenchTab | null {
  const workspaceRequest = requests.get(tab.id) || (tab.draft?.id ? requests.get(tab.draft.id) : undefined);
  if (!workspaceRequest) {
    return null;
  }

  const currentTab = createRequestWorkbenchTab(workspaceRequest, {
    httpTab: normalizeHttpTab(tab.httpTab),
    resultTab: normalizeResultTab(tab.resultTab)
  });
  const savedSnapshot = typeof tab.savedSnapshot === "string" ? tab.savedSnapshot : currentTab.savedSnapshot;

  if (!tab.draft || tab.draft.type !== currentTab.draft.type) {
    return currentTab;
  }

  const restoredDraft = normalizeDraftForEdit(tab.draft);
  const shouldRestoreDraft = requestSnapshot(restoredDraft) !== savedSnapshot;

  return shouldRestoreDraft
    ? {
        ...currentTab,
        draft: restoredDraft,
        id: requestKey(restoredDraft),
        savedSnapshot
      }
    : currentTab;
}

function restoreEnvironmentTab(tab: PersistedEnvironmentTab, workspace: WorkspaceState): EnvironmentWorkbenchTab | null {
  const folder = tab.environment?.folder || "";
  const workspaceEnvironment = workspace.environments[folder];
  if (!workspaceEnvironment) {
    return null;
  }

  const currentTab = createEnvironmentWorkbenchTab(workspaceEnvironment);
  const savedSnapshot = typeof tab.savedSnapshot === "string" ? tab.savedSnapshot : currentTab.savedSnapshot;

  if (!tab.environment) {
    return currentTab;
  }

  const restoredEnvironment = normalizeEnvironmentForEdit(tab.environment);
  const shouldRestoreEnvironment = environmentSnapshot(restoredEnvironment) !== savedSnapshot;

  return shouldRestoreEnvironment
    ? {
        ...currentTab,
        environment: restoredEnvironment,
        id: environmentKey(restoredEnvironment.folder),
        savedSnapshot
      }
    : currentTab;
}

function restoreWorkspaceSession(workspace: WorkspaceState): RestoredWorkspaceSession | null {
  const session = readWorkspaceSession(workspace.path);
  if (!session) {
    return null;
  }

  const requests = requestLookup(workspace);
  const restoredTabs: WorkbenchTab[] = [];
  const seenTabIds = new Set<string>();

  session.tabs.forEach((storedTab) => {
    const restoredTab =
      storedTab.kind === "request"
        ? restoreRequestTab(storedTab, requests)
        : storedTab.kind === "environment"
          ? restoreEnvironmentTab(storedTab, workspace)
          : null;

    if (!restoredTab || seenTabIds.has(restoredTab.id)) {
      return;
    }

    seenTabIds.add(restoredTab.id);
    restoredTabs.push(restoredTab);
  });

  const activeTabId = restoredTabs.some((tab) => tab.id === session.activeTabId) ? session.activeTabId : restoredTabs[0]?.id || null;

  return {
    tabs: restoredTabs,
    activeTabId
  };
}

function defaultWorkspaceSession(workspace: WorkspaceState): RestoredWorkspaceSession {
  const firstRequest = workspace.requests[0];
  if (!firstRequest) {
    return {
      tabs: [],
      activeTabId: null
    };
  }

  const firstTab = createRequestWorkbenchTab(firstRequest);
  return {
    tabs: [firstTab],
    activeTabId: firstTab.id
  };
}

function activeViewForTab(tab: WorkbenchTab | null): WorkbenchView {
  if (!tab) {
    return { type: "empty" };
  }

  return tab.kind === "environment" ? { type: "environment", folder: tab.environment.folder } : { type: "request" };
}

function selectedFolderForTab(tab: WorkbenchTab | null) {
  if (!tab) {
    return "";
  }

  return tab.kind === "environment" ? tab.environment.folder : tab.draft.folder || "";
}

function isFolderInScope(folder: string, scope: string) {
  return folder === scope || folder.startsWith(`${scope}/`);
}

function renamedFolderPath(folder: string, oldFolder: string, nextFolder: string) {
  if (folder === oldFolder) {
    return nextFolder;
  }

  return folder.startsWith(`${oldFolder}/`) ? `${nextFolder}${folder.slice(oldFolder.length)}` : folder;
}

function expandedFoldersForTabs(tabs: WorkbenchTab[]) {
  const folders = new Set<string>([rootFolderId]);

  tabs.forEach((tab) => {
    const folder = tab.kind === "environment" ? tab.environment.folder : tab.draft.folder || "";
    folderKeysForPath(folder).forEach((key) => folders.add(key));
  });

  return folders;
}

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [activePage, setActivePage] = useState<AppPage>("client");
  const [activeView, setActiveView] = useState<WorkbenchView>({ type: "empty" });
  const [selectedFolder, setSelectedFolder] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set([rootFolderId]));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [openTabs, setOpenTabs] = useState<WorkbenchTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [formFiles, setFormFiles] = useState<FormFileMap>({});
  const [filter, setFilter] = useState("");
  const [leftWidth, setLeftWidth] = useState(318);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("openhttp:theme") === "dark");
  const [httpRequestRuntimes, setHttpRequestRuntimes] = useState<Record<string, HttpRequestRuntimeState>>({});
  const [wsSessions, setWsSessions] = useState<Record<string, WebSocketSession>>({});
  const [appVersion, setAppVersion] = useState("");
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("settings");
  const [verifySsl, setVerifySsl] = useState(() => localStorage.getItem("openhttp:verify-ssl") !== "false");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolId>("base64");
  const [closeDirtyTabsDialog, setCloseDirtyTabsDialog] = useState<CloseDirtyTabsDialogState | null>(null);
  const [createFolderDialog, setCreateFolderDialog] = useState<CreateFolderDialogState | null>(null);
  const [renameFolderDialog, setRenameFolderDialog] = useState<RenameFolderDialogState | null>(null);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const httpAbortControllersRef = useRef<Map<string, HttpRequestController>>(new Map());
  const httpRequestTabIdsRef = useRef<Map<HttpRequestController, string>>(new Map());
  const draggingRef = useRef(false);
  const titleMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const closeDirtyTabsResolverRef = useRef<((shouldSave: boolean) => void) | null>(null);
  const environmentSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const environmentSaveVersionRef = useRef(0);

  const activeTab = useMemo(() => openTabs.find((tab) => tab.id === activeTabId) || null, [activeTabId, openTabs]);
  const activeRequestTab = activeTab?.kind === "request" ? activeTab : null;
  const activeEnvironmentTab = activeTab?.kind === "environment" ? activeTab : null;
  const draft = activeRequestTab?.draft || null;
  const environmentDraft = activeEnvironmentTab?.environment || null;
  const activeHttpRuntime = activeTabId ? httpRequestRuntimes[activeTabId] : undefined;
  const isActiveHttpSending = Boolean(activeHttpRuntime?.isSending);
  const activeHttpStartedAt = activeHttpRuntime?.startedAt ?? null;
  const activeHttpUploadProgress = activeHttpRuntime?.uploadProgress ?? null;
  const activeWsSession = activeTabId ? wsSessions[activeTabId] : undefined;
  const wsStatus = activeWsSession?.status || emptyWebSocketSession.status;
  const wsMessages = activeWsSession?.messages || emptyWebSocketSession.messages;
  const wsOutbound = activeWsSession?.outbound || emptyWebSocketSession.outbound;

  const updateWebSocketSession = useCallback((tabId: string, recipe: (session: WebSocketSession) => WebSocketSession) => {
    setWsSessions((current) => ({
      ...current,
      [tabId]: recipe(current[tabId] || emptyWebSocketSession)
    }));
  }, []);

  const setActiveWsOutbound = useCallback(
    (value: string) => {
      if (!activeRequestTab || activeRequestTab.draft.type !== "websocket") {
        return;
      }

      updateWebSocketSession(activeRequestTab.id, (session) => ({ ...session, outbound: value }));
    },
    [activeRequestTab, updateWebSocketSession]
  );

  const applyWorkspaceState = useCallback((nextWorkspace: WorkspaceState) => {
    const restoredSession = restoreWorkspaceSession(nextWorkspace) || defaultWorkspaceSession(nextWorkspace);
    const nextActiveTab = restoredSession.tabs.find((tab) => tab.id === restoredSession.activeTabId) || null;

    setWorkspace(nextWorkspace);
    setActivePage("client");
    setOpenTabs(restoredSession.tabs);
    setActiveTabId(restoredSession.activeTabId);
    setActiveView(activeViewForTab(nextActiveTab));
    setSelectedFolder(selectedFolderForTab(nextActiveTab));
    setExpandedFolders(expandedFoldersForTabs(restoredSession.tabs));
    setFormFiles({});
  }, []);

  useEffect(() => {
    const recentWorkspace = localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY);

    if (!recentWorkspace) {
      return;
    }

    window.openHttpNative
      .readWorkspace(recentWorkspace)
      .then(applyWorkspaceState)
      .catch(() => {
        localStorage.removeItem(LAST_WORKSPACE_STORAGE_KEY);
      });
  }, [applyWorkspaceState]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    saveWorkspaceSession(workspace.path, openTabs, activeTabId);
  }, [activeTabId, openTabs, workspace]);

  useEffect(() => {
    const persistSession = () => {
      if (workspace) {
        saveWorkspaceSession(workspace.path, openTabs, activeTabId);
      }
    };

    window.addEventListener("beforeunload", persistSession);
    return () => window.removeEventListener("beforeunload", persistSession);
  }, [activeTabId, openTabs, workspace]);

  useEffect(() => {
    localStorage.setItem("openhttp:theme", isDark ? "dark" : "light");
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem("openhttp:verify-ssl", String(verifySsl));
    window.openHttpNative.setVerifySsl(verifySsl);
  }, [verifySsl]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) {
        return;
      }

      const nextWidth = Math.min(Math.max(event.clientX, 260), 520);
      setLeftWidth(nextWidth);
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      document.body.classList.remove("sidebar-resizing");
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      httpAbortControllersRef.current.forEach((controller) => controller.abort());
      httpAbortControllersRef.current.clear();
      httpRequestTabIdsRef.current.clear();
      socketsRef.current.forEach((socket) => socket.close());
      socketsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    window.openHttpNative.isWindowMaximized().then(setIsMaximized);
    return window.openHttpNative.onWindowMaximizedChange(setIsMaximized);
  }, []);

  useEffect(() => {
    window.openHttpNative.getAppVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!titleMenuRef.current?.contains(target)) {
        setIsAppMenuOpen(false);
      }
      if (!contextMenuRef.current?.contains(target)) {
        setContextMenu(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAppMenuOpen(false);
        setContextMenu(null);
        setIsSettingsOpen(false);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !isEditableKeyboardTarget(event.target)) {
        event.preventDefault();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const filteredRequests = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const needle = filter.trim().toLowerCase();

    if (!needle) {
      return workspace.requests;
    }

    return workspace.requests.filter((request) => {
      const haystack = `${request.name} ${request.url} ${request.type} ${request.folder || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, workspace]);

  const folderTree = useMemo(() => buildFolderTree(workspace, filteredRequests), [filteredRequests, workspace]);

  const dirtyTabIds = useMemo(
    () => new Set(openTabs.filter((tab) => isTabDirty(tab)).map((tab) => tab.id)),
    [openTabs]
  );
  const isDirty = activeTabId ? dirtyTabIds.has(activeTabId) : false;

  const activeEnvironment = draft ? workspace?.environments[draft.folder || ""] : undefined;

  const refreshWorkspace = async () => {
    if (!workspace) {
      return;
    }

    const nextWorkspace = await window.openHttpNative.readWorkspace(workspace.path);
    setWorkspace(nextWorkspace);
  };

  const openWorkspace = async () => {
    const nextWorkspace = await window.openHttpNative.openWorkspace();

    if (!nextWorkspace) {
      return;
    }

    localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, nextWorkspace.path);
    closeAllSockets();
    abortAllHttpRequests();
    applyWorkspaceState(nextWorkspace);
  };

  const abortHttpRequests = (tabIds: string[]) => {
    if (tabIds.length === 0) {
      return;
    }

    const abortingIds = new Set(tabIds);
    abortingIds.forEach((tabId) => {
      const controller = httpAbortControllersRef.current.get(tabId);
      if (controller) {
        httpAbortControllersRef.current.delete(tabId);
        httpRequestTabIdsRef.current.delete(controller);
        controller.abort();
      }
    });

    setHttpRequestRuntimes((current) => {
      let changed = false;
      const next = { ...current };
      abortingIds.forEach((tabId) => {
        if (next[tabId]) {
          changed = true;
          delete next[tabId];
        }
      });
      return changed ? next : current;
    });
  };

  const abortAllHttpRequests = () => {
    httpAbortControllersRef.current.forEach((controller) => controller.abort());
    httpAbortControllersRef.current.clear();
    httpRequestTabIdsRef.current.clear();
    setHttpRequestRuntimes({});
  };

  const closeSockets = (tabIds: string[]) => {
    if (tabIds.length === 0) {
      return;
    }

    const closingIds = new Set(tabIds);
    closingIds.forEach((tabId) => {
      const socket = socketsRef.current.get(tabId);
      if (socket) {
        socketsRef.current.delete(tabId);
        socket.close();
      }
    });

    setWsSessions((current) => {
      let changed = false;
      const next = { ...current };
      closingIds.forEach((tabId) => {
        if (next[tabId]) {
          changed = true;
          delete next[tabId];
        }
      });
      return changed ? next : current;
    });
  };

  const closeAllSockets = () => {
    socketsRef.current.forEach((socket) => socket.close());
    socketsRef.current.clear();
    setWsSessions({});
  };

  const findSocketTabId = (socket: WebSocket) => {
    for (const [tabId, currentSocket] of socketsRef.current) {
      if (currentSocket === socket) {
        return tabId;
      }
    }

    return null;
  };

  const moveSocketSession = (oldTabId: string, nextTabId: string) => {
    if (oldTabId === nextTabId) {
      return;
    }

    const socket = socketsRef.current.get(oldTabId);
    if (socket) {
      socketsRef.current.delete(oldTabId);
      socketsRef.current.set(nextTabId, socket);
    }

    setWsSessions((current) => {
      if (!current[oldTabId]) {
        return current;
      }

      const next = { ...current, [nextTabId]: current[oldTabId] };
      delete next[oldTabId];
      return next;
    });
  };

  const moveHttpRequestRuntime = (oldTabId: string, nextTabId: string) => {
    if (oldTabId === nextTabId) {
      return;
    }

    const controller = httpAbortControllersRef.current.get(oldTabId);
    if (controller) {
      httpAbortControllersRef.current.delete(oldTabId);
      httpAbortControllersRef.current.set(nextTabId, controller);
      httpRequestTabIdsRef.current.set(controller, nextTabId);
    }

    setHttpRequestRuntimes((current) => {
      if (!current[oldTabId]) {
        return current;
      }

      const next = { ...current, [nextTabId]: current[oldTabId] };
      delete next[oldTabId];
      return next;
    });
  };

  const openRequestTab = (request: RequestDraft, replaceCurrent = false) => {
    setSaveSuccess(false);
    const nextTab = createRequestWorkbenchTab(request);
    setActivePage("client");
    setActiveView({ type: "request" });
    setActiveTabId(nextTab.id);

    setOpenTabs((current) => {
      const existing = current.find((tab) => tab.id === nextTab.id);
      if (existing) {
        return current;
      }

      return replaceCurrent ? [nextTab] : [...current, nextTab];
    });
  };

  const createRequest = async (type: "http" | "websocket", folder = selectedFolder) => {
    if (!workspace) {
      return;
    }

    const nextDraft = type === "http" ? createHttpRequest(folder) : createWebSocketRequest(folder);
    const existingIds = new Set(workspace.requests.map((request) => request.id));
    const nextWorkspace = await window.openHttpNative.saveRequest(workspace.path, compactRequest(nextDraft));
    const saved = nextWorkspace.requests.find((request) => request.id && !existingIds.has(request.id));

    setWorkspace(nextWorkspace);
    setContextMenu(null);
    openRequestTab(saved || nextDraft);
  };

  const createChildFolder = async (parentFolder: string) => {
    if (!workspace) {
      return;
    }

    setContextMenu(null);
    setCreateFolderDialog({ parentFolder });
  };

  const renameFolder = (folder: string) => {
    if (!workspace || !folder) {
      return;
    }

    setContextMenu(null);
    setRenameFolderDialog({ folder });
  };

  const confirmCreateFolder = async (name: string) => {
    if (!workspace || !createFolderDialog) {
      return;
    }

    const { workspace: nextWorkspace, createdFolder } = await window.openHttpNative.createFolder(
      workspace.path,
      createFolderDialog.parentFolder,
      name
    );

    setWorkspace(nextWorkspace);
    setSelectedFolder(createdFolder);
    setActiveTabId(null);
    setActiveView({ type: "empty" });
    setExpandedFolders((current) => {
      const next = new Set(current);
      next.add(folderKey(createFolderDialog.parentFolder));
      next.add(folderKey(createdFolder));
      return next;
    });
    setCreateFolderDialog(null);
  };

  const syncRenamedFolderTabs = (nextWorkspace: WorkspaceState, oldFolder: string, nextFolder: string) => {
    const tabIdMoves = new Map<string, string>();
    const nextTabs = openTabs.map((tab) => {
      const tabFolder = tab.kind === "environment" ? tab.environment.folder : tab.draft.folder || "";
      if (!isFolderInScope(tabFolder, oldFolder)) {
        return tab;
      }

      const renamedTabFolder = renamedFolderPath(tabFolder, oldFolder, nextFolder);

      if (tab.kind === "environment") {
        const nextEnvironment = nextWorkspace.environments[renamedTabFolder];
        if (!nextEnvironment) {
          return tab;
        }

        const nextEnvironmentForEdit = normalizeEnvironmentForEdit(nextEnvironment);
        const nextSnapshot = environmentSnapshot(nextEnvironmentForEdit);
        const nextId = environmentKey(renamedTabFolder);
        if (nextId !== tab.id) {
          tabIdMoves.set(tab.id, nextId);
        }

        return {
          ...tab,
          id: nextId,
          environment: isTabDirty(tab)
            ? {
                ...tab.environment,
                folder: renamedTabFolder,
                relativePath: nextEnvironment.relativePath,
                updatedAt: nextEnvironment.updatedAt
              }
            : nextEnvironmentForEdit,
          savedSnapshot: nextSnapshot
        };
      }

      const nextRequest = nextWorkspace.requests.find(
        (request) => tab.draft.markerId && request.markerId === tab.draft.markerId && (request.folder || "") === renamedTabFolder
      );
      if (!nextRequest) {
        return tab;
      }

      const nextDraft = normalizeDraftForEdit(nextRequest);
      const nextSnapshot = requestSnapshot(nextDraft);
      const nextId = requestKey(nextDraft);
      if (nextId !== tab.id) {
        tabIdMoves.set(tab.id, nextId);
      }

      return {
        ...tab,
        id: nextId,
        draft: isTabDirty(tab)
          ? {
              ...tab.draft,
              id: nextRequest.id,
              markerId: nextRequest.markerId,
              relativePath: nextRequest.relativePath,
              fileName: nextRequest.fileName,
              folder: renamedTabFolder,
              updatedAt: nextRequest.updatedAt
            }
          : nextDraft,
        savedSnapshot: nextSnapshot
      };
    });

    tabIdMoves.forEach((nextId, oldId) => {
      moveSocketSession(oldId, nextId);
      moveHttpRequestRuntime(oldId, nextId);
    });
    setOpenTabs(nextTabs);
    setActiveTabId((current) => (current ? tabIdMoves.get(current) || current : current));
  };

  const confirmRenameFolder = async (name: string) => {
    if (!workspace || !renameFolderDialog) {
      return;
    }

    const oldFolder = renameFolderDialog.folder;
    const { workspace: nextWorkspace, renamedFolder } = await window.openHttpNative.renameFolder(workspace.path, oldFolder, name);

    setWorkspace(nextWorkspace);
    syncRenamedFolderTabs(nextWorkspace, oldFolder, renamedFolder);
    setSelectedFolder((current) => (current && isFolderInScope(current, oldFolder) ? renamedFolderPath(current, oldFolder, renamedFolder) : current));
    setActiveView((current) =>
      current.type === "environment" && isFolderInScope(current.folder, oldFolder)
        ? { type: "environment", folder: renamedFolderPath(current.folder, oldFolder, renamedFolder) }
        : current
    );
    setExpandedFolders((current) => {
      const next = new Set<string>();
      current.forEach((key) => {
        next.add(key !== rootFolderId && isFolderInScope(key, oldFolder) ? renamedFolderPath(key, oldFolder, renamedFolder) : key);
      });
      folderKeysForPath(renamedFolder).forEach((key) => next.add(key));
      return next;
    });
    setRenameFolderDialog(null);
  };

  const updateActiveTab = (recipe: (tab: Extract<WorkbenchTab, { kind: "request" }>) => Extract<WorkbenchTab, { kind: "request" }>) => {
    setOpenTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId && tab.kind === "request" ? recipe({ ...tab, draft: cloneRequest(tab.draft) }) : tab
      )
    );
  };

  const updateTabById = (tabId: string, recipe: (tab: Extract<WorkbenchTab, { kind: "request" }>) => Extract<WorkbenchTab, { kind: "request" }>) => {
    setOpenTabs((current) =>
      current.map((tab) => (tab.id === tabId && tab.kind === "request" ? recipe({ ...tab, draft: cloneRequest(tab.draft) }) : tab))
    );
  };

  const updateActiveDraft = (recipe: (request: RequestDraft) => RequestDraft) => {
    updateActiveTab((tab) => ({ ...tab, draft: recipe(tab.draft) }));
  };

  const updateHttpDraft = (recipe: (request: HttpRequest) => HttpRequest) => {
    updateActiveDraft((request) => (request.type === "http" ? recipe(request) : request));
  };

  const updateWebSocketDraft = (recipe: (request: WebSocketRequest) => WebSocketRequest) => {
    updateActiveDraft((request) => (request.type === "websocket" ? recipe(request) : request));
  };

  const saveTab = async (tab: Extract<WorkbenchTab, { kind: "request" }>) => {
    if (!workspace) {
      return null;
    }

    const existingIds = new Set(workspace.requests.map((request) => request.id));
    const requestToSave = compactRequest(tab.draft);
    const nextWorkspace = await window.openHttpNative.saveRequest(workspace.path, requestToSave);
    setWorkspace(nextWorkspace);

    const saved =
      nextWorkspace.requests.find((request) => requestToSave.id && !requestToSave.id.startsWith("draft-") && request.id === requestToSave.id) ||
      nextWorkspace.requests.find((request) => request.id && !existingIds.has(request.id));

    return saved ? normalizeDraftForEdit(saved) : null;
  };

  async function saveWorkbenchTab(tab: WorkbenchTab) {
    if (tab.kind === "request") {
      return saveTab(tab);
    }

    await persistEnvironment(tab.environment);
    return tab.environment;
  }

  const saveActiveDraft = async () => {
    if (!activeRequestTab) {
      return;
    }

    const saved = await saveTab(activeRequestTab);
    if (!saved) {
      return;
    }

    const nextId = requestKey(saved);
    moveSocketSession(activeRequestTab.id, nextId);
    moveHttpRequestRuntime(activeRequestTab.id, nextId);
    setOpenTabs((current) =>
      current.map((tab) =>
        tab.id === activeRequestTab.id && tab.kind === "request" ? { ...tab, id: nextId, draft: saved, savedSnapshot: requestSnapshot(saved) } : tab
      )
    );
    setActiveTabId(nextId);
    setSaveSuccess(true);
    window.setTimeout(() => setSaveSuccess(false), 1000);
  };

  const askToSaveDirtyTabs = (dirtyCount: number) =>
    new Promise<boolean>((resolve) => {
      closeDirtyTabsResolverRef.current = resolve;
      setCloseDirtyTabsDialog({ dirtyCount });
    });

  const resolveCloseDirtyTabsDialog = (shouldSave: boolean) => {
    closeDirtyTabsResolverRef.current?.(shouldSave);
    closeDirtyTabsResolverRef.current = null;
    setCloseDirtyTabsDialog(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && activePage === "client") {
        event.preventDefault();
        if (activeView.type === "environment") {
          saveEnvironment();
        } else if (activeView.type === "request") {
          saveActiveDraft();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const closeTabs = async (tabIds: string[]) => {
    const idsToClose = tabIds.filter((tabId) => openTabs.some((tab) => tab.id === tabId));
    if (idsToClose.length === 0) {
      return;
    }

    setContextMenu(null);

    const dirtyTabs = openTabs.filter((tab) => idsToClose.includes(tab.id) && isTabDirty(tab));
    if (dirtyTabs.length > 0) {
      const shouldSave = await askToSaveDirtyTabs(dirtyTabs.length);
      if (shouldSave) {
        try {
          for (const tab of dirtyTabs) {
            await saveWorkbenchTab(tab);
          }
        } catch (error) {
          console.error("Failed to save tab while closing", error);
          return;
        }
      }
    }

    closeSockets(idsToClose);
    abortHttpRequests(idsToClose);

    const closingIds = new Set(idsToClose);
    const activeIndex = activeTabId ? openTabs.findIndex((item) => item.id === activeTabId) : -1;
    const firstClosedIndex = Math.min(...idsToClose.map((id) => openTabs.findIndex((item) => item.id === id)).filter((index) => index >= 0));
    const remaining = openTabs.filter((item) => !closingIds.has(item.id));

    if (!activeTabId || closingIds.has(activeTabId)) {
      const baseIndex = activeIndex >= 0 ? activeIndex : firstClosedIndex;
      const nextActive = remaining[Math.max(0, baseIndex - 1)] || remaining[baseIndex] || remaining[0] || null;
      setActiveTabId(nextActive?.id || null);
      if (nextActive?.kind === "environment") {
        setSelectedFolder(nextActive.environment.folder);
      }
      setActiveView(
        nextActive ? (nextActive.kind === "environment" ? { type: "environment", folder: nextActive.environment.folder } : { type: "request" }) : { type: "empty" }
      );
    }

    setOpenTabs(remaining);
  };

  const closeTab = (tabId: string) => closeTabs([tabId]);
  const closeAllTabs = () => closeTabs(openTabs.map((tab) => tab.id));
  const closeOtherTabs = (tabId: string) => closeTabs(openTabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id));
  const reorderTabs = useCallback((tabId: string, nextIndex: number) => {
    setOpenTabs((current) => {
      const fromIndex = current.findIndex((tab) => tab.id === tabId);
      if (fromIndex < 0) {
        return current;
      }

      const boundedIndex = Math.min(Math.max(nextIndex, 0), current.length - 1);
      if (fromIndex === boundedIndex) {
        return current;
      }

      const next = [...current];
      const [tab] = next.splice(fromIndex, 1);
      next.splice(boundedIndex, 0, tab);
      return next;
    });
  }, []);

  const deleteRequest = async (request: RequestDraft) => {
    if (!workspace || !request.relativePath) {
      return;
    }

    const removedTabIds = openTabs.filter((tab) => tab.kind === "request" && tab.draft.id === request.id).map((tab) => tab.id);
    closeSockets(removedTabIds);
    abortHttpRequests(removedTabIds);
    const nextWorkspace = await window.openHttpNative.deleteRequest(workspace.path, request);
    setWorkspace(nextWorkspace);
    setContextMenu(null);
    setOpenTabs((current) => current.filter((tab) => tab.kind !== "request" || tab.draft.id !== request.id));
    if (draft?.id === request.id) {
      setActiveTabId(null);
      setActiveView({ type: "empty" });
    }
  };

  const duplicateRequest = async (request: RequestDraft) => {
    if (!workspace) {
      return;
    }

    const markerId = crypto.randomUUID();
    const copyRequest = compactRequest({
      ...cloneRequest(request),
      id: `draft-${markerId}`,
      markerId,
      relativePath: undefined,
      fileName: undefined,
      name: `${request.name} Copy`,
      folder: request.folder || ""
    });
    const existingIds = new Set(workspace.requests.map((item) => item.id));
    const nextWorkspace = await window.openHttpNative.saveRequest(workspace.path, copyRequest);
    const copied = nextWorkspace.requests.find((item) => item.id && !existingIds.has(item.id));
    setWorkspace(nextWorkspace);
    setContextMenu(null);
    if (copied) {
      openRequestTab(copied);
    }
  };

  const moveRequest = async (payload: RequestMovePayload) => {
    if (!workspace || !payload.request.id) {
      return;
    }

    const oldId = requestKey(payload.request);
    const moveResult = await window.openHttpNative.moveRequest(workspace.path, payload);
    const nextWorkspace = moveResult.workspace;
    const movedRequest = nextWorkspace.requests.find((item) => item.id === moveResult.movedRequestId);

    setWorkspace(nextWorkspace);
    setContextMenu(null);

    if (!movedRequest) {
      return;
    }

    const nextId = requestKey(movedRequest);
    const movedDraft = normalizeDraftForEdit(movedRequest);
    const movedSnapshot = requestSnapshot(movedDraft);
    moveSocketSession(oldId, nextId);
    moveHttpRequestRuntime(oldId, nextId);
    setOpenTabs((current) =>
      current.map((tab) => {
        if (tab.kind !== "request" || tab.id !== oldId) {
          return tab;
        }

        const wasDirty = isTabDirty(tab);
        return {
          ...tab,
          id: nextId,
          draft: wasDirty
            ? {
                ...tab.draft,
                id: movedRequest.id,
                markerId: movedRequest.markerId,
                relativePath: movedRequest.relativePath,
                fileName: movedRequest.fileName,
                folder: movedRequest.folder || "",
                updatedAt: movedRequest.updatedAt
              }
            : movedDraft,
          savedSnapshot: movedSnapshot
        };
      })
    );
    setExpandedFolders((current) => {
      const next = new Set(current);
      folderKeysForPath(movedRequest.folder || "").forEach((key) => next.add(key));
      return next;
    });
    setActiveTabId((current) => (current === oldId ? nextId : current));
  };

  const openFolderLocation = async (folder: string) => {
    if (!workspace) {
      return;
    }

    await window.openHttpNative.openFolderLocation(workspace.path, folder);
    setContextMenu(null);
  };

  const openRequestLocation = async (request: RequestDraft) => {
    if (!workspace) {
      return;
    }

    await window.openHttpNative.openRequestLocation(workspace.path, request);
    setContextMenu(null);
  };

  const copyFolder = async (folder: string) => {
    if (!workspace || !folder) {
      return;
    }

    const nextWorkspace = await window.openHttpNative.copyFolder(workspace.path, folder);
    setWorkspace(nextWorkspace);
    setContextMenu(null);
  };

  const deleteFolder = async (folder: string) => {
    if (!workspace || !folder) {
      return;
    }

    const removedTabIds = openTabs
      .filter((tab) => {
        const tabFolder = tab.kind === "environment" ? tab.environment.folder : tab.draft.folder || "";
        return tabFolder === folder || tabFolder.startsWith(`${folder}/`);
      })
      .map((tab) => tab.id);
    closeSockets(removedTabIds);
    abortHttpRequests(removedTabIds);

    const nextWorkspace = await window.openHttpNative.deleteFolder(workspace.path, folder);
    setWorkspace(nextWorkspace);
    setOpenTabs((current) =>
      current.filter((tab) => {
        const tabFolder = tab.kind === "environment" ? tab.environment.folder : tab.draft.folder || "";
        return tabFolder !== folder && !tabFolder.startsWith(`${folder}/`);
      })
    );
    setContextMenu(null);
    setSelectedFolder("");
    setActiveTabId(null);
    setActiveView({ type: "empty" });
  };

  const openContextMenu = (menu: ContextMenuState) => {
    setContextMenu(menu);
  };

  const showEnvironment = (folder: string) => {
    const environment = workspace?.environments[folder];

    if (!environment) {
      return;
    }

    const nextTab = createEnvironmentWorkbenchTab(environment);
    setSelectedFolder(folder);
    setActivePage("client");
    setActiveTabId(nextTab.id);
    setActiveView({ type: "environment", folder });

    setOpenTabs((current) => {
      const existing = current.find((tab) => tab.id === nextTab.id);
      if (existing) {
        return current;
      }

      return [...current, nextTab];
    });
  };

  const persistEnvironment = (
    environment: EnvironmentConfig,
    options: { optimistic?: boolean; syncDraftOnComplete?: boolean } = {}
  ) => {
    if (!workspace) {
      return Promise.resolve();
    }

    const workspacePath = workspace.path;
    const folder = environment.folder;
    const environmentForSave = compactEnvironment(environment);
    const saveVersion = ++environmentSaveVersionRef.current;

    if (options.optimistic) {
      setWorkspace((current) =>
        current && current.path === workspacePath
          ? {
              ...current,
              environments: {
                ...current.environments,
                [folder]: environmentForSave
              }
            }
          : current
      );
    }

    const saveTask = environmentSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const nextWorkspace = await window.openHttpNative.saveEnvironment(workspacePath, environmentForSave);

        if (saveVersion !== environmentSaveVersionRef.current || options.syncDraftOnComplete === false) {
          return;
        }

        setWorkspace(nextWorkspace);
        const savedEnvironment = nextWorkspace.environments[folder];
        if (savedEnvironment) {
          const environmentForEdit = normalizeEnvironmentForEdit(savedEnvironment);
          setOpenTabs((current) =>
            current.map((tab) =>
              tab.kind === "environment" && tab.environment.folder === folder
                ? {
                    ...tab,
                    id: environmentKey(folder),
                    environment: environmentForEdit,
                    savedSnapshot: environmentSnapshot(environmentForEdit)
                  }
                : tab
            )
          );
        }
      });

    environmentSaveQueueRef.current = saveTask.catch((error) => {
      if (saveVersion === environmentSaveVersionRef.current) {
        console.error("Failed to save environment", error);
      }
    });

    return environmentSaveQueueRef.current;
  };

  const saveEnvironment = async () => {
    if (!workspace || !environmentDraft) {
      return;
    }

    await persistEnvironment(environmentDraft);
  };

  const updateEnvironmentVariable = (id: string | undefined, patch: Partial<EnvironmentVariable>) => {
    if (!activeEnvironmentTab) {
      return;
    }

    const nextDraft = applyEnvironmentVariablePatch(activeEnvironmentTab.environment, id, patch);
    const shouldSaveImmediately = hasOwnPatchValue(patch, "active");
    setOpenTabs((current) =>
      current.map((tab) =>
        tab.id === activeEnvironmentTab.id && tab.kind === "environment"
          ? {
              ...tab,
              environment: nextDraft,
              savedSnapshot: shouldSaveImmediately ? environmentSnapshot(nextDraft) : tab.savedSnapshot
            }
          : tab
      )
    );

    if (shouldSaveImmediately) {
      void persistEnvironment(nextDraft, { optimistic: true, syncDraftOnComplete: false });
    }
  };

  const addEnvironmentVariable = () => {
    if (!activeEnvironmentTab) {
      return;
    }

    setOpenTabs((current) =>
      current.map((tab) =>
        tab.id === activeEnvironmentTab.id && tab.kind === "environment"
          ? { ...tab, environment: { ...tab.environment, variables: [...tab.environment.variables, emptyEnvVariable()] } }
          : tab
      )
    );
  };

  const removeEnvironmentVariable = (id: string | undefined) => {
    if (!activeEnvironmentTab) {
      return;
    }

    setOpenTabs((current) =>
      current.map((tab) => {
        if (tab.id !== activeEnvironmentTab.id || tab.kind !== "environment") {
          return tab;
        }

        const variables = tab.environment.variables.filter((variable) => variable.id !== id);
        return { ...tab, environment: { ...tab.environment, variables: variables.length ? variables : [emptyEnvVariable()] } };
      })
    );
  };

  const toggleFolder = (folder: string) => {
    const key = folderKey(folder);
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const sendHttp = async () => {
    if (!activeRequestTab || !draft || draft.type !== "http") {
      return;
    }

    const sendingTabId = activeRequestTab.id;
    if (httpAbortControllersRef.current.has(sendingTabId)) {
      abortHttpRequests([sendingTabId]);
      return;
    }

    const startedAt = performance.now();
    const abortController = new AbortController();
    const requestController: HttpRequestController = {
      abort: () => abortController.abort()
    };
    const currentSendingTabId = () => httpRequestTabIdsRef.current.get(requestController) || null;
    const isCurrentHttpRequest = () => {
      const currentTabId = currentSendingTabId();
      return Boolean(currentTabId && httpAbortControllersRef.current.get(currentTabId) === requestController);
    };
    const updateCurrentSendingTab = (recipe: (tab: Extract<WorkbenchTab, { kind: "request" }>) => Extract<WorkbenchTab, { kind: "request" }>) => {
      const currentTabId = currentSendingTabId();
      if (currentTabId && isCurrentHttpRequest()) {
        updateTabById(currentTabId, recipe);
      }
    };

    httpAbortControllersRef.current.set(sendingTabId, requestController);
    httpRequestTabIdsRef.current.set(requestController, sendingTabId);
    setHttpRequestRuntimes((current) => ({
      ...current,
      [sendingTabId]: {
        isSending: true,
        startedAt,
        uploadProgress: null
      }
    }));
    updateTabById(sendingTabId, (tab) => ({ ...tab, requestError: null, response: null }));

    const updateUploadProgress = (loaded: number, total: number | null) => {
      const currentTabId = currentSendingTabId();
      if (!currentTabId || !isCurrentHttpRequest()) {
        return;
      }

      const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
      const nextUploadProgress: UploadProgressState = {
        tabId: currentTabId,
        loaded,
        total,
        percent: total && total > 0 ? (loaded / total) * 100 : null,
        bytesPerSecond: loaded / elapsedSeconds
      };

      setHttpRequestRuntimes((current) => {
        const runtime = current[currentTabId];
        if (!runtime || !isCurrentHttpRequest()) {
          return current;
        }

        return {
          ...current,
          [currentTabId]: {
            ...runtime,
            uploadProgress: nextUploadProgress
          }
        };
      });
    };

    try {
      const resolvedUrl = resolveVariables(draft.url, activeEnvironment);
      const url = applyRowsToUrl(resolvedUrl, draft.params);
      const headers = new Headers();

      draft.headers.forEach((row) => {
        if (row.enabled) {
          const key = resolveVariables(row.key, activeEnvironment).trim();
          if (key) {
            headers.set(key, resolveVariables(row.value, activeEnvironment));
          }
        }
      });

      let requestBody: BodyInit | undefined;
      let shouldTrackUpload = false;
      if (!bodylessMethods.has(draft.method)) {
        if (draft.body.mode === "form-data") {
          const body = new FormData();
          let hasBody = false;

          draft.body.formData?.forEach((row) => {
            if (!row.enabled || !row.key.trim()) {
              return;
            }

            if (row.valueType === "file") {
              const files = row.id ? formFiles[row.id] || [] : [];
              if (files.length > 0) {
                shouldTrackUpload = true;
              }
              files.forEach((file) => {
                const fileWithType = row.contentType ? new File([file], file.name, { type: row.contentType }) : file;
                body.append(row.key.trim(), fileWithType);
                hasBody = true;
              });
              return;
            }

            if (row.contentType) {
              body.append(row.key.trim(), new Blob([row.value], { type: row.contentType }));
            } else {
              body.append(row.key.trim(), row.value);
            }
            hasBody = true;
          });

          requestBody = hasBody ? body : undefined;
          const formDataContentType = headers.get("Content-Type");
          if (formDataContentType?.toLowerCase().startsWith("multipart/form-data") && !/boundary=/i.test(formDataContentType)) {
            headers.delete("Content-Type");
          }
        } else if (draft.body.mode === "urlencoded") {
          const body = new URLSearchParams();
          draft.body.urlencoded?.forEach((row) => {
            if (row.enabled && row.key.trim()) {
              body.set(row.key.trim(), row.value);
            }
          });
          requestBody = body.toString() ? body : undefined;
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", draft.body.contentType.trim() || "application/x-www-form-urlencoded");
          }
        } else {
          requestBody = draft.body.raw || undefined;
          if (draft.body.contentType.trim() && !headers.has("Content-Type")) {
            headers.set("Content-Type", draft.body.contentType.trim());
          }
        }
      }

      if (shouldTrackUpload) {
        updateUploadProgress(0, null);
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          let responseInitialized = false;

          const createAbortError = () => {
            const error = new Error("Request canceled");
            error.name = "AbortError";
            return error;
          };

          const setInitialResponse = () => {
            if (responseInitialized || xhr.readyState < XMLHttpRequest.HEADERS_RECEIVED) {
              return;
            }

            const contentType = xhr.getResponseHeader("content-type") || "";
            const bodyKind = responseBodyKind(contentType);
            const responseHeaders = parseXhrResponseHeaders(xhr.getAllResponseHeaders());
            const initialResponse: ResponseState = {
              status: xhr.status,
              statusText: xhr.statusText,
              ok: xhr.status >= 200 && xhr.status < 300,
              elapsedMs: performance.now() - startedAt,
              size: 0,
              url: xhr.responseURL || url,
              headers: responseHeaders,
              body: "",
              bodyBlob: new Blob([], { type: contentType || "application/octet-stream" }),
              bodyKind,
              contentType
            };

            responseInitialized = true;
            updateCurrentSendingTab((tab) => ({ ...tab, response: initialResponse }));
          };

          xhr.open(draft.method, url, true);
          xhr.responseType = "blob";
          requestController.abort = () => {
            abortController.abort();
            xhr.abort();
          };

          headers.forEach((value, key) => {
            xhr.setRequestHeader(key, value);
          });

          xhr.onreadystatechange = () => {
            if (xhr.readyState >= XMLHttpRequest.HEADERS_RECEIVED) {
              setInitialResponse();
            }
          };
          xhr.upload.onprogress = (event) => {
            updateUploadProgress(event.loaded, event.lengthComputable ? event.total : null);
          };
          xhr.upload.onload = (event) => {
            updateUploadProgress(event.lengthComputable ? event.total : event.loaded, event.lengthComputable ? event.total : null);
          };
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.ontimeout = () => reject(new Error("Request timed out"));
          xhr.onabort = () => reject(createAbortError());
          xhr.onload = () => {
            setInitialResponse();

            void (async () => {
              const contentType = xhr.getResponseHeader("content-type") || "";
              const bodyKind = responseBodyKind(contentType);
              const finalBlob = responseBlobFromXhr(xhr, contentType);
              const finalBody = bodyKind === "text" ? prettyBody(await decodeResponseBlob(finalBlob, contentType), contentType) : "";
              updateCurrentSendingTab((tab) => ({
                ...tab,
                response: tab.response
                  ? {
                      ...tab.response,
                      elapsedMs: performance.now() - startedAt,
                      size: finalBlob.size,
                      body: finalBody,
                      bodyBlob: finalBlob
                    }
                  : {
                      status: xhr.status,
                      statusText: xhr.statusText,
                      ok: xhr.status >= 200 && xhr.status < 300,
                      elapsedMs: performance.now() - startedAt,
                      size: finalBlob.size,
                      url: xhr.responseURL || url,
                      headers: parseXhrResponseHeaders(xhr.getAllResponseHeaders()),
                      body: finalBody,
                      bodyBlob: finalBlob,
                      bodyKind,
                      contentType
                    }
              }));
            })()
              .then(resolve)
              .catch(reject);
          };

          if (abortController.signal.aborted) {
            reject(createAbortError());
            return;
          }

          xhr.send((requestBody as XMLHttpRequestBodyInit | undefined) ?? null);
        });
      } else {
        const result = await fetch(url, {
          method: draft.method,
          headers,
          body: requestBody,
          redirect: "follow",
          signal: abortController.signal
        });
        const contentType = result.headers.get("content-type") || "";
        const bodyKind = responseBodyKind(contentType);
        const responseHeaders = Array.from(result.headers.entries()).map(([key, value]) => ({
          id: crypto.randomUUID(),
          key,
          value,
          enabled: true
        }));

        const initialResponse: ResponseState = {
          status: result.status,
          statusText: result.statusText,
          ok: result.ok,
          elapsedMs: performance.now() - startedAt,
          size: 0,
          url: result.url,
          headers: responseHeaders,
          body: "",
          bodyBlob: new Blob([], { type: contentType || "application/octet-stream" }),
          bodyKind,
          contentType
        };

        updateCurrentSendingTab((tab) => ({ ...tab, response: initialResponse }));

        const reader = result.body?.getReader();
        const chunks: BlobPart[] = [];
        let size = 0;
        let rawText = "";
        const textDecoder = bodyKind === "text" ? createResponseTextDecoder(contentType) : null;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (!value) {
              continue;
            }

            const chunk = new Uint8Array(value);
            chunks.push(chunk);
            size += chunk.byteLength;

            if (textDecoder) {
              rawText += textDecoder.decode(chunk, { stream: true });
              updateCurrentSendingTab((tab) => ({
                ...tab,
                response: tab.response
                  ? {
                      ...tab.response,
                      elapsedMs: performance.now() - startedAt,
                      size,
                      body: rawText,
                      bodyBlob: new Blob(chunks, { type: contentType || "text/plain;charset=utf-8" })
                    }
                  : tab.response
              }));
            } else {
              updateCurrentSendingTab((tab) => ({
                ...tab,
                response: tab.response
                  ? {
                      ...tab.response,
                      elapsedMs: performance.now() - startedAt,
                      size
                    }
                  : tab.response
              }));
            }
          }
        }

        if (textDecoder) {
          rawText += textDecoder.decode();
        }

        const finalBlob = new Blob(chunks, { type: contentType || "application/octet-stream" });
        const finalBody = textDecoder ? prettyBody(rawText, contentType) : "";
        updateCurrentSendingTab((tab) => ({
          ...tab,
          response: tab.response
            ? {
                ...tab.response,
                elapsedMs: performance.now() - startedAt,
                size,
                body: finalBody,
                bodyBlob: finalBlob
              }
            : tab.response
        }));
      }
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === "AbortError";
      const currentTabId = currentSendingTabId();
      if (currentTabId && isCurrentHttpRequest()) {
        updateTabById(currentTabId, (tab) => ({
          ...tab,
          requestError: isAbortError ? "Request canceled" : error instanceof Error ? error.message : String(error)
        }));
      }
    } finally {
      const currentTabId = currentSendingTabId();
      if (currentTabId && isCurrentHttpRequest()) {
        httpAbortControllersRef.current.delete(currentTabId);
        httpRequestTabIdsRef.current.delete(requestController);
        setHttpRequestRuntimes((current) => {
          if (!current[currentTabId]) {
            return current;
          }

          const next = { ...current };
          delete next[currentTabId];
          return next;
        });
      }
    }
  };

  const downloadResponse = (response: ResponseState) => {
    const extension = responseFileExtension(response.contentType, response.bodyKind);
    const blob =
      response.bodyKind === "text"
        ? new Blob([response.body], { type: response.contentType || "text/plain;charset=utf-8" })
        : response.bodyBlob;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `openhttp-response-${Date.now()}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const addWsMessage = useCallback(
    (tabId: string, message: Omit<WebSocketMessage, "id" | "time">) => {
      updateWebSocketSession(tabId, (session) => ({
        ...session,
        messages: [
          ...session.messages,
          {
            id: crypto.randomUUID(),
            time: timeStamp(),
            ...message
          }
        ]
      }));
    },
    [updateWebSocketSession]
  );

  const connectWebSocket = () => {
    if (!activeRequestTab || !draft || draft.type !== "websocket") {
      return;
    }

    const connectingTabId = activeRequestTab.id;
    const currentStatus = wsSessions[connectingTabId]?.status || emptyWebSocketSession.status;
    if (currentStatus === "connecting" || currentStatus === "open") {
      return;
    }

    updateWebSocketSession(connectingTabId, (session) => ({ ...session, messages: [], status: "connecting" }));

    try {
      const protocols = draft.protocols
        .split(",")
        .map((protocol) => protocol.trim())
        .filter(Boolean);
      const resolvedUrl = resolveVariables(draft.url, activeEnvironment);
      const socket = protocols.length > 0 ? new WebSocket(resolvedUrl, protocols) : new WebSocket(resolvedUrl);
      socketsRef.current.set(connectingTabId, socket);

      socket.addEventListener("open", () => {
        const currentTabId = findSocketTabId(socket);
        if (!currentTabId) {
          return;
        }

        updateWebSocketSession(currentTabId, (session) => ({ ...session, status: "open" }));
        addWsMessage(currentTabId, { direction: "system", body: "Connected" });
      });

      socket.addEventListener("message", (event) => {
        const currentTabId = findSocketTabId(socket);
        if (!currentTabId) {
          return;
        }

        addWsMessage(currentTabId, { direction: "in", body: String(event.data) });
      });

      socket.addEventListener("close", (event) => {
        const currentTabId = findSocketTabId(socket);
        if (!currentTabId) {
          return;
        }

        socketsRef.current.delete(currentTabId);
        updateWebSocketSession(currentTabId, (session) => ({ ...session, status: event.wasClean ? "closed" : "error" }));
        addWsMessage(currentTabId, {
          direction: "system",
          body: `Closed ${event.code}${event.reason ? `: ${event.reason}` : ""}`
        });
      });

      socket.addEventListener("error", () => {
        const currentTabId = findSocketTabId(socket);
        if (!currentTabId) {
          return;
        }

        updateWebSocketSession(currentTabId, (session) => ({ ...session, status: "error" }));
        addWsMessage(currentTabId, { direction: "error", body: "Connection error" });
      });
    } catch (error) {
      updateWebSocketSession(connectingTabId, (session) => ({ ...session, status: "error" }));
      addWsMessage(connectingTabId, { direction: "error", body: error instanceof Error ? error.message : String(error) });
    }
  };

  const disconnectWebSocket = () => {
    if (!activeRequestTab || activeRequestTab.draft.type !== "websocket") {
      return;
    }

    const disconnectingTabId = activeRequestTab.id;
    socketsRef.current.get(disconnectingTabId)?.close(1000, "Closed by user");
    updateWebSocketSession(disconnectingTabId, (session) => ({ ...session, status: "closed" }));
  };

  const sendWebSocketMessage = () => {
    if (!activeRequestTab || activeRequestTab.draft.type !== "websocket") {
      return;
    }

    const sendingTabId = activeRequestTab.id;
    const session = wsSessions[sendingTabId] || emptyWebSocketSession;
    const socket = socketsRef.current.get(sendingTabId);
    if (!socket || socket.readyState !== WebSocket.OPEN || session.status !== "open" || !session.outbound) {
      return;
    }

    socket.send(session.outbound);
    addWsMessage(sendingTabId, { direction: "out", body: session.outbound });
    updateWebSocketSession(sendingTabId, (current) => ({ ...current, outbound: "" }));
  };

  return (
    <div className="app-frame" data-theme={isDark ? "dark" : "light"} spellCheck={false}>
      <header
        className="titlebar"
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".titlebar-no-drag")) {
            return;
          }

          window.openHttpNative.toggleMaximizeWindow().then(setIsMaximized);
        }}
      >
        <div className="titlebar-left titlebar-no-drag">
          <img className="titlebar-app-icon" src={openHttpIcon} alt="OpenHTTP" />

          <div className="title-menu" ref={titleMenuRef}>
            <button
              className={`title-menu-button ${isAppMenuOpen ? "active" : ""}`}
              onClick={() => setIsAppMenuOpen((current) => !current)}
              title="Menu"
            >
              <AlignJustify size={18} />
            </button>

            {isAppMenuOpen && (
              <div className="title-menu-popover">
                <button
                  onClick={() => {
                    setIsAppMenuOpen(false);
                    openWorkspace();
                  }}
                >
                  <FolderOpen size={15} />
                  Open Folder
                </button>
                <button
                  onClick={() => {
                    setIsAppMenuOpen(false);
                    setActiveSettingsSection("settings");
                    setIsSettingsOpen(true);
                  }}
                >
                  <Settings size={15} />
                  Setting
                </button>
                <span className="menu-separator" />
                <button
                  className="title-menu-about"
                  onClick={() => {
                    setIsAppMenuOpen(false);
                    setActiveSettingsSection("about");
                    setIsSettingsOpen(true);
                  }}
                >
                  <span className="title-menu-item-label">
                    <Info size={15} />
                    About
                  </span>
                  <span className="title-menu-version">{appVersion ? `v${appVersion}` : "Version"}</span>
                </button>
                <button
                  onClick={() => {
                    setIsAppMenuOpen(false);
                    window.openHttpNative.closeWindow();
                  }}
                >
                  <LogOut size={15} />
                  Exit
                </button>
              </div>
            )}
          </div>

          <button className={`title-nav ${activePage === "client" ? "active" : ""}`} onClick={() => setActivePage("client")}>
            OpenHTTP
          </button>
          <button className={`title-nav ${activePage === "tools" ? "active" : ""}`} onClick={() => setActivePage("tools")}>
            Tools
          </button>
        </div>

        <div className="titlebar-drag-space" />

        <div className="window-controls titlebar-no-drag">
          <button
            className="window-button"
            onClick={() => setIsSidebarHidden((current) => !current)}
            title={isSidebarHidden ? "Show sidebar" : "Hide sidebar"}
          >
            {isSidebarHidden ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <label className="theme-switch" title={isDark ? "Light mode" : "Dark mode"}>
            <Sun size={14} />
            <input type="checkbox" checked={isDark} onChange={(event) => setIsDark(event.target.checked)} />
            <span />
            <Moon size={14} />
          </label>
          <button className="window-button" onClick={() => window.openHttpNative.minimizeWindow()} title="Minimize">
            <Minus size={15} />
          </button>
          <button
            className="window-button"
            onClick={() => window.openHttpNative.toggleMaximizeWindow().then(setIsMaximized)}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="window-button close" onClick={() => window.openHttpNative.closeWindow()} title="Close">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className={`app-page-view ${activePage === "client" ? "active" : ""}`} aria-hidden={activePage !== "client"}>
        <ClientPage
            isSidebarHidden={isSidebarHidden}
            leftWidth={leftWidth}
            workspace={workspace}
            folderTree={folderTree}
            selectedFolder={selectedFolder}
            selectedRequestId={draft ? requestKey(draft) : null}
            selectedEnvironmentFolder={activeView.type === "environment" ? activeView.folder : null}
            activeView={activeView}
            activeTab={activeTab}
            draft={draft}
            activeEnvironment={activeEnvironment}
            expandedFolders={expandedFolders}
            openTabs={openTabs}
            activeTabId={activeTabId}
            dirtyTabIds={dirtyTabIds}
            environmentDraft={environmentDraft}
            isDirty={isDirty}
            saveSuccess={saveSuccess}
            isSending={isActiveHttpSending}
            sendStartedAt={activeHttpStartedAt}
            uploadProgress={activeHttpUploadProgress}
            wsStatus={wsStatus}
            wsMessages={wsMessages}
            wsOutbound={wsOutbound}
            formFiles={formFiles}
            filter={filter}
            draggingRef={draggingRef}
            setFilter={setFilter}
            setSelectedFolder={setSelectedFolder}
            setActivePage={setActivePage}
            setActiveView={setActiveView}
            setActiveTabId={setActiveTabId}
            setSaveSuccess={setSaveSuccess}
            setFormFiles={setFormFiles}
            setWsOutbound={setActiveWsOutbound}
            openWorkspace={openWorkspace}
            refreshWorkspace={refreshWorkspace}
            createRequest={createRequest}
            toggleFolder={toggleFolder}
            openRequestTab={openRequestTab}
            showEnvironment={showEnvironment}
            openContextMenu={openContextMenu}
            duplicateRequest={duplicateRequest}
            deleteRequest={deleteRequest}
            moveRequest={moveRequest}
            closeTab={closeTab}
            reorderTabs={reorderTabs}
            addEnvironmentVariable={addEnvironmentVariable}
            updateEnvironmentVariable={updateEnvironmentVariable}
            removeEnvironmentVariable={removeEnvironmentVariable}
            saveEnvironment={saveEnvironment}
            updateActiveDraft={updateActiveDraft}
            updateActiveTab={updateActiveTab}
            updateHttpDraft={updateHttpDraft}
            updateWebSocketDraft={updateWebSocketDraft}
            saveActiveDraft={saveActiveDraft}
            sendHttp={sendHttp}
            downloadResponse={downloadResponse}
            connectWebSocket={connectWebSocket}
            disconnectWebSocket={disconnectWebSocket}
            sendWebSocketMessage={sendWebSocketMessage}
          />
      </div>
      <div className={`app-page-view ${activePage === "tools" ? "active" : ""}`} aria-hidden={activePage !== "tools"}>
        <ToolsPage activeTool={activeTool} onSelectTool={setActiveTool} isSidebarHidden={isSidebarHidden} />
      </div>

      {contextMenu && (
        <TreeContextMenu
          menu={contextMenu}
          refObject={contextMenuRef}
          onCreateRequest={createRequest}
          onCreateFolder={createChildFolder}
          onRenameFolder={renameFolder}
          onOpenFolderLocation={openFolderLocation}
          onOpenRequestLocation={openRequestLocation}
          onDuplicateRequest={duplicateRequest}
          onDeleteRequest={deleteRequest}
          onCloseTab={closeTab}
          onCloseOtherTabs={closeOtherTabs}
          onCloseAllTabs={closeAllTabs}
        />
      )}

      {closeDirtyTabsDialog && (
        <CloseDirtyTabsDialog
          dirtyCount={closeDirtyTabsDialog.dirtyCount}
          onDiscard={() => resolveCloseDirtyTabsDialog(false)}
          onSave={() => resolveCloseDirtyTabsDialog(true)}
        />
      )}

      {createFolderDialog && (
        <CreateFolderDialog
          parentLabel={createFolderDialog.parentFolder || workspace?.name || "Workspace"}
          onCancel={() => setCreateFolderDialog(null)}
          onCreate={confirmCreateFolder}
        />
      )}

      {renameFolderDialog && (
        <CreateFolderDialog
          parentLabel={renameFolderDialog.folder}
          initialName={renameFolderDialog.folder.split("/").pop() || renameFolderDialog.folder}
          title="Rename Folder"
          actionLabel="Rename"
          actionIcon="rename"
          onCancel={() => setRenameFolderDialog(null)}
          onCreate={confirmRenameFolder}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          activeSection={activeSettingsSection}
          appVersion={appVersion}
          isDark={isDark}
          verifySsl={verifySsl}
          onClose={() => setIsSettingsOpen(false)}
          onSelectSection={setActiveSettingsSection}
          onToggleDark={setIsDark}
          onToggleVerifySsl={setVerifySsl}
        />
      )}
    </div>
  );
}

export default App;
