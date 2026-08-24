export interface MiraBotInfo {
  openId: string;
  name: string;
  description: string;
  chatId: string;
}

export interface LarkStatus {
  cliAvailable: boolean;
  authorized: boolean;
  identity: string;
  userName: string;
  openId: string;
  userStatus: string;
  missingScopes: string[];
  miraMissingScopes: string[];
  baseMissingScopes: string[];
  caseLibraryReady: boolean;
  miraBot: MiraBotInfo | null;
}

export interface MiraDiscovery {
  selected: MiraBotInfo | null;
  candidates: MiraBotInfo[];
}

export interface LarkAuthChallenge {
  verificationUrl: string;
  qrDataUrl: string;
  expiresAt: number;
  scopes: string[];
}

export type LarkAuthStart =
  | LarkAuthChallenge
  | {
      alreadyAuthorized: true;
      status: LarkStatus;
    };

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    missing_scopes?: string[];
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("本地飞书通信服务未启动");
  }
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.ok || body.data === undefined) {
    throw new Error(
      body?.error?.message ||
        `本地飞书通信失败（HTTP ${response.status}）`,
    );
  }
  return body.data;
}

export function getLarkStatus(): Promise<LarkStatus> {
  return api<LarkStatus>("/api/lark/status");
}

export function discoverMira(): Promise<MiraDiscovery> {
  return api<MiraDiscovery>("/api/lark/mira/discover");
}

export function startLarkAuthorization(): Promise<LarkAuthStart> {
  return api<LarkAuthStart>("/api/lark/auth/start", {
    method: "POST",
  });
}

export function finishLarkAuthorization(): Promise<LarkStatus> {
  return api<LarkStatus>("/api/lark/auth/finish", {
    method: "POST",
  });
}
