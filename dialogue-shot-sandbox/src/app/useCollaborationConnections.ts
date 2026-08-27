import { useCallback, useRef, useState } from "react";
import {
  discoverMira,
  finishLarkAuthorization,
  getLarkStatus,
  startLarkAuthorization,
  type LarkAuthChallenge,
  type LarkStatus,
} from "../lark/client";
import {
  getTraeMcpConfig,
  getTraeStatus,
  type TraeCollaborationStatus,
  type TraeMcpConfig,
} from "../trae/client";

const CASE_COLLECTION_STORAGE_KEY = "shot-sandbox.collect-revision-cases";

export function useCollaborationConnections() {
  const [traeStatus, setTraeStatus] =
    useState<TraeCollaborationStatus | null>(null);
  const [traeLoading, setTraeLoading] = useState(false);
  const [traeError, setTraeError] = useState("");
  const [traeConfig, setTraeConfig] = useState<TraeMcpConfig | null>(null);
  const [larkStatus, setLarkStatus] = useState<LarkStatus | null>(null);
  const [larkLoading, setLarkLoading] = useState(false);
  const [larkError, setLarkError] = useState("");
  const [authStart, setAuthStart] = useState<LarkAuthChallenge | null>(null);
  const [authFinishing, setAuthFinishing] = useState(false);
  const authFinishingRef = useRef(false);
  const [collectRevisionCases, setCollectRevisionCases] = useState(
    () => window.localStorage.getItem(CASE_COLLECTION_STORAGE_KEY) !== "0",
  );

  const refreshTraeConnection = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setTraeLoading(true);
    }
    setTraeError("");
    try {
      setTraeStatus(await getTraeStatus());
    } catch (connectionError) {
      setTraeError(
        connectionError instanceof Error
          ? connectionError.message
          : "TRAE 连接检查失败",
      );
    } finally {
      if (showLoading) {
        setTraeLoading(false);
      }
    }
  }, []);

  const setupTrae = useCallback(async () => {
    setTraeLoading(true);
    setTraeError("");
    try {
      setTraeConfig(await getTraeMcpConfig());
    } catch (configError) {
      setTraeError(
        configError instanceof Error
          ? configError.message
          : "无法读取内部 TRAE MCP 配置",
      );
    } finally {
      setTraeLoading(false);
    }
  }, []);

  const refreshLarkConnection = useCallback(async (discover: boolean) => {
    setLarkLoading(true);
    setLarkError("");
    try {
      const status = await getLarkStatus();
      if (
        discover &&
        status.authorized &&
        status.miraMissingScopes.length === 0
      ) {
        const discovery = await discoverMira();
        status.miraBot = discovery.selected;
      }
      setLarkStatus(status);
    } catch (connectionError) {
      setLarkError(
        connectionError instanceof Error
          ? connectionError.message
          : "飞书连接检查失败",
      );
    } finally {
      setLarkLoading(false);
    }
  }, []);

  const beginAuthorization = useCallback(async () => {
    setLarkLoading(true);
    setLarkError("");
    try {
      const result = await startLarkAuthorization();
      if ("alreadyAuthorized" in result) {
        setLarkStatus(result.status);
        setAuthStart(null);
        return;
      }
      setAuthStart(result);
    } catch (authorizationError) {
      setLarkError(
        authorizationError instanceof Error
          ? authorizationError.message
          : "无法发起飞书授权",
      );
    } finally {
      setLarkLoading(false);
    }
  }, []);

  const finishAuthorization = useCallback(async () => {
    if (authFinishingRef.current) {
      return;
    }
    authFinishingRef.current = true;
    setAuthFinishing(true);
    try {
      const status = await finishLarkAuthorization();
      const discovery =
        status.miraMissingScopes.length === 0
          ? await discoverMira()
          : null;
      status.miraBot = discovery?.selected ?? null;
      setLarkStatus(status);
      setLarkError("");
      setAuthStart(null);
    } catch (authorizationError) {
      const message =
        authorizationError instanceof Error
          ? authorizationError.message
          : "飞书授权尚未完成";
      if (/授权码已失效|device_code is invalid/i.test(message)) {
        setAuthStart(null);
        await beginAuthorization();
        setLarkError("旧授权码已失效，已生成新的二维码，请重新扫码");
      } else {
        setLarkError(message);
      }
    } finally {
      authFinishingRef.current = false;
      setAuthFinishing(false);
    }
  }, [beginAuthorization]);

  const changeCaseCollection = useCallback((enabled: boolean) => {
    setCollectRevisionCases(enabled);
    window.localStorage.setItem(
      CASE_COLLECTION_STORAGE_KEY,
      enabled ? "1" : "0",
    );
  }, []);

  const closeTraeConfig = useCallback(() => {
    setTraeConfig(null);
    void refreshTraeConnection();
  }, [refreshTraeConnection]);

  const closeAuthorization = useCallback(() => {
    setAuthStart(null);
  }, []);

  return {
    traeStatus,
    traeLoading,
    traeError,
    traeConfig,
    larkStatus,
    larkLoading,
    larkError,
    authStart,
    authFinishing,
    collectRevisionCases,
    refreshTraeConnection,
    setupTrae,
    refreshLarkConnection,
    beginAuthorization,
    finishAuthorization,
    changeCaseCollection,
    closeTraeConfig,
    closeAuthorization,
  };
}
