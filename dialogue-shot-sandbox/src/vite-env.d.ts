/// <reference types="vite/client" />

interface DesktopSetupStatus {
  firstRun: boolean;
  setupCompleted: boolean;
  version: string;
  packaged: boolean;
  portable: boolean;
  runtimeBundled: boolean;
  traeDetected: boolean;
  traeExecutable: string | null;
  integrationInstalled: boolean;
  integrationRoot: string;
  mcpConnected: boolean;
  mcpVersion: string | null;
  expectedMcpVersion: string;
  defaultDataReady: boolean;
  liveDataReady: boolean;
  configDataReady: boolean;
  liveResDirectory: string;
  configDocDirectory: string;
  liveCsvDirectory: string;
  configCsvDirectory: string;
  missionTargetTablePath: string;
  ueConnected: boolean;
  ueMcpHost: string;
  ueMcpPort: number;
  ueConnectionMessage: string;
  updateSupported: boolean;
  updatePage: string;
}

interface DesktopUpdateSnapshot {
  state:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "current"
    | "error";
  version?: string;
  percent?: number;
  message?: string;
}

interface Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
  shotSandboxDesktop?: {
    getSetupStatus: () => Promise<DesktopSetupStatus>;
    installTraeIntegration: () => Promise<DesktopSetupStatus>;
    openIntegrationFolder: () => Promise<void>;
    openTraeDownload: () => Promise<void>;
    setUeMcpPort: (port: number) => Promise<DesktopSetupStatus>;
    getConfigurationWindowMode?: () => Promise<boolean>;
    setConfigurationWindowMode?: (enabled: boolean) => Promise<boolean>;
    getPathForFile: (file: File) => string;
    chooseDataDirectory?: (
      kind: "live" | "config",
    ) => Promise<DesktopSetupStatus | null>;
    setLiveResDirectory?: (
      directoryPath: string,
    ) => Promise<DesktopSetupStatus>;
    setConfigDocDirectory?: (
      directoryPath: string,
    ) => Promise<DesktopSetupStatus>;
    restoreDataDirectories?: (
      liveResDirectory: string,
      configDocDirectory: string,
    ) => Promise<DesktopSetupStatus>;
    completeSetup: () => Promise<DesktopSetupStatus>;
    checkForUpdates: () => Promise<DesktopUpdateSnapshot>;
    getUpdateSnapshot: () => Promise<DesktopUpdateSnapshot>;
    installUpdate: () => Promise<void>;
    openUpdatePage: () => Promise<void>;
    onUpdateState: (
      listener: (snapshot: DesktopUpdateSnapshot) => void,
    ) => () => void;
  };
}
