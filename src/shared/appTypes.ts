import type { RequestDraft, ResponseState } from "../types";

export type AppPage = "client" | "tools";
export type WorkbenchView = { type: "empty" } | { type: "request" } | { type: "environment"; folder: string };
export type ToolId = "base64" | "json-format" | "cron" | "regex" | "url-codec" | "timestamp";
export type SettingsSection = "settings" | "about";

export type ContextMenuState =
  | { type: "folder"; folder: string; x: number; y: number }
  | { type: "request"; request: RequestDraft; x: number; y: number }
  | { type: "tab"; tabId: string; x: number; y: number };

export type CloseDirtyTabsDialogState = {
  dirtyCount: number;
};

export type FormFileMap = Record<string, File[]>;

export type RequestTab = {
  id: string;
  draft: RequestDraft;
  savedSnapshot: string;
  httpTab: "params" | "headers" | "body";
  resultTab: "body" | "headers";
  response: ResponseState | null;
  requestError: string | null;
};

export type FolderNode = {
  path: string;
  name: string;
  children: FolderNode[];
  requests: RequestDraft[];
};
