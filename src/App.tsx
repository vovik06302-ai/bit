import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Download,
  Copy,
  Check,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Cpu,
  AlertTriangle,
  FileText,
  Play,
  Square,
  Wallet,
  Lock,
  Edit3,
  CheckCircle2,
  XCircle,
  Activity,
  Flame,
} from 'lucide-react';
import {
  RigConfig,
  WatchdogPolicy,
  GpuLiveMetrics,
  PoolLiveStatus,
  WatchdogEvent,
} from './types/rig';
import {
  validatePearlWallet,
  DEFAULT_PEARL_WALLET,
  buildOneZeroMinerCommand,
  buildRemoteRigConfigJson,
  generateWatchdogBatScript,
  generateInnoSetupScript,
  generateGitHubWorkflowYaml,
  analyzeMinerLog,
} from './utils/scriptGenerator';
import {
  createEmptyGpuMetrics,
  runAllScenarioChecks,
} from './utils/scenarioVerifier';
import { SpeedometerGauge } from './components/SpeedometerGauge';

type ActiveTab = 'telemetry' | 'overclock' | 'diagnostics' | 'files';
type PreviewFileType = 'bat' | 'iss' | 'workflow' | 'json';

const STORAGE_CONFIG_KEY = 'pearl_rig_config_v3';
const STORAGE_POLICY_KEY = 'pearl_watchdog_policy_v3';
const STORAGE_WALLET_KEY = 'pearl_saved_public_wallet_v3';

// Диапазон ползунка мощности майнинга (Power Limit): RTX 4070 Ti TGP 285 Вт,
// безопасный профиль майнинга — от аварийного минимума до заводского лимита.
export const MINING_PL_MIN = 100;
export const MINING_PL_MAX = 285;

// Огненный градиент для шкал и ползунков мощности/температуры
const FIRE_GRADIENT_CSS =
  'linear-gradient(90deg, #FDE047 0%, #FACC15 22%, #FB923C 48%, #F97316 68%, #EF4444 100%)';

function fireFillStyle(ratioPct: number): React.CSSProperties {
  const r = Math.min(Math.max(ratioPct, 0), 100);
  return {
    backgroundImage: `${FIRE_GRADIENT_CSS}, linear-gradient(#1E293B, #1E293B)`,
    backgroundSize: `${r}% 100%, ${100 - r}% 100%`,
    backgroundPosition: 'left center, right center',
    backgroundRepeat: 'no-repeat',
  };
}

function fireThumbStyle(value: number, min: number, max: number): React.CSSProperties {
  const pct = ((Math.min(Math.max(value, min), max) - min) / Math.max(0.0001, max - min)) * 100;
  return { backgroundImage: fireFillStyle(pct) };
}

const FIRE_SLIDER_CSS = `
input.fire-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 12px;
  border-radius: 9999px;
  outline: none;
  cursor: pointer;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.6);
}
input.fire-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #FFFFFF 0%, #FDBA74 45%, #EA580C 100%);
  border: 2px solid #FFEDD5;
  box-shadow: 0 0 10px rgba(249, 115, 22, 0.9), 0 2px 6px rgba(0,0,0,0.6);
  cursor: grab;
}
input.fire-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #FFFFFF 0%, #FDBA74 45%, #EA580C 100%);
  border: 2px solid #FFEDD5;
  box-shadow: 0 0 10px rgba(249, 115, 22, 0.9), 0 2px 6px rgba(0,0,0,0.6);
  cursor: grab;
}
`;

