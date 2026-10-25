export interface GpuSettings {
  id: number;
  name: string;
  pciBus: string;
  cclk: number;
  mclk: number;
  pl: number;
  fan: string;
  kernel: number;
}

export interface RigConfig {
  miningActive: boolean;
  minerDir: string;
  logFilePath: string;
  walletAddress: string;
  workerName: string;
  primaryPool: string;
  backupPool: string;
  apiPort: number;
  agentBridgePort: number;
  gpus: [GpuSettings, GpuSettings];
}

export interface GitHubSyncConfig {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  isPrivate: boolean;
  token: string;
  pullIntervalMin: number;
  autoApplyRemoteConfig: boolean;
  autoSelfUpdateAgent: boolean;
}

export interface WatchdogPolicy {
  checkIntervalSec: number;
  minHashrateMHs: number;
  zeroHashrateRestartSec: number;
  maxTempC: number;
  emergencyPlWatts: number;
  autoBypassVpnTun: boolean;
  fixHostsFakeIp: boolean;
  autoElevateAdmin: boolean;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  github: GitHubSyncConfig;
}

export interface GpuLiveMetrics {
  id: number;
  name: string;
  hashrateMHs: number;
  acceptedShares: number;
  rejectedShares: number;
  tempC: number;
  fanPercent: number;
  powerWatts: number;
  efficiencyHW: number;
  cclkMHz: number;
  mclkMHz: number;
  status: 'nominal' | 'warning' | 'critical' | 'offline';
}

export interface WatchdogEvent {
  id: string;
  timestamp: string;
  category: 'VPN_BYPASS' | 'PROCESS' | 'THERMAL' | 'TELEGRAM' | 'OC_PROFILE' | 'GITHUB_OTA';
  severity: 'info' | 'warning' | 'error';
  message: string;
  actionTaken: string;
}

export interface LogDiagnosticItem {
  severity: 'error' | 'warning' | 'ok';
  title: string;
  detail: string;
  fixCommand: string;
}
