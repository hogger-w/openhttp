import {
  AlignJustify,
  FolderOpen,
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
  const [isSending, setIsSending] = useState(false);
  const [sendStartedAt, setSendStartedAt] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [wsSessions, setWsSessions] = useState<Record<string, WebSocketSession>>({});
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("settings");
  const [verifySsl, setVerifySsl] = useState(() => localStorage.getItem("openhttp:verify-ssl") !== "false");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolId>("base64");
  const [closeDirtyTabsDialog, setCloseDirtyTabsDialog] = useState<CloseDirtyTabsDialogState | null>(null);
  const [createFolderDialog, setCreateFolderDialog] = useState<CreateFolderDialogState | null>(null);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const httpAbortControllerRef = useRef<HttpRequestController | null>(null);
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

  useEffect(() => {
    const recentWorkspace = localStorage.getItem("openhttp:last-workspace");

    if (!recentWorkspace) {
      return;
    }

    window.openHttpNative
      .readWorkspace(recentWorkspace)
      .then((nextWorkspace) => {
        setWorkspace(nextWorkspace);
        setExpandedFolders(new Set([rootFolderId]));
        if (nextWorkspace.requests[0]) {
          openRequestTab(nextWorkspace.requests[0], true);
        }
      })
      .catch(() => {
        localStorage.removeItem("openhttp:last-workspace");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      httpAbortControllerRef.current?.abort();
      socketsRef.current.forEach((socket) => socket.close());
      socketsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    window.openHttpNative.isWindowMaximized().then(setIsMaximized);
    return window.openHttpNative.onWindowMaximizedChange(setIsMaximized);
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

    localStorage.setItem("openhttp:last-workspace", nextWorkspace.path);
    closeAllSockets();
    setWorkspace(nextWorkspace);
    setOpenTabs([]);
    setActiveTabId(null);
    setSelectedFolder("");
    setExpandedFolders(new Set([rootFolderId]));
    setActiveView({ type: "empty" });

    if (nextWorkspace.requests[0]) {
      openRequestTab(nextWorkspace.requests[0], true);
    }
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

  const openRequestTab = (request: RequestDraft, replaceCurrent = false) => {
    setSaveSuccess(false);
    const id = requestKey(request);
    const draftForEdit = normalizeDraftForEdit(request);
    setActivePage("client");
    setActiveView({ type: "request" });
    setActiveTabId(id);

    setOpenTabs((current) => {
      const existing = current.find((tab) => tab.id === id);
      if (existing) {
        return current;
      }

      const nextTab: WorkbenchTab = {
        kind: "request",
        id,
        draft: draftForEdit,
        savedSnapshot: requestSnapshot(draftForEdit),
        httpTab: "body",
        resultTab: "body",
        response: null,
        requestError: null
      };

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

  const deleteRequest = async (request: RequestDraft) => {
    if (!workspace || !request.relativePath) {
      return;
    }

    closeSockets(openTabs.filter((tab) => tab.kind === "request" && tab.draft.id === request.id).map((tab) => tab.id));
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

    const id = environmentKey(folder);
    const environmentForEdit = normalizeEnvironmentForEdit(environment);
    setSelectedFolder(folder);
    setActivePage("client");
    setActiveTabId(id);
    setActiveView({ type: "environment", folder });

    setOpenTabs((current) => {
      const existing = current.find((tab) => tab.id === id);
      if (existing) {
        return current;
      }

      return [
        ...current,
        {
          kind: "environment",
          id,
          environment: environmentForEdit,
          savedSnapshot: environmentSnapshot(environmentForEdit)
        }
      ];
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
    if (isSending) {
      httpAbortControllerRef.current?.abort();
      return;
    }

    if (!activeRequestTab || !draft || draft.type !== "http") {
      return;
    }

    const sendingTabId = activeRequestTab.id;
    const startedAt = performance.now();
    const abortController = new AbortController();
    const requestController: HttpRequestController = {
      abort: () => abortController.abort()
    };
    httpAbortControllerRef.current = requestController;
    setIsSending(true);
    setSendStartedAt(startedAt);
    setUploadProgress(null);
    updateTabById(sendingTabId, (tab) => ({ ...tab, requestError: null, response: null }));

    const updateUploadProgress = (loaded: number, total: number | null) => {
      const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
      setUploadProgress({
        tabId: sendingTabId,
        loaded,
        total,
        percent: total && total > 0 ? (loaded / total) * 100 : null,
        bytesPerSecond: loaded / elapsedSeconds
      });
    };

    try {
      const resolvedUrl = resolveVariables(draft.url, activeEnvironment);
      const url = applyRowsToUrl(resolvedUrl, draft.params);
      const headers = new Headers();

      draft.headers.forEach((row) => {
        if (row.enabled && row.key.trim()) {
          headers.set(row.key.trim(), row.value);
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
            updateTabById(sendingTabId, (tab) => ({ ...tab, response: initialResponse }));
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
              updateTabById(sendingTabId, (tab) => ({
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

        updateTabById(sendingTabId, (tab) => ({ ...tab, response: initialResponse }));

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
              updateTabById(sendingTabId, (tab) => ({
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
              updateTabById(sendingTabId, (tab) => ({
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
        updateTabById(sendingTabId, (tab) => ({
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
      updateTabById(sendingTabId, (tab) => ({
        ...tab,
        requestError: isAbortError ? "Request canceled" : error instanceof Error ? error.message : String(error)
      }));
    } finally {
      if (httpAbortControllerRef.current === requestController) {
        httpAbortControllerRef.current = null;
      }
      setIsSending(false);
      setSendStartedAt(null);
      setUploadProgress(null);
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

      {activePage === "client" ? (
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
          isSending={isSending}
          sendStartedAt={sendStartedAt}
          uploadProgress={activeTab?.kind === "request" && uploadProgress?.tabId === activeTab.id ? uploadProgress : null}
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
      ) : (
        <ToolsPage activeTool={activeTool} onSelectTool={setActiveTool} isSidebarHidden={isSidebarHidden} />
      )}

      {contextMenu && (
        <TreeContextMenu
          menu={contextMenu}
          refObject={contextMenuRef}
          onCreateRequest={createRequest}
          onCreateFolder={createChildFolder}
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

      {isSettingsOpen && (
        <SettingsModal
          activeSection={activeSettingsSection}
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
