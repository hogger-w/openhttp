import type { EnvironmentConfig, RequestDraft, ResponseState } from "../types";

export type AppPage = "client" | "tools";
export type WorkbenchView = { type: "empty" } | { type: "request" } | { type: "environment"; folder: string };
export type ToolId = "base64" | "json-format" | "cron" | "regex" | "url-codec" | "timestamp";
export type SettingsSection = "settings" | "about";

export type ContextMenuState =
  | { type: "folder"; folder: string; x: number; y: number }
  | { type: "request"; request: RequestDraft; x: number; y: number }
  | { type: "tab"; tabId: string; x: number; y: number };

export type RequestDropTarget =
  | { type: "folder"; folder: string }
  | { type: "request"; requestId: string; position: "before" | "after" };

export type CloseDirtyTabsDialogState = {
  dirtyCount: number;
};

export type CreateFolderDialogState = {
  parentFolder: string;
};

export type FormFileMap = Record<string, File[]>;

export type RequestTab = {
  kind: "request";
  id: string;
  draft: RequestDraft;
  savedSnapshot: string;
  httpTab: "params" | "headers" | "body";
  resultTab: "body" | "headers";
  response: ResponseState | null;
  requestError: string | null;
};

export type EnvironmentTab = {
  kind: "environment";
  id: string;
  environment: EnvironmentConfig;
  savedSnapshot: string;
};

export type WorkbenchTab = RequestTab | EnvironmentTab;

export type FolderNode = {
  path: string;
  name: string;
  children: FolderNode[];
  requests: RequestDraft[];
};