function formatMetric(value: number | string | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || value === '') {
    return 'нет данных';
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return 'нет данных';
  }
  return `${value}${suffix}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('telemetry');
  const [previewFile, setPreviewFile] = useState<PreviewFileType>('bat');

  // Загрузка локально сохранённого публичного адреса кошелька (по умолчанию — адрес Pearl владельца рига)
  const initialSavedWallet = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_WALLET_KEY);
      if (!raw) return DEFAULT_PEARL_WALLET;
      const parsed = JSON.parse(raw);
      const addr = typeof parsed?.address === 'string' ? parsed.address.trim() : '';
      const check = validatePearlWallet(addr);
      return check.valid ? addr : DEFAULT_PEARL_WALLET;
    } catch {
      return DEFAULT_PEARL_WALLET;
    }
  }, []);

  const [rigConfig, setRigConfig] = useState<RigConfig>(() => {
    const defaults: RigConfig = {
      miningActive: false, // НЕ запускаем майнер при установке или первом открытии
      userStoppedManually: false,
      minerDir:
        'C:\\Users\\User\\Documents\\Codex\\2026-10-25\\new-chat\\outputs\\Pearl\\miner\\onezerominer-win64-1.8.3',
      logFilePath:
        'C:\\Users\\User\\Documents\\Codex\\2026-10-25\\new-chat\\work\\pearl-miner.log',
      walletAddress: initialSavedWallet,
      walletSaved: Boolean(initialSavedWallet),
      workerName: 'dual4070ti',
      primaryPool: 'stratum+tcp://prl.kryptex.network:7048',
      backupPool: 'stratum+tcp://prl-eu.kryptex.network:7048',
      apiPort: 3001,
      agentBridgePort: 3002,
      gpus: [
        {
          id: 0,
          name: 'NVIDIA GeForce RTX 4070 Ti',
          pciBus: '00:01:00',
          cclk: 2400,
          mclk: 810,
          pl: 150,
          fan: '65',
          kernel: 2,
        },
        {
          id: 1,
          name: 'NVIDIA GeForce RTX 4070 Ti',
          pciBus: '00:05:00',
          cclk: 2400,
          mclk: 810,
          pl: 150,
          fan: '*',
          kernel: 2,
        },
      ],
    };

    try {
      const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      return {
        ...defaults,
        minerDir: parsed.minerDir || defaults.minerDir,
        logFilePath: parsed.logFilePath || defaults.logFilePath,
        workerName: parsed.workerName || defaults.workerName,
        primaryPool: parsed.primaryPool || defaults.primaryPool,
        backupPool: parsed.backupPool || defaults.backupPool,
        apiPort: Number(parsed.apiPort) || 3001,
        agentBridgePort: Number(parsed.agentBridgePort) || 3002,
        walletAddress: initialSavedWallet,
        walletSaved: Boolean(initialSavedWallet),
        miningActive: false, // Никогда не включаем автозапуск при открытии
        userStoppedManually: Boolean(parsed.userStoppedManually),
        gpus: Array.isArray(parsed.gpus) && parsed.gpus.length === 2 ? parsed.gpus : defaults.gpus,
      };
    } catch {
      return defaults;
    }
  });

  const [policy, setPolicy] = useState<WatchdogPolicy>(() => {
    const defaults: WatchdogPolicy = {
      checkIntervalSec: 15,
      minHashrateMHs: 100,
      zeroHashrateRestartSec: 90,
      maxRestartAttempts: 3,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
      telegramEnabled: false,
      telegramBotToken: '',
      telegramChatId: '',
    };
    try {
      const saved = localStorage.getItem(STORAGE_POLICY_KEY);
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      return {
        ...defaults,
        ...parsed,
        maxTempC: Number(parsed.maxTempC) || 85,
        criticalStopTempC: Number(parsed.criticalStopTempC) || 88,
        emergencyPlWatts: Number(parsed.emergencyPlWatts) || 125,
        maxRestartAttempts: Number(parsed.maxRestartAttempts) || 3,
      };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(rigConfig));
  }, [rigConfig]);

  useEffect(() => {
    localStorage.setItem(STORAGE_POLICY_KEY, JSON.stringify(policy));
  }, [policy]);

  // Состояние ввода и подтверждения адреса кошелька
  const [draftWallet, setDraftWallet] = useState<string>(rigConfig.walletAddress);
  const [isEditingWallet, setIsEditingWallet] = useState<boolean>(!rigConfig.walletSaved);
  const [confirmingEditUnlock, setConfirmingEditUnlock] = useState<boolean>(false);
  const [walletStatusBanner, setWalletStatusBanner] = useState<{
    type: 'ok' | 'err' | 'info';
    text: string;
  } | null>(null);

  // Реальные метрики телеметрии (никаких выдуманных или случайных значений)
  const [gpuMetrics, setGpuMetrics] = useState<[GpuLiveMetrics, GpuLiveMetrics]>(() =>
    createEmptyGpuMetrics()
  );

  const [poolStatus, setPoolStatus] = useState<PoolLiveStatus>({
    connected: null,
    poolUrl: null,
    pingMs: null,
    uptimeSec: null,
    apiAvailable: false,
    nvmlAvailable: false,
    minerProcessRunning: null,
    minerPid: null,
    reconnectStage: 'idle',
    restartAttempts: 0,
    sharesAtRestart: 0,
    recoveryConfirmed: false,
    lastError: null,
  });

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [rawLogInput, setRawLogInput] = useState<string>('');
  const [events, setEvents] = useState<WatchdogEvent[]>([
    {
      id: 'init-1',
      timestamp: new Date().toTimeString().slice(0, 8),
      category: 'PROCESS',
      severity: 'info',
      message: 'Панель открыта. Автозапуск майнера отключён.',
      actionTaken: rigConfig.walletSaved
        ? 'Загружен сохранённый публичный адрес кошелька. Ожидание команды пользователя «Запустить».'
        : 'Требуется ввести публичный адрес кошелька Pearl, проверить формат и нажать «Сохранить локально».',
    },
  ]);

  const addEvent = useCallback(
    (
      category: WatchdogEvent['category'],
      severity: WatchdogEvent['severity'],
      message: string,
      actionTaken: string
    ) => {
      const now = new Date().toTimeString().slice(0, 8);
      setEvents((prev) => [
        {
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          category,
          severity,
          message,
          actionTaken,
        },
        ...prev.slice(0, 24),
      ]);
    },
    []
  );

  // Валидация сохранённого и чернового адреса
  const savedWalletValidation = useMemo(
    () => validatePearlWallet(rigConfig.walletAddress),
    [rigConfig.walletAddress]
  );

  const draftWalletValidation = useMemo(
    () => validatePearlWallet(draftWallet),
    [draftWallet]
  );

  const canStartMining =
    rigConfig.walletSaved && savedWalletValidation.valid && !isEditingWallet;

  // Опрос реальной телеметрии:
  // 1) Локальный агент 127.0.0.1:3002/telemetry (отдаёт данные API OneZeroMiner :3001 + nvidia-smi)
  // 2) Прямой опрос API OneZeroMiner 127.0.0.1:3001 (если запущен только майнер)
  // Если недоступно — выставляет null («нет данных»)
  const pollRealTelemetry = useCallback(async () => {
    let bridgeOk = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${rigConfig.agentBridgePort}/telemetry`, {
        method: 'GET',
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        bridgeOk = true;
        const g0 = Array.isArray(data.gpus) ? data.gpus[0] : null;
        const g1 = Array.isArray(data.gpus) ? data.gpus[1] : null;

        setPoolStatus({
          connected: typeof data.poolConnected === 'boolean' ? data.poolConnected : null,
          poolUrl: data.poolUrl || null,
          pingMs: typeof data.pingMs === 'number' ? data.pingMs : null,
          uptimeSec: typeof data.uptimeSec === 'number' ? data.uptimeSec : null,
          apiAvailable: Boolean(data.apiAvailable),
          nvmlAvailable: Boolean(data.nvmlAvailable),
          minerProcessRunning:
            typeof data.minerProcessRunning === 'boolean' ? data.minerProcessRunning : null,
          minerPid: typeof data.minerPid === 'number' ? data.minerPid : null,
          reconnectStage: data.reconnectStage || 'idle',
          restartAttempts: Number(data.restartAttempts) || 0,
          sharesAtRestart: Number(data.sharesAtRestart) || 0,
          recoveryConfirmed: Boolean(data.recoveryConfirmed),
          lastError: data.lastError || null,
        });

        // Если обнаружен уже работающий OneZeroMiner при открытии — не останавливаем его
        if (data.minerProcessRunning === true && !rigConfig.userStoppedManually) {
          setRigConfig((prev) =>
            prev.miningActive ? prev : { ...prev, miningActive: true }
          );
        }

        setGpuMetrics([
          {
            id: 0,
            name: 'NVIDIA GeForce RTX 4070 Ti',
            hashrateMHs: typeof g0?.hashrateMHs === 'number' ? g0.hashrateMHs : null,
            acceptedShares:
              typeof data.acceptedShares === 'number' ? data.acceptedShares : null,
            rejectedShares:
              typeof data.rejectedShares === 'number' ? data.rejectedShares : null,
            staleShares: null,
            lastShareSec: null,
            tempC: typeof g0?.tempC === 'number' ? g0.tempC : null,
            hotspotTempC: typeof g0?.hotspotTempC === 'number' ? g0.hotspotTempC : null,
            vramTempC: typeof g0?.vramTempC === 'number' ? g0.vramTempC : null,
            fanPercent: typeof g0?.fanPercent === 'number' ? g0.fanPercent : null,
            fanRpm: typeof g0?.fanRpm === 'number' ? g0.fanRpm : null,
            powerWatts: typeof g0?.powerWatts === 'number' ? g0.powerWatts : null,
            efficiencyHW:
              typeof g0?.hashrateMHs === 'number' &&
              typeof g0?.powerWatts === 'number' &&
              g0.powerWatts > 0
                ? Number((g0.hashrateMHs / g0.powerWatts).toFixed(2))
                : null,
            cclkMHz: typeof g0?.cclkMHz === 'number' ? g0.cclkMHz : null,
            mclkMHz: typeof g0?.mclkMHz === 'number' ? g0.mclkMHz : null,
            voltageMv: null,
            vramUsedMb: null,
            pState: null,
            pcieLink: null,
            status:
              typeof g0?.tempC === 'number' && g0.tempC >= policy.maxTempC
                ? 'critical'
                : typeof g0?.hashrateMHs === 'number' || typeof g0?.tempC === 'number'
                ? 'nominal'
                : 'no_data',
          },
          {
            id: 1,
            name: 'NVIDIA GeForce RTX 4070 Ti',
            hashrateMHs: typeof g1?.hashrateMHs === 'number' ? g1.hashrateMHs : null,
            acceptedShares: null,
            rejectedShares: null,
            staleShares: null,
            lastShareSec: null,
            tempC: typeof g1?.tempC === 'number' ? g1.tempC : null,
            hotspotTempC: typeof g1?.hotspotTempC === 'number' ? g1.hotspotTempC : null,
            vramTempC: typeof g1?.vramTempC === 'number' ? g1.vramTempC : null,
            fanPercent: typeof g1?.fanPercent === 'number' ? g1.fanPercent : null,
            fanRpm: typeof g1?.fanRpm === 'number' ? g1.fanRpm : null,
            powerWatts: typeof g1?.powerWatts === 'number' ? g1.powerWatts : null,
            efficiencyHW:
              typeof g1?.hashrateMHs === 'number' &&
              typeof g1?.powerWatts === 'number' &&
              g1.powerWatts > 0
                ? Number((g1.hashrateMHs / g1.powerWatts).toFixed(2))
                : null,
            cclkMHz: typeof g1?.cclkMHz === 'number' ? g1.cclkMHz : null,
            mclkMHz: typeof g1?.mclkMHz === 'number' ? g1.mclkMHz : null,
            voltageMv: null,
            vramUsedMb: null,
            pState: null,
            pcieLink: null,
            status:
              typeof g1?.tempC === 'number' && g1.tempC >= policy.maxTempC
                ? 'critical'
                : typeof g1?.hashrateMHs === 'number' || typeof g1?.tempC === 'number'
                ? 'nominal'
                : 'no_data',
          },
        ]);
        return;
      }
    } catch {
      bridgeOk = false;
    }

    // Если мост 3002 не запущен, пробуем напрямую опросить API OneZeroMiner 127.0.0.1:3001
    if (!bridgeOk) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(`http://127.0.0.1:${rigConfig.apiPort}/`, {
          method: 'GET',
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
          const apiData = await res.json();
          const algo = Array.isArray(apiData?.algos) ? apiData.algos[0] : null;
          const rawRates = Array.isArray(algo?.hashrates) ? algo.hashrates : [];
          const h0Raw = typeof rawRates[0] === 'number' ? rawRates[0] : null;
          const h1Raw = typeof rawRates[1] === 'number' ? rawRates[1] : null;
          const h0 =
            h0Raw !== null
              ? h0Raw > 10000
                ? Number((h0Raw / 1_000_000).toFixed(2))
                : Number(h0Raw.toFixed(2))
              : null;
          const h1 =
            h1Raw !== null
              ? h1Raw > 10000
                ? Number((h1Raw / 1_000_000).toFixed(2))
                : Number(h1Raw.toFixed(2))
              : null;

          const acc =
            typeof algo?.total_accepted_shares === 'number'
              ? algo.total_accepted_shares
              : null;
          const rej =
            typeof algo?.total_rejected_shares === 'number'
              ? algo.total_rejected_shares
              : null;
          const connected =
            typeof algo?.pool_connected === 'boolean'
              ? algo.pool_connected
              : h0 !== null || h1 !== null
              ? (h0 || 0) + (h1 || 0) > 0
              : null;

          setPoolStatus((prev) => ({
            ...prev,
            connected,
            poolUrl: algo?.pool || rigConfig.primaryPool,
            uptimeSec:
              typeof apiData?.uptime_seconds === 'number' ? apiData.uptime_seconds : null,
            apiAvailable: true,
            nvmlAvailable: false,
            minerProcessRunning: true,
            lastError: null,
          }));

          setGpuMetrics([
            {
              ...createEmptyGpuMetrics()[0],
              hashrateMHs: h0,
              acceptedShares: acc,
              rejectedShares: rej,
              status: h0 !== null ? 'nominal' : 'no_data',
            },
            {
              ...createEmptyGpuMetrics()[1],
              hashrateMHs: h1,
              status: h1 !== null ? 'nominal' : 'no_data',
            },
          ]);
          return;
        }
      } catch {
        // API 3001 также недоступен
      }

      // Оба источника недоступны — строго показываем «нет данных» (null)
      setPoolStatus((prev) => ({
        ...prev,
        connected: null,
        poolUrl: null,
        pingMs: null,
        uptimeSec: null,
        apiAvailable: false,
        nvmlAvailable: false,
        minerProcessRunning: null,
        minerPid: null,
      }));
      setGpuMetrics(createEmptyGpuMetrics());
    }
  }, [rigConfig.agentBridgePort, rigConfig.apiPort, rigConfig.primaryPool, rigConfig.userStoppedManually, policy.maxTempC]);

  useEffect(() => {
    pollRealTelemetry();
    const interval = setInterval(pollRealTelemetry, 5000);
    return () => clearInterval(interval);
  }, [pollRealTelemetry]);

  // Вычисляемые агрегаты (только при наличии реальных данных, иначе null)
  const totalHashrate: number | null = useMemo(() => {
    const h0 = gpuMetrics[0].hashrateMHs;
    const h1 = gpuMetrics[1].hashrateMHs;
    if (h0 === null && h1 === null) return null;
    return Number(((h0 || 0) + (h1 || 0)).toFixed(2));
  }, [gpuMetrics]);

  const totalPowerWatts: number | null = useMemo(() => {
    const p0 = gpuMetrics[0].powerWatts;
    const p1 = gpuMetrics[1].powerWatts;
    if (p0 === null && p1 === null) return null;
    return Number(((p0 || 0) + (p1 || 0)).toFixed(1));
  }, [gpuMetrics]);

  const maxGpuTempC: number | null = useMemo(() => {
    const t0 = gpuMetrics[0].tempC;
    const t1 = gpuMetrics[1].tempC;
    if (t0 === null && t1 === null) return null;
    if (t0 !== null && t1 !== null) return Math.max(t0, t1);
    return t0 !== null ? t0 : t1;
  }, [gpuMetrics]);

  const totalAcceptedShares: number | null = useMemo(() => {
    const a0 = gpuMetrics[0].acceptedShares;
    const a1 = gpuMetrics[1].acceptedShares;
    if (a0 === null && a1 === null) return null;
    return (a0 || 0) + (a1 || 0);
  }, [gpuMetrics]);

  const totalRejectedShares: number | null = useMemo(() => {
    const r0 = gpuMetrics[0].rejectedShares;
    const r1 = gpuMetrics[1].rejectedShares;
    if (r0 === null && r1 === null) return null;
    return (r0 || 0) + (r1 || 0);
  }, [gpuMetrics]);

  // Обработчики для кошелька
  const handleCheckDraftWallet = () => {
    const res = validatePearlWallet(draftWallet);
    setWalletStatusBanner({
      type: res.valid ? 'info' : 'err',
      text: res.valid
        ? `${res.message} Нажмите «Сохранить локально», чтобы зафиксировать адрес перед запуском.`
        : res.message,
    });
  };

  const handleSaveWalletLocally = () => {
    const clean = draftWallet.trim();
    const res = validatePearlWallet(clean);
    if (!res.valid) {
      setWalletStatusBanner({
        type: 'err',
        text: `Сохранение отклонено: ${res.message}`,
      });
      addEvent('WALLET', 'error', 'Попытка сохранения неверного адреса кошелька отклонена.', res.message);
      return;
    }

    localStorage.setItem(
      STORAGE_WALLET_KEY,
      JSON.stringify({ address: clean, savedAt: new Date().toISOString() })
    );

    setRigConfig((prev) => ({
      ...prev,
      walletAddress: clean,
      walletSaved: true,
    }));
    setDraftWallet(clean);
    setIsEditingWallet(false);
    setConfirmingEditUnlock(false);
    setWalletStatusBanner({
      type: 'ok',
      text: `Публичный адрес кошелька сохранён локально (${clean.length} симв.). Кнопка «Запустить» разблокирована. Майнер ждёт вашей отдельной команды.`,
    });

    addEvent(
      'WALLET',
      'info',
      `Публичный адрес кошелька Pearl проверен и сохранён локально (${clean.length} симв.).`,
      `Адрес зафиксирован для локального запуска (-w ${clean}). Автозапуск не выполнялся.`
    );
  };

  const handleConfirmUnlockWalletEdit = () => {
    setDraftWallet(rigConfig.walletAddress);
    setIsEditingWallet(true);
    setConfirmingEditUnlock(false);
    setWalletStatusBanner({
      type: 'info',
      text: 'Режим изменения адреса открыт. Пока новый адрес не сохранён локально, запуск майнинга заблокирован.',
    });
  };

  const handleCancelWalletEdit = () => {
    if (rigConfig.walletSaved && savedWalletValidation.valid) {
      setDraftWallet(rigConfig.walletAddress);
      setIsEditingWallet(false);
      setConfirmingEditUnlock(false);
      setWalletStatusBanner(null);
    }
  };

  // Кнопки «Запустить» и «Стоп»
  const handleStartMining = () => {
    if (!canStartMining) {
      setWalletStatusBanner({
        type: 'err',
        text: 'Запуск заблокирован: сначала введите корректный публичный адрес кошелька Pearl и нажмите «Сохранить локально».',
      });
      addEvent(
        'SECURITY',
        'error',
        'Запуск майнинга заблокирован из-за отсутствия сохранённого валидного адреса кошелька.',
        savedWalletValidation.message
      );
      return;
    }

    if (poolStatus.minerProcessRunning) {
      setRigConfig((prev) => ({
        ...prev,
        miningActive: true,
        userStoppedManually: false,
      }));
      addEvent(
        'PROCESS',
        'info',
        'Процесс OneZeroMiner уже запущен на ПК. Дублирующий экземпляр не запускается.',
        `Мониторинг подключён к работающему процессу (PID ${poolStatus.minerPid ?? 'активен'}).`
      );
      return;
    }

    setRigConfig((prev) => ({
      ...prev,
      miningActive: true,
      userStoppedManually: false,
    }));

    addEvent(
      'PROCESS',
      'info',
      'Команда «Запустить» зафиксирована в локальном профиле.',
      `В соответствии с защитой порта 3002 браузер не запускает процессы удалённо через GET. Для физического старта процесса на ПК нажмите «▶ ЗАПУСТИТЬ» в локальном окне pearl_watchdog_agent.bat или выполните сформированную строку запуска.`
    );
    pollRealTelemetry();
  };

  const handleStopMining = () => {
    setRigConfig((prev) => ({
      ...prev,
      miningActive: false,
      userStoppedManually: true,
    }));

    addEvent(
      'PROCESS',
      'warning',
      'Нажата кнопка «Стоп»: майнинг переведён в состояние намеренной остановки.',
      'Флаг userStoppedManually=true активен. Watchdog не будет перезапускать майнер автоматически без вашей команды «Запустить».'
    );
  };

  const handleResetDefaultOcProfile = () => {
    setRigConfig((prev) => ({
      ...prev,
      gpus: [
        {
          ...prev.gpus[0],
          cclk: 2400,
          mclk: 810,
          pl: 150,
          fan: '65',
          kernel: 2,
        },
        {
          ...prev.gpus[1],
          cclk: 2400,
          mclk: 810,
          pl: 150,
          fan: '*',
          kernel: 2,
        },
      ],
    }));
    addEvent(
      'OC_PROFILE',
      'info',
      'Восстановлен штатный профиль для двух RTX 4070 Ti (без повышения напряжения).',
      'PL: 150 Вт | Память: 810 МГц | Ядро: 2400 МГц | Kernel: 2 | Вентилятор GPU 0: 65%, GPU 1: Авто (*)'
    );
  };

  const generatedBatContent = useMemo(
    () => generateWatchdogBatScript(rigConfig, policy),
    [rigConfig, policy]
  );

  const generatedIssContent = useMemo(
    () => generateInnoSetupScript(rigConfig),
    [rigConfig]
  );

  const generatedWorkflowContent = useMemo(
    () => generateGitHubWorkflowYaml(),
    []
  );

  const generatedRemoteJson = useMemo(
    () => buildRemoteRigConfigJson(rigConfig, policy),
    [rigConfig, policy]
  );

  const activePreviewContent = useMemo(() => {
    if (previewFile === 'iss') return generatedIssContent;
    if (previewFile === 'workflow') return generatedWorkflowContent;
    if (previewFile === 'json') return generatedRemoteJson;
    return generatedBatContent;
  }, [previewFile, generatedBatContent, generatedIssContent, generatedWorkflowContent, generatedRemoteJson]);

  const generatedOneLineCmd = useMemo(
    () => buildOneZeroMinerCommand(rigConfig),
    [rigConfig]
  );

  const logDiagnostics = useMemo(
    () => analyzeMinerLog(rawLogInput, rigConfig.walletAddress),
    [rawLogInput, rigConfig.walletAddress]
  );

  const scenarioResults = useMemo(() => runAllScenarioChecks(), []);

  const handleDownloadBat = () => {
    const crlfContent = generatedBatContent.replace(/\r?\n/g, '\r\n');
    const blob = new Blob([crlfContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pearl_watchdog_agent.bat';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addEvent(
      'PROCESS',
      'info',
      'Скачан локальный агент pearl_watchdog_agent.bat v3.0 (без автозапуска и без симуляции).',
      'При открытии на ПК агент сначала проверит сохранённый адрес кошелька и будет ждать нажатия «▶ ЗАПУСТИТЬ».'
    );
  };

  const handleDownloadActiveFile = () => {
    const filenameMap: Record<PreviewFileType, string> = {
      bat: 'pearl_watchdog_agent.bat',
      iss: 'installer.iss',
      workflow: 'build-installer.yml',
      json: 'rig-config.json',
    };
    const outText =
      previewFile === 'bat' || previewFile === 'iss'
        ? activePreviewContent.replace(/\r?\n/g, '\r\n')
        : activePreviewContent;
    const blob = new Blob([outText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameMap[previewFile];
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyPreviewCode = () => {
    navigator.clipboard.writeText(activePreviewContent);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(generatedOneLineCmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <style>{FIRE_SLIDER_CSS}</style>
      {/* Верхняя панель */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-800 bg-[#0E1420]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-slate-100 font-display">
            Pearl Rig Control
          </span>
          <span className="px-2.5 py-0.5 text-[11px] font-mono rounded bg-slate-800 text-slate-300 border border-slate-700">
            2× RTX 4070 Ti · Без симуляции
          </span>
        </div>

        <nav className="flex flex-wrap items-center gap-5 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('telemetry')}
            className={`hover:text-slate-100 transition-colors pb-0.5 cursor-pointer ${
              activeTab === 'telemetry' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            Кошелёк, Запуск и Телеметрия
          </button>
          <button
            onClick={() => setActiveTab('overclock')}
            className={`hover:text-slate-100 transition-colors pb-0.5 cursor-pointer ${
              activeTab === 'overclock' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            Профиль GPU (150W / 2400 / 810)
          </button>
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`hover:text-slate-100 transition-colors pb-0.5 cursor-pointer ${
              activeTab === 'diagnostics' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            Проверка сценариев (9/9) и Логи
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`hover:text-slate-100 transition-colors pb-0.5 cursor-pointer ${
              activeTab === 'files' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            Исходники для ПК (.BAT / .ISS / .JSON)
          </button>
        </nav>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleDownloadBat}
            className="px-3.5 py-2 text-xs font-bold text-cyan-300 bg-cyan-500/15 border border-cyan-500/40 rounded-lg hover:bg-cyan-500/25 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Скачать pearl_watchdog_agent.bat</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row max-w-[1440px] w-full mx-auto">
        {/* Боковая колонка реального статуса */}
        <aside className="w-full lg:w-[270px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800 bg-[#0E1420]/60 p-5 flex flex-col justify-between gap-6">
          <div className="space-y-5">
            <div>
              <div className="text-xs text-slate-400">Воркер / Риг</div>
              <div className="mt-1 text-base font-semibold text-slate-100 font-mono">
                {rigConfig.workerName}
              </div>
              <div className="mt-1 text-xs font-mono">
                {poolStatus.minerProcessRunning ? (
                  <span className="text-emerald-400">
                    OneZeroMiner работает (PID {poolStatus.minerPid ?? '?'})
                  </span>
                ) : rigConfig.userStoppedManually ? (
                  <span className="text-amber-400">Намеренно остановлен (Стоп)</span>
                ) : (
                  <span className="text-slate-400">Ожидание команды запуска</span>
                )}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-200">Источники реальных данных</div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">API :3001 (OneZeroMiner)</span>
                <span
                  className={`font-mono ${
                    poolStatus.apiAvailable ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {poolStatus.apiAvailable ? 'Доступен' : 'нет данных'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">nvidia-smi (GPU)</span>
                <span
                  className={`font-mono ${
                    poolStatus.nvmlAvailable ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {poolStatus.nvmlAvailable ? 'Доступен' : 'нет данных'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Пул Kryptex</span>
                <span
                  className={`font-mono ${
                    poolStatus.connected === true
                      ? 'text-emerald-400'
                      : poolStatus.connected === false
                      ? 'text-red-400'
                      : 'text-slate-500'
                  }`}
                >
                  {poolStatus.connected === true
                    ? 'Connected'
                    : poolStatus.connected === false
                    ? 'Disconnected'
                    : 'нет данных'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Кошелёк сохранён</span>
                <span
                  className={`font-mono ${
                    canStartMining ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {canStartMining ? 'Да (63 симв.)' : 'Требуется ввод'}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5 text-xs">
              <div className="font-semibold text-slate-200">Фиксированный профиль карт</div>
              <div className="text-slate-400 font-mono text-[11px] space-y-1">
                <div>GPU 0: 150W · 2400/810 MHz · K2 · Fan 65%</div>
                <div>GPU 1: 150W · 2400/810 MHz · K2 · Fan Авто</div>
                <div>Защита: &ge; {policy.maxTempC} °C (PL {policy.emergencyPlWatts}W / Стоп)</div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>Защита локального интерфейса</span>
            </div>
            <p className="leading-relaxed">
              Порт 3002 отдаёт только чтение телеметрии (<code className="font-mono">/telemetry</code>).
              Команды через GET, открытый CORS (*) и удалённая смена кошелька отключены.
            </p>
          </div>
        </aside>

        {/* Основная рабочая область */}
        <main className="flex-1 p-6 lg:p-8 space-y-7 overflow-y-auto">
          {/* ГЛАВНОЕ ТРЕБОВАНИЕ: Блок публичного адреса кошелька Pearl ДО первого запуска */}
          <section className="p-6 rounded-2xl border border-emerald-500/40 bg-[#111827] shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    Публичный адрес кошелька Pearl (обязателен до первого запуска)
                  </h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Укажите только публичный адрес кошелька Pearl (<code className="font-mono text-emerald-300">prl1p...</code> из 63 символов или <code className="font-mono text-emerald-300">prl1q...</code>).{' '}
                    <strong className="text-amber-300">
                      Никогда не вводите seed-фразу или приватный ключ!
                    </strong>{' '}
                    Адрес хранится только локально и не может быть изменён через GitHub.
                  </p>
                </div>
              </div>

              <span
                className={`px-3 py-1 rounded-full text-xs font-mono font-semibold shrink-0 ${
                  canStartMining
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                }`}
              >
                {canStartMining ? 'Адрес сохранён локально' : 'Запуск заблокирован до сохранения адреса'}
              </span>
            </div>

            {/* Режим отображения сохранённого адреса при повторных открытиях */}
            {!isEditingWallet && rigConfig.walletSaved && savedWalletValidation.valid ? (
              <div className="space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-xl bg-slate-950/90 border border-emerald-500/30">
                  <div className="space-y-1 min-w-0">
                    <div className="text-xs text-slate-400">
                      Сохранённый локально публичный адрес выплат Pearl ({rigConfig.walletAddress.length} симв.):
                    </div>
                    <div className="text-sm font-mono font-bold text-emerald-400 break-all">
                      {rigConfig.walletAddress}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!confirmingEditUnlock ? (
                      <button
                        onClick={() => setConfirmingEditUnlock(true)}
                        className="px-4 py-2 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Изменить</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 bg-slate-900 p-1.5 rounded-lg border border-amber-500/40">
                        <span className="text-xs text-amber-300 px-2">
                          Подтверждаете смену адреса?
                        </span>
                        <button
                          onClick={handleConfirmUnlockWalletEdit}
                          className="px-3 py-1 text-xs font-bold text-slate-950 bg-amber-400 rounded hover:bg-amber-300 cursor-pointer"
                        >
                          Да, изменить
                        </button>
                        <button
                          onClick={() => setConfirmingEditUnlock(false)}
                          className="px-2.5 py-1 text-xs text-slate-300 bg-slate-800 rounded hover:bg-slate-700 cursor-pointer"
                        >
                          Отмена
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Режим ввода, проверки формата и локального сохранения ДО первого запуска */
              <div className="space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                  <div className="lg:col-span-7 space-y-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Публичный адрес кошелька Pearl (Bech32m prl1p... — 63 символа)
                    </label>
                    <input
                      type="text"
                      value={draftWallet}
                      onChange={(e) => {
                        setDraftWallet(e.target.value);
                        setWalletStatusBanner(null);
                      }}
                      placeholder="prl1p... (вставьте полный 63-символьный публичный адрес)"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="lg:col-span-5 flex flex-wrap items-end gap-2">
                    <button
                      onClick={handleCheckDraftWallet}
                      className="px-3.5 py-2.5 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      Проверить формат
                    </button>

                    <button
                      onClick={handleSaveWalletLocally}
                      disabled={!draftWalletValidation.valid}
                      className={`px-4 py-2.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                        draftWalletValidation.valid
                          ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300 cursor-pointer'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      Сохранить локально
                    </button>

                    {rigConfig.walletSaved && savedWalletValidation.valid && (
                      <button
                        onClick={handleCancelWalletEdit}
                        className="px-3 py-2.5 text-xs text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 cursor-pointer"
                      >
                        Отмена
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className={`p-3 rounded-lg border text-xs font-mono flex items-center justify-between gap-3 ${
                    draftWalletValidation.valid
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  <span>{draftWalletValidation.message}</span>
                  <span className="shrink-0">
                    {draftWalletValidation.length} / {draftWalletValidation.expectedLength} симв.
                  </span>
                </div>
              </div>
            )}

            {walletStatusBanner && (
              <div
                className={`p-3 rounded-lg border text-xs font-mono ${
                  walletStatusBanner.type === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : walletStatusBanner.type === 'err'
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                }`}
              >
                {walletStatusBanner.text}
              </div>
            )}

            {/* Отдельные кнопки «Запустить» и «Стоп» */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleStartMining}
                  disabled={!canStartMining}
                  className={`px-6 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
                    canStartMining
                      ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300 cursor-pointer shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                      : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-4 h-4 fill-current" />
                  Запустить
                </button>

                <button
                  onClick={handleStopMining}
                  className="px-5 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-current" />
                  Стоп
                </button>

                <button
                  onClick={pollRealTelemetry}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                  Опросить API :3001 и nvidia-smi
                </button>
              </div>

              <div className="text-xs text-slate-400 font-mono">
                Пул: <span className="text-slate-200">{rigConfig.primaryPool}</span>
              </div>
            </div>
          </section>

          {activeTab === 'telemetry' && (
            <div className="space-y-7">
              {/* Баннер состояния источников данных */}
              {(!poolStatus.apiAvailable || !poolStatus.nvmlAvailable) && (
                <div className="p-4 rounded-xl border border-slate-700 bg-slate-900/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-100">
                        Режим честной телеметрии (генерация случайных показателей отключена)
                      </div>
                      <p className="text-slate-400">
                        {!poolStatus.apiAvailable &&
                          `API OneZeroMiner (http://127.0.0.1:${rigConfig.apiPort}) сейчас недоступен — хешрейт, шары и статус пула показывают «нет данных». `}
                        {!poolStatus.nvmlAvailable &&
                          `Локальный мост nvidia-smi (http://127.0.0.1:${rigConfig.agentBridgePort}/telemetry) сейчас недоступен — температуры, мощность и вентиляторы показывают «нет данных».`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={pollRealTelemetry}
                    className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 shrink-0 cursor-pointer"
                  >
                    Проверить снова
                  </button>
                </div>
              )}

              {/* 4 главных прибора (показывают реальные значения или «нет данных») */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <SpeedometerGauge
                  label="Суммарный хешрейт"
                  sublabel={`API 127.0.0.1:${rigConfig.apiPort}`}
                  value={totalHashrate}
                  min={0}
                  max={300}
                  unit="MH/s"
                  decimals={2}
                  accent="emerald"
                  extraInfo={[
                    { label: 'GPU #0', value: formatMetric(gpuMetrics[0].hashrateMHs, ' MH/s') },
                    { label: 'GPU #1', value: formatMetric(gpuMetrics[1].hashrateMHs, ' MH/s') },
                    { label: 'Принято шар', value: formatMetric(totalAcceptedShares) },
                    { label: 'Отклонено', value: formatMetric(totalRejectedShares) },
                  ]}
                />

                <SpeedometerGauge
                  label="Мощность видеокарт"
                  sublabel="Данные из nvidia-smi"
                  value={totalPowerWatts}
                  min={0}
                  max={350}
                  warningThreshold={305}
                  criticalThreshold={320}
                  unit="W (Ватт)"
                  decimals={1}
                  accent="cyan"
                  extraInfo={[
                    { label: 'GPU #0', value: formatMetric(gpuMetrics[0].powerWatts, ' W') },
                    { label: 'GPU #1', value: formatMetric(gpuMetrics[1].powerWatts, ' W') },
                    { label: 'Лимит PL', value: `${rigConfig.gpus[0].pl},${rigConfig.gpus[1].pl} W` },
                    { label: 'Аварийный PL', value: `${policy.emergencyPlWatts} W` },
                  ]}
                />

                <SpeedometerGauge
                  label="Температура GPU (Макс)"
                  sublabel={`Защита от перегрева: >= ${policy.maxTempC} °C`}
                  value={maxGpuTempC}
                  min={25}
                  max={95}
                  warningThreshold={80}
                  criticalThreshold={policy.maxTempC}
                  unit="°C"
                  decimals={0}
                  accent="amber"
                  extraInfo={[
                    { label: 'GPU #0 Ядро', value: formatMetric(gpuMetrics[0].tempC, ' °C') },
                    { label: 'GPU #1 Ядро', value: formatMetric(gpuMetrics[1].tempC, ' °C') },
                    { label: 'Кулер GPU #0', value: formatMetric(gpuMetrics[0].fanPercent, ' %') },
                    { label: 'Кулер GPU #1', value: formatMetric(gpuMetrics[1].fanPercent, ' %') },
                  ]}
                />

                <SpeedometerGauge
                  label="Время работы майнера"
                  sublabel="Статус пула Kryptex Pearl"
                  value={poolStatus.uptimeSec !== null ? Math.round(poolStatus.uptimeSec / 60) : null}
                  min={0}
                  max={1440}
                  unit="мин"
                  decimals={0}
                  accent="violet"
                  extraInfo={[
                    {
                      label: 'Статус пула',
                      value:
                        poolStatus.connected === true
                          ? 'Connected'
                          : poolStatus.connected === false
                          ? 'Disconnected'
                          : 'нет данных',
                      highlight:
                        poolStatus.connected === true
                          ? 'ok'
                          : poolStatus.connected === false
                          ? 'err'
                          : undefined,
                    },
                    {
                      label: 'Попытки рестарта',
                      value: `${poolStatus.restartAttempts} / ${policy.maxRestartAttempts}`,
                    },
                    {
                      label: 'Восстановление',
                      value: poolStatus.recoveryConfirmed ? 'Подтверждено' : 'Ожидание',
                    },
                    {
                      label: 'Этап',
                      value: poolStatus.reconnectStage,
                    },
                  ]}
                />
              </div>

              {/* Датчики температур видеокарт — по спидометру на каждую карту */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <h3 className="text-sm font-bold text-white">
                    Датчики температур видеокарт · стрелочные спидометры с циферблатом
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {gpuMetrics.map((gpu, idx) => (
                    <SpeedometerGauge
                      key={`temp-gpu-${gpu.id}`}
                      label={`Температура GPU #${gpu.id} · ${gpu.name}`}
                      sublabel={`nvidia-smi -i ${idx} · профиль PL ${rigConfig.gpus[idx].pl} Вт`}
                      value={gpu.tempC}
                      min={25}
                      max={100}
                      warningThreshold={80}
                      criticalThreshold={policy.maxTempC}
                      unit="°C (ядро GPU)"
                      decimals={0}
                      size="lg"
                      accent="fire"
                      extraInfo={[
                        {
                          label: 'Горячая точка (Hotspot)',
                          value: formatMetric(gpu.hotspotTempC, ' °C'),
                          highlight:
                            gpu.hotspotTempC !== null && gpu.hotspotTempC >= policy.criticalStopTempC
                              ? 'err'
                              : gpu.hotspotTempC !== null && gpu.hotspotTempC >= policy.maxTempC + 5
                              ? 'warn'
                              : 'ok',
                        },
                        {
                          label: 'Память VRAM',
                          value: formatMetric(gpu.vramTempC, ' °C'),
                          highlight:
                            gpu.vramTempC !== null && gpu.vramTempC >= 98
                              ? 'err'
                              : gpu.vramTempC !== null && gpu.vramTempC >= 90
                              ? 'warn'
                              : 'ok',
                        },
                        { label: 'Вентилятор', value: formatMetric(gpu.fanPercent, ' %') },
                        { label: 'Обороты кулера', value: formatMetric(gpu.fanRpm, ' RPM') },
                      ]}
                    />
                  ))}
                </div>
              </div>

              {/* Настройка мощности майнинга — ползунки Power Limit */}
              <div className="p-5 rounded-xl border border-slate-800 bg-[#111827] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Настройка мощности майнинга (Power Limit --pl)
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Огненная шкала: жёлтый → оранжевый → красный. Диапазон {MINING_PL_MIN}–{MINING_PL_MAX} Вт
                      (RTX 4070 Ti TGP 285 Вт). Значения попадают в BAT-скрипт и rig-config.json; при{' '}
                      &ge; {policy.maxTempC} °C watchdog автоматически снизит PL до {policy.emergencyPlWatts} Вт.
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-orange-500/15 text-orange-300 border border-orange-500/30 shrink-0">
                    {Math.round(
                      (((rigConfig.gpus[0].pl - MINING_PL_MIN) / (MINING_PL_MAX - MINING_PL_MIN)) * 100 +
                        ((rigConfig.gpus[1].pl - MINING_PL_MIN) / (MINING_PL_MAX - MINING_PL_MIN)) * 100) /
                        2
                    )}
                    % мощности
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {rigConfig.gpus.map((gpu, idx) => (
                    <div key={`pl-slider-${gpu.id}`} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <label className="text-slate-300 font-semibold">
                          GPU #{gpu.id} · {gpu.name}
                        </label>
                        <span className="font-mono font-bold text-orange-300">{gpu.pl} Вт</span>
                      </div>
                      <input
                        type="range"
                        min={MINING_PL_MIN}
                        max={MINING_PL_MAX}
                        step={5}
                        value={Math.min(Math.max(gpu.pl, MINING_PL_MIN), MINING_PL_MAX)}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setRigConfig((prev) => {
                            const next: [typeof gpu, typeof gpu] = [...prev.gpus] as [
                              typeof gpu,
                              typeof gpu,
                            ];
                            next[idx] = { ...next[idx], pl: val };
                            return { ...prev, gpus: next };
                          });
                        }}
                        className="fire-slider"
                        style={fireThumbStyle(gpu.pl, MINING_PL_MIN, MINING_PL_MAX)}
                        aria-label={`Power Limit GPU #${gpu.id}, Ватт`}
                      />
                      <div className="flex justify-between text-[10px] font-mono text-slate-500">
                        <span>{MINING_PL_MIN} Вт (эко)</span>
                        <span>150 Вт (профиль)</span>
                        <span>{MINING_PL_MAX} Вт (TGP)</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden border border-slate-800" style={fireFillStyle(((gpu.pl - MINING_PL_MIN) / (MINING_PL_MAX - MINING_PL_MIN)) * 100)} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Детальные карточки обеих видеокарт RTX 4070 Ti */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {gpuMetrics.map((gpu, idx) => (
                  <div
                    key={gpu.id}
                    className="p-5 rounded-xl border border-slate-800 bg-[#111827] space-y-4"
                  >
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div>
                        <div className="text-sm font-bold text-white">
                          GPU #{gpu.id} · {gpu.name}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          PCI {rigConfig.gpus[idx].pciBus} · Профиль: PL {rigConfig.gpus[idx].pl}W, CClk{' '}
                          {rigConfig.gpus[idx].cclk} MHz, MClk {rigConfig.gpus[idx].mclk} MHz, Kernel{' '}
                          {rigConfig.gpus[idx].kernel}, Fan {rigConfig.gpus[idx].fan}
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded text-xs font-mono bg-slate-900 border border-slate-700 text-slate-300">
                        {gpu.status === 'no_data'
                          ? 'нет данных'
                          : gpu.status === 'critical'
                          ? 'ПЕРЕГРЕВ >= 85°C'
                          : 'Активна'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                        <div className="text-slate-400">Хешрейт (API :3001)</div>
                        <div className="text-sm font-mono font-bold text-slate-100 mt-1">
                          {formatMetric(gpu.hashrateMHs, ' MH/s')}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                        <div className="text-slate-400">Температура (nvidia-smi)</div>
                        <div className="text-sm font-mono font-bold text-slate-100 mt-1">
                          {formatMetric(gpu.tempC, ' °C')}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                        <div className="text-slate-400">Мощность (nvidia-smi)</div>
                        <div className="text-sm font-mono font-bold text-slate-100 mt-1">
                          {formatMetric(gpu.powerWatts, ' Вт')}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                        <div className="text-slate-400">Вентилятор (nvidia-smi)</div>
                        <div className="text-sm font-mono font-bold text-slate-100 mt-1">
                          {formatMetric(gpu.fanPercent, ' %')}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                        <div className="text-slate-400">Частота ядра сейчас</div>
                        <div className="text-sm font-mono font-bold text-slate-100 mt-1">
                          {formatMetric(gpu.cclkMHz, ' МГц')}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                        <div className="text-slate-400">Частота памяти сейчас</div>
                        <div className="text-sm font-mono font-bold text-slate-100 mt-1">
                          {formatMetric(gpu.mclkMHz, ' МГц')}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Журнал событий */}
              <div className="p-5 rounded-xl border border-slate-800 bg-[#111827] space-y-3">
                <h3 className="text-sm font-bold text-white">Журнал локальных событий и проверок</h3>
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-slate-400 font-mono">
                        <span>
                          {ev.timestamp} · {ev.category}
                        </span>
                        <span
                          className={
                            ev.severity === 'error'
                              ? 'text-red-400'
                              : ev.severity === 'warning'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }
                        >
                          {ev.severity === 'error'
                            ? 'Ошибка'
                            : ev.severity === 'warning'
                            ? 'Внимание'
                            : 'Инфо'}
                        </span>
                      </div>
                      <div className="text-slate-100 font-medium">{ev.message}</div>
                      <div className="text-slate-400 font-mono">{ev.actionTaken}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'overclock' && (
            <div className="space-y-6">
              <div className="p-6 rounded-xl border border-slate-800 bg-[#111827] space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Профиль видеокарт Dual RTX 4070 Ti и тепловая защита (&ge; 85 °C)
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Power Limit 150 Вт, память 810 МГц, целевая частота ядра 2400 МГц, Kernel 2; вентилятор GPU 0 — 65%, GPU 1 — автоматический (*). Без повышения напряжения.
                    </p>
                  </div>
                  <button
                    onClick={handleResetDefaultOcProfile}
                    className="px-3.5 py-2 text-xs font-bold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors cursor-pointer shrink-0"
                  >
                    Восстановить профиль 150W / 2400 / 810
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {rigConfig.gpus.map((gpu, idx) => (
                    <div
                      key={gpu.id}
                      className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white">
                          GPU #{gpu.id} · {gpu.name}
                        </span>
                        <span className="text-xs font-mono text-emerald-400">
                          Kernel {gpu.kernel} · Без овервольтажа
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-slate-400">Целевое ядро --cclk (МГц)</label>
                          <input
                            type="number"
                            value={gpu.cclk}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRigConfig((prev) => {
                                const next: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                next[idx] = { ...next[idx], cclk: val };
                                return { ...prev, gpus: next };
                              });
                            }}
                            className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400">Память --mclk (МГц)</label>
                          <input
                            type="number"
                            value={gpu.mclk}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRigConfig((prev) => {
                                const next: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                next[idx] = { ...next[idx], mclk: val };
                                return { ...prev, gpus: next };
                              });
                            }}
                            className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400">Power Limit --pl (Вт)</label>
                          <input
                            type="number"
                            value={gpu.pl}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRigConfig((prev) => {
                                const next: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                next[idx] = { ...next[idx], pl: val };
                                return { ...prev, gpus: next };
                              });
                            }}
                            className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                          />
                          {/* Огненный ползунок мощности — синхронизирован с числовым полем */}
                          <input
                            type="range"
                            min={MINING_PL_MIN}
                            max={MINING_PL_MAX}
                            step={5}
                            value={Math.min(Math.max(gpu.pl, MINING_PL_MIN), MINING_PL_MAX)}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRigConfig((prev) => {
                                const next: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                next[idx] = { ...next[idx], pl: val };
                                return { ...prev, gpus: next };
                              });
                            }}
                            className="fire-slider mt-1"
                            style={fireThumbStyle(gpu.pl, MINING_PL_MIN, MINING_PL_MAX)}
                            aria-label={`Ползунок Power Limit GPU #${gpu.id}, Ватт`}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400">Вентилятор --fan (% или *)</label>
                          <input
                            type="text"
                            value={gpu.fan}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRigConfig((prev) => {
                                const next: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                next[idx] = { ...next[idx], fan: val };
                                return { ...prev, gpus: next };
                              });
                            }}
                            className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Настройки защиты от перегрева и переподключения */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-800 text-xs">
                  <div className="space-y-1">
                    <label className="text-slate-400">Порог снижения PL (°C)</label>
                    <input
                      type="number"
                      value={policy.maxTempC}
                      onChange={(e) =>
                        setPolicy((prev) => ({ ...prev, maxTempC: Number(e.target.value) }))
                      }
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Аварийный PL при &ge; 85°C (Вт)</label>
                    <input
                      type="number"
                      value={policy.emergencyPlWatts}
                      onChange={(e) =>
                        setPolicy((prev) => ({
                          ...prev,
                          emergencyPlWatts: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Ожидание реконнекта (сек)</label>
                    <input
                      type="number"
                      value={policy.zeroHashrateRestartSec}
                      onChange={(e) =>
                        setPolicy((prev) => ({
                          ...prev,
                          zeroHashrateRestartSec: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Макс. попыток перезапуска</label>
                    <input
                      type="number"
                      value={policy.maxRestartAttempts}
                      onChange={(e) =>
                        setPolicy((prev) => ({
                          ...prev,
                          maxRestartAttempts: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                    />
                  </div>
                </div>

                {/* Итоговая строка запуска */}
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      Сформированная команда запуска OneZeroMiner:
                    </span>
                    <button
                      onClick={handleCopyCmd}
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedCmd ? 'Скопировано' : 'Скопировать'}
                    </button>
                  </div>
                  <pre className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
                    {generatedOneLineCmd}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'diagnostics' && (
            <div className="space-y-6">
              {/* Автоматическая проверка 9 обязательных сценариев */}
              <div className="p-6 rounded-xl border border-slate-800 bg-[#111827] space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <Activity className="w-5 h-5 text-emerald-400" />
                    <div>
                      <h2 className="text-base font-bold text-white">
                        Автоматическая проверка 9 обязательных сценариев
                      </h2>
                      <p className="text-xs text-slate-400">
                        Детерминированные тесты логики запуска, валидатора кошелька, удержания кнопки «Стоп», перегрева &ge; 85 °C и отсутствия фейковых чисел
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Пройдено: {scenarioResults.filter((r) => r.passed).length} / {scenarioResults.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {scenarioResults.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-xl border space-y-1.5 text-xs ${
                        item.passed
                          ? 'bg-slate-900/80 border-emerald-500/30'
                          : 'bg-red-950/30 border-red-500/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-bold text-slate-100">
                        <span>{item.title}</span>
                        {item.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">{item.expected}</p>
                      <div className="text-[11px] font-mono text-emerald-300 pt-1">
                        {item.actual}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Анализатор реальных логов */}
              <div className="p-6 rounded-xl border border-slate-800 bg-[#111827] space-y-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Разбор логов OneZeroMiner (pearl-miner.log) понятным языком
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Вставьте строки из реального файла лога для расшифровки ошибок подключения к пулу или драйвера GPU
                  </p>
                </div>

                <textarea
                  rows={5}
                  value={rawLogInput}
                  onChange={(e) => setRawLogInput(e.target.value)}
                  placeholder="Вставьте строки из pearl-miner.log..."
                  className="w-full p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                />

                <div className="space-y-2.5">
                  {logDiagnostics.map((item, i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between font-bold text-slate-100">
                        <span>{item.title}</span>
                        <span
                          className={`font-mono ${
                            item.severity === 'error'
                              ? 'text-red-400'
                              : item.severity === 'warning'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {item.severity.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-slate-400">{item.detail}</p>
                      <div className="font-mono text-emerald-300">Рекомендация: {item.fixCommand}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="p-6 rounded-xl border border-slate-800 bg-[#111827] space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>Исправленные файлы проекта для локального запуска на ПК</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Без обрезанного адреса, без автозапуска при установке, без изменения маршрутов/DNS/hosts и без удалённого управления из GitHub
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800">
                  {(
                    [
                      ['bat', 'pearl_watchdog_agent.bat'],
                      ['json', 'rig-config.json'],
                      ['iss', 'installer.iss'],
                      ['workflow', 'build-installer.yml'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setPreviewFile(key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        previewFile === key
                          ? 'bg-emerald-400 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  onClick={handleCopyPreviewCode}
                  className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 flex items-center gap-2 cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedCode ? 'Скопировано' : 'Скопировать код'}
                </button>
                <button
                  onClick={handleDownloadActiveFile}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Скачать файл
                </button>
              </div>

              <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto max-h-[460px] overflow-y-auto leading-relaxed">
                {activePreviewContent}
              </pre>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
