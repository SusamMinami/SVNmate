import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("shotSandboxDesktop", {
  getSetupStatus: () => ipcRenderer.invoke("desktop:setup-status"),
  installTraeIntegration: () =>
    ipcRenderer.invoke("desktop:install-trae-integration"),
  openIntegrationFolder: () =>
    ipcRenderer.invoke("desktop:open-integration-folder"),
  openTraeDownload: () =>
    ipcRenderer.invoke("desktop:open-trae-download"),
  setUeMcpPort: (port: number) =>
    ipcRenderer.invoke("desktop:set-ue-port", port),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  setLiveCsvDirectory: (directoryPath: string) =>
    ipcRenderer.invoke("desktop:set-live-data-directory", directoryPath),
  setConfigCsvDirectory: (directoryPath: string) =>
    ipcRenderer.invoke("desktop:set-config-directory", directoryPath),
  restoreDataDirectories: (
    liveCsvDirectory: string,
    configCsvDirectory: string,
  ) =>
    ipcRenderer.invoke("desktop:restore-data-directories", {
      liveCsvDirectory,
      configCsvDirectory,
    }),
  completeSetup: () => ipcRenderer.invoke("desktop:complete-setup"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-update"),
  getUpdateSnapshot: () => ipcRenderer.invoke("desktop:update-snapshot"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  openUpdatePage: () => ipcRenderer.invoke("desktop:open-update-page"),
  onUpdateState: (
    listener: (snapshot: {
      state: string;
      version?: string;
      percent?: number;
      message?: string;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      snapshot: {
        state: string;
        version?: string;
        percent?: number;
        message?: string;
      },
    ) => listener(snapshot);
    ipcRenderer.on("desktop:update-state", handler);
    return () => ipcRenderer.removeListener("desktop:update-state", handler);
  },
});
