const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openHttpNative", {
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  readWorkspace: (workspacePath) => ipcRenderer.invoke("workspace:read", workspacePath),
  saveRequest: (workspacePath, request) => ipcRenderer.invoke("request:save", workspacePath, request),
  deleteRequest: (workspacePath, request) => ipcRenderer.invoke("request:delete", workspacePath, request),
  saveEnvironment: (workspacePath, environment) => ipcRenderer.invoke("environment:save", workspacePath, environment),
  openFolderLocation: (workspacePath, folder) => ipcRenderer.invoke("folder:open-location", workspacePath, folder),
  copyFolder: (workspacePath, folder) => ipcRenderer.invoke("folder:copy", workspacePath, folder),
  deleteFolder: (workspacePath, folder) => ipcRenderer.invoke("folder:delete", workspacePath, folder),
  createFolder: (workspacePath, parentFolder, name) => ipcRenderer.invoke("folder:create", workspacePath, parentFolder, name),
  setVerifySsl: (value) => ipcRenderer.invoke("settings:set-verify-ssl", value),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onWindowMaximizedChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on("window:maximized-change", listener);
    return () => ipcRenderer.removeListener("window:maximized-change", listener);
  }
});
