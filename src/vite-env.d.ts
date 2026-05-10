/// <reference types="vite/client" />

import type { EnvironmentConfig, RequestDraft, WorkspaceState } from "./types";

export {};

declare global {
  interface Window {
    openHttpNative: {
      openWorkspace: () => Promise<WorkspaceState | null>;
      readWorkspace: (workspacePath: string) => Promise<WorkspaceState>;
      saveRequest: (workspacePath: string, request: RequestDraft) => Promise<WorkspaceState>;
      deleteRequest: (workspacePath: string, request: RequestDraft) => Promise<WorkspaceState>;
      saveEnvironment: (workspacePath: string, environment: EnvironmentConfig) => Promise<WorkspaceState>;
      openFolderLocation: (workspacePath: string, folder: string) => Promise<void>;
      copyFolder: (workspacePath: string, folder: string) => Promise<WorkspaceState>;
      deleteFolder: (workspacePath: string, folder: string) => Promise<WorkspaceState>;
      createFolder: (workspacePath: string, parentFolder: string, name: string) => Promise<WorkspaceState>;
      setVerifySsl: (value: boolean) => Promise<boolean>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<boolean>;
      closeWindow: () => Promise<void>;
      isWindowMaximized: () => Promise<boolean>;
      onWindowMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
    };
  }
}
