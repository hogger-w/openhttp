/// <reference types="vite/client" />

import type { EnvironmentConfig, RequestDraft, RequestMovePayload, RequestMoveResult, WorkspaceState } from "./types";

type CreateFolderResult = {
  workspace: WorkspaceState;
  createdFolder: string;
};

type RenameFolderResult = {
  workspace: WorkspaceState;
  renamedFolder: string;
};

export {};

declare global {
  interface Window {
    openHttpNative: {
      openWorkspace: () => Promise<WorkspaceState | null>;
      readWorkspace: (workspacePath: string) => Promise<WorkspaceState>;
      saveRequest: (workspacePath: string, request: RequestDraft) => Promise<WorkspaceState>;
      moveRequest: (workspacePath: string, payload: RequestMovePayload) => Promise<RequestMoveResult>;
      deleteRequest: (workspacePath: string, request: RequestDraft) => Promise<WorkspaceState>;
      saveEnvironment: (workspacePath: string, environment: EnvironmentConfig) => Promise<WorkspaceState>;
      openFolderLocation: (workspacePath: string, folder: string) => Promise<void>;
      openRequestLocation: (workspacePath: string, request: RequestDraft) => Promise<void>;
      copyFolder: (workspacePath: string, folder: string) => Promise<WorkspaceState>;
      deleteFolder: (workspacePath: string, folder: string) => Promise<WorkspaceState>;
      renameFolder: (workspacePath: string, folder: string, name: string) => Promise<RenameFolderResult>;
      createFolder: (workspacePath: string, parentFolder: string, name: string) => Promise<CreateFolderResult>;
      setVerifySsl: (value: boolean) => Promise<boolean>;
      getAppVersion: () => Promise<string>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<boolean>;
      closeWindow: () => Promise<void>;
      isWindowMaximized: () => Promise<boolean>;
      onWindowMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
    };
  }
}
