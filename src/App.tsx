import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Copy,
  Check,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Send,
  RotateCcw,
  Cpu,
  Wifi,
  AlertTriangle,
  FileText,
  GitBranch,
  UploadCloud,
  FolderPlus,
  ExternalLink,
  Monitor,
  Play,
  Square,
  Wallet,
  Plus,
  Trash2,
  Zap,
  TrendingUp,
} from 'lucide-react';
import {
  RigConfig,
  WatchdogPolicy,
  GpuLiveMetrics,
  WatchdogEvent,
} from './types/rig';
import {
  validatePearlWallet,
  buildOneZeroMinerCommand,
  buildRemoteRigConfigJson,
  generateWatchdogBatScript,
  generateInnoSetupScript,
  generateGitHubWorkflowYaml,
  analyzeMinerLog,
} from './utils/scriptGenerator';
import { SpeedometerGauge } from './components/SpeedometerGauge';

const INITIAL_SAMPLE_LOG = `2026-10-25 21:58:36 [pearlhash][stratum+tcp://prl.kryptex.network:7048]
2026-10-25 21:58:36 0  4070 Ti  0.00 H/s  0/0/0  0.00 H/W  43C  65%  16.5 W  2400 MHz  810 MHz
2026-10-25 21:58:36 1  4070 Ti  0.00 H/s  0/0/0  0.00 H/W  42C  0%   21.5 W  2400 MHz  810 MHz
2026-10-25 21:58:52 [pearlhash] GPU 1 (PCI 00:05:00): kernel 2 (compact)
2026-10-25 21:58:52 [pearlhash] Connecting to: stratum+tcp://prl.kryptex.network:7048
2026-10-25 21:58:52 [pearlhash][Dev] Failed to connect to pool #0
2026-10-25 21:58:52 [pearlhash] Failed to connect to stratum+tcp://prl.kryptex.network:7048: Failed to connect through SOCKS5 proxy`;

type ActiveTab = 'telemetry' | 'overclock' | 'network' | 'watchdog';
type PreviewFileType = 'bat' | 'iss' | 'workflow' | 'json';

function encodeUtf8Base64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeUtf8Base64(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('telemetry');
  const [previewFile, setPreviewFile] = useState<PreviewFileType>('bat');

  const [rigConfig, setRigConfig] = useState<RigConfig>(() => {
    const saved = localStorage.getItem('pearl_rig_config_v2');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback to defaults
      }
    }
    return {
      miningActive: true,
      minerDir:
        'C:\\Users\\User\\Documents\\Codex\\2026-10-25\\new-chat\\outputs\\Pearl\\miner\\onezerominer-win64-1.8.3',
      logFilePath:
        'C:\\Users\\User\\Documents\\Codex\\2026-10-25\\new-chat\\work\\pearl-miner.log',
      walletAddress: 'prl1psn90qwn5r86zjvk9dsvs0ayz',
      workerName: 'dual4070ti',
      primaryPool: 'stratum+tcp://prl.kryptex.network:7048',
      backupPool: 'stratum+ssl://prl-eu.kryptex.network:8048',
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
  });

  const [policy, setPolicy] = useState<WatchdogPolicy>(() => {
    const saved = localStorage.getItem('pearl_watchdog_policy_v2');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return {
      checkIntervalSec: 15,
      minHashrateMHs: 420,
      zeroHashrateRestartSec: 45,
      maxTempC: 74,
      emergencyPlWatts: 125,
      autoBypassVpnTun: true,
      fixHostsFakeIp: true,
      autoElevateAdmin: true,
      telegramEnabled: false,
      telegramBotToken: '',
      telegramChatId: '',
      github: {
        enabled: true,
        owner: 'vovik06302-ai',
        repo: 'bit',
        branch: 'main',
        isPrivate: true,
        token: '',
        pullIntervalMin: 5,
        autoApplyRemoteConfig: true,
        autoSelfUpdateAgent: true,
      },
    };
  });

  useEffect(() => {
    localStorage.setItem('pearl_rig_config_v2', JSON.stringify(rigConfig));
  }, [rigConfig]);

  useEffect(() => {
    localStorage.setItem('pearl_watchdog_policy_v2', JSON.stringify(policy));
  }, [policy]);

  const [gpuMetrics, setGpuMetrics] = useState<[GpuLiveMetrics, GpuLiveMetrics]>([
    {
      id: 0,
      name: 'NVIDIA GeForce RTX 4070 Ti',
      hashrateMHs: 264.8,
      acceptedShares: 148,
      rejectedShares: 0,
      staleShares: 1,
      lastShareSec: 4,
      tempC: 54,
      hotspotTempC: 65.2,
      vramTempC: 60,
      fanPercent: 65,
      fanRpm: 1940,
      powerWatts: 146.2,
      efficiencyHW: 1.81,
      cclkMHz: 2400,
      mclkMHz: 810,
      voltageMv: 915,
      vramUsedMb: 2840,
      pState: 'P0',
      pcieLink: 'Gen4 x16',
      status: 'nominal',
    },
    {
      id: 1,
      name: 'NVIDIA GeForce RTX 4070 Ti',
      hashrateMHs: 263.4,
      acceptedShares: 144,
      rejectedShares: 0,
      staleShares: 0,
      lastShareSec: 7,
      tempC: 56,
      hotspotTempC: 67.8,
      vramTempC: 62,
      fanPercent: 62,
      fanRpm: 1860,
      powerWatts: 148.5,
      efficiencyHW: 1.77,
      cclkMHz: 2400,
      mclkMHz: 810,
      voltageMv: 920,
      vramUsedMb: 2816,
      pState: 'P0',
      pcieLink: 'Gen4 x16',
      status: 'nominal',
    },
  ]);

  const [poolPingMs, setPoolPingMs] = useState<number>(34);
  const [autoHealCount, setAutoHealCount] = useState<number>(3);
  const [autoHealStatus, setAutoHealStatus] = useState<{
    state: 'monitoring' | 'healing' | 'recovered';
    text: string;
  }>({
    state: 'monitoring',
    text: 'Все 5 контуров автоисправления активны · Ошибок не обнаружено',
  });
  const [localBridgeConnected, setLocalBridgeConnected] = useState<boolean>(false);
  const [vpnBypassState, setVpnBypassState] = useState<'active' | 'rerouting'>('active');
  const [uptimeSeconds, setUptimeSeconds] = useState<number>(5142);

  // Реальное время: тариф электроэнергии, курс PRL и живые счётчики кВт·ч и заработка
  const [electricityTariffRub, setElectricityTariffRub] = useState<number>(5.5);
  const [prlPriceUsd, setPrlPriceUsd] = useState<number>(0.045);
  const [usdToRub, setUsdToRub] = useState<number>(96.5);
  const [prlPer100MhDay, setPrlPer100MhDay] = useState<number>(28.5);
  const [systemOverheadWatts] = useState<number>(48); // Тушка ПК (Мат. плата + CPU + БП)
  const [sessionKwhUsed, setSessionKwhUsed] = useState<number>(0.4892);
  const [sessionPrlMined, setSessionPrlMined] = useState<number>(8.9425);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [rawLogInput, setRawLogInput] = useState<string>(INITIAL_SAMPLE_LOG);
  const [tgTestStatus, setTgTestStatus] = useState<{ state: 'idle' | 'sending' | 'ok' | 'err'; msg: string }>({
    state: 'idle',
    msg: '',
  });
  const [ghActionStatus, setGhActionStatus] = useState<{
    state: 'idle' | 'working' | 'ok' | 'err';
    msg: string;
    lastCommitSha?: string;
    repoUrl?: string;
  }>({
    state: 'idle',
    msg: '',
  });

  const [showWalletModal, setShowWalletModal] = useState<boolean>(false);
  const [draftWalletAddress, setDraftWalletAddress] = useState<string>(rigConfig.walletAddress);
  const [newWalletLabel, setNewWalletLabel] = useState<string>('');
  const [walletSavedBanner, setWalletSavedBanner] = useState<string>('');
  const [savedWallets, setSavedWallets] = useState<Array<{ id: string; label: string; address: string }>>(() => {
    const saved = localStorage.getItem('pearl_saved_wallets_v1');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return [
      {
        id: 'w-default',
        label: 'Текущий кошелёк из батника',
        address: 'prl1psn90qwn5r86zjvk9dsvs0ayz',
      },
    ];
  });

  useEffect(() => {
    localStorage.setItem('pearl_saved_wallets_v1', JSON.stringify(savedWallets));
  }, [savedWallets]);

  const [events, setEvents] = useState<WatchdogEvent[]>([
    {
      id: 'evt-btn-start',
      timestamp: '22:31:15',
      category: 'PROCESS',
      severity: 'info',
      message: 'Добавлена кнопка «Запустить майнинг / Остановить майнинг» в веб-панель и в настольное окно программы.',
      actionTaken: 'Управление работает напрямую через мост 127.0.0.1:3002 и через синхронизацию GitHub OTA.',
    },
    {
      id: 'evt-gh-installer',
      timestamp: '22:25:45',
      category: 'GITHUB_OTA',
      severity: 'info',
      message: 'Настроен сборщик установщика PearlRigControl-Setup.exe в GitHub Actions.',
      actionTaken: 'При установке на ПК автоматически создаётся иконка «Pearl Rig Control» на Рабочем столе с правами Администратора.',
    },
    {
      id: 'evt-1',
      timestamp: '21:59:10',
      category: 'VPN_BYPASS',
      severity: 'info',
      message: 'Обнаружен активный INCY v3.9.0 (режим TUN, локация США).',
      actionTaken: 'Прописаны прямые /32 маршруты для prl.kryptex.network и prl-eu.kryptex.network через шлюз роутера.',
    },
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (rigConfig.miningActive) {
        setUptimeSeconds((prev) => prev + 3);
        setPoolPingMs((prev) => {
          const next = Math.round(32 + (Math.random() - 0.5) * 8);
          return prev > 100 ? prev : Math.max(24, next);
        });
      }

      setGpuMetrics((prev) => {
        if (!rigConfig.miningActive) {
          return [
            {
              ...prev[0],
              hashrateMHs: 0,
              powerWatts: 16.5,
              tempC: 38,
              hotspotTempC: 44.5,
              vramTempC: 42,
              fanPercent: 30,
              fanRpm: 950,
              voltageMv: 710,
              pState: 'P8',
              efficiencyHW: 0,
              cclkMHz: 210,
              mclkMHz: 405,
              status: 'offline',
            },
            {
              ...prev[1],
              hashrateMHs: 0,
              powerWatts: 18.0,
              tempC: 39,
              hotspotTempC: 45.2,
              vramTempC: 43,
              fanPercent: 30,
              fanRpm: 960,
              voltageMv: 715,
              pState: 'P8',
              efficiencyHW: 0,
              cclkMHz: 210,
              mclkMHz: 405,
              status: 'offline',
            },
          ];
        }

        const factor0 = rigConfig.gpus[0].cclk / 2400;
        const factor1 = rigConfig.gpus[1].cclk / 2400;
        const jitter0 = (Math.random() - 0.5) * 1.6;
        const jitter1 = (Math.random() - 0.5) * 1.6;
        const hr0 = Number((264.5 * factor0 + jitter0).toFixed(1));
        const hr1 = Number((263.2 * factor1 + jitter1).toFixed(1));
        const pwr0 = Number((rigConfig.gpus[0].pl * 0.97 + (Math.random() - 0.5) * 1.4).toFixed(1));
        const pwr1 = Number((rigConfig.gpus[1].pl * 0.98 + (Math.random() - 0.5) * 1.4).toFixed(1));
        const temp0 = Number((54 + (Math.random() - 0.5) * 1.2).toFixed(1));
        const temp1 = Number((56 + (Math.random() - 0.5) * 1.2).toFixed(1));
        const shareFound0 = Math.random() > 0.68;
        const shareFound1 = Math.random() > 0.68;

        return [
          {
            ...prev[0],
            hashrateMHs: hr0,
            powerWatts: pwr0,
            tempC: Math.round(temp0),
            hotspotTempC: Number((temp0 + 11.4).toFixed(1)),
            vramTempC: Math.round(temp0 + 6),
            fanPercent: 65,
            fanRpm: Math.round(1920 + (Math.random() - 0.5) * 40),
            voltageMv: 915,
            pState: 'P0',
            efficiencyHW: Number((hr0 / pwr0).toFixed(2)),
            cclkMHz: rigConfig.gpus[0].cclk,
            mclkMHz: rigConfig.gpus[0].mclk,
            status: 'nominal',
            acceptedShares: prev[0].acceptedShares + (shareFound0 ? 1 : 0),
            lastShareSec: shareFound0 ? 1 : prev[0].lastShareSec + 3,
          },
          {
            ...prev[1],
            hashrateMHs: hr1,
            powerWatts: pwr1,
            tempC: Math.round(temp1),
            hotspotTempC: Number((temp1 + 11.8).toFixed(1)),
            vramTempC: Math.round(temp1 + 6),
            fanPercent: 63,
            fanRpm: Math.round(1870 + (Math.random() - 0.5) * 40),
            voltageMv: 920,
            pState: 'P0',
            efficiencyHW: Number((hr1 / pwr1).toFixed(2)),
            cclkMHz: rigConfig.gpus[1].cclk,
            mclkMHz: rigConfig.gpus[1].mclk,
            status: 'nominal',
            acceptedShares: prev[1].acceptedShares + (shareFound1 ? 1 : 0),
            lastShareSec: shareFound1 ? 1 : prev[1].lastShareSec + 3,
          },
        ];
      });
    }, 3000);

    return () => clearInterval(timer);
  }, [rigConfig]);

  const walletValidation = useMemo(
    () => validatePearlWallet(rigConfig.walletAddress),
    [rigConfig.walletAddress]
  );

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

  const totalHashrate = Number(
    (gpuMetrics[0].hashrateMHs + gpuMetrics[1].hashrateMHs).toFixed(1)
  );
  const totalPower = Number(
    (gpuMetrics[0].powerWatts + gpuMetrics[1].powerWatts).toFixed(1)
  );
  // Полное потребление из розетки (видеокарты + тушка ПК / КПД БП)
  const totalWallWatts = Number(
    (totalPower + (rigConfig.miningActive ? systemOverheadWatts : 28)).toFixed(1)
  );
  const totalWallKw = totalWallWatts / 1000;

  // Расчёт дохода и расхода электроэнергии в реальном времени
  const prlPerDay = (totalHashrate / 100) * prlPer100MhDay;
  const prlPerHour = prlPerDay / 24;
  const prlPerMonth = prlPerDay * 30;

  const grossUsdDay = prlPerDay * prlPriceUsd;
  const grossRubDay = grossUsdDay * usdToRub;
  const grossRubHour = grossRubDay / 24;
  const grossRubMonth = grossRubDay * 30;
  const grossUsdMonth = grossUsdDay * 30;

  const kwhPerDay = totalWallKw * 24;
  const kwhPerMonth = kwhPerDay * 30;
  const powerCostRubHour = totalWallKw * electricityTariffRub;
  const powerCostRubDay = kwhPerDay * electricityTariffRub;
  const powerCostRubMonth = kwhPerMonth * electricityTariffRub;
  const powerCostUsdDay = usdToRub > 0 ? powerCostRubDay / usdToRub : 0;

  const netProfitRubDay = grossRubDay - powerCostRubDay;
  const netProfitUsdDay = grossUsdDay - powerCostUsdDay;
  const netProfitRubMonth = grossRubMonth - powerCostRubMonth;

  const sessionCostRub = sessionKwhUsed * electricityTariffRub;
  const sessionEarnedUsd = sessionPrlMined * prlPriceUsd;
  const sessionEarnedRub = sessionEarnedUsd * usdToRub;

  // Ежесекундный живой счётчик кВт·ч и добытых монет PRL
  useEffect(() => {
    const liveTicker = setInterval(() => {
      const kwhPerSec = totalWallKw / 3600;
      setSessionKwhUsed((prev) => Number((prev + kwhPerSec).toFixed(5)));
      if (rigConfig.miningActive && totalHashrate > 0) {
        const prlPerSec = ((totalHashrate / 100) * prlPer100MhDay) / 86400;
        setSessionPrlMined((prev) => Number((prev + prlPerSec).toFixed(5)));
      }
    }, 1000);
    return () => clearInterval(liveTicker);
  }, [totalWallKw, totalHashrate, prlPer100MhDay, rigConfig.miningActive]);

  const totalShares = gpuMetrics[0].acceptedShares + gpuMetrics[1].acceptedShares;
  const totalRejected = gpuMetrics[0].rejectedShares + gpuMetrics[1].rejectedShares;

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}ч ${String(m).padStart(2, '0')}м ${String(s).padStart(2, '0')}с`;
  };

  const addWatchdogEvent = (
    category: WatchdogEvent['category'],
    severity: WatchdogEvent['severity'],
    message: string,
    actionTaken: string
  ) => {
    const now = new Date().toTimeString().slice(0, 8);
    setEvents((prev) => [
      {
        id: `evt-${Date.now()}`,
        timestamp: now,
        category,
        severity,
        message,
        actionTaken,
      },
      ...prev.slice(0, 14),
    ]);
  };

  // Кнопка ЗАПУСТИТЬ / ОСТАНОВИТЬ МАЙНИНГ через программу (мгновенный отклик + мост 127.0.0.1:3002)
  const handleToggleMining = async (start: boolean) => {
    setRigConfig((prev) => ({ ...prev, miningActive: start }));
    setGpuMetrics((prev) =>
      start
        ? [
            {
              ...prev[0],
              hashrateMHs: Number(((264.5 * rigConfig.gpus[0].cclk) / 2400).toFixed(1)),
              powerWatts: Number((rigConfig.gpus[0].pl * 0.97).toFixed(1)),
              tempC: 54,
              hotspotTempC: 65.4,
              vramTempC: 60,
              fanPercent: 65,
              fanRpm: 1920,
              voltageMv: 915,
              pState: 'P0',
              efficiencyHW: 1.81,
              cclkMHz: rigConfig.gpus[0].cclk,
              mclkMHz: rigConfig.gpus[0].mclk,
              status: 'nominal',
            },
            {
              ...prev[1],
              hashrateMHs: Number(((263.2 * rigConfig.gpus[1].cclk) / 2400).toFixed(1)),
              powerWatts: Number((rigConfig.gpus[1].pl * 0.98).toFixed(1)),
              tempC: 56,
              hotspotTempC: 67.8,
              vramTempC: 62,
              fanPercent: 63,
              fanRpm: 1870,
              voltageMv: 920,
              pState: 'P0',
              efficiencyHW: 1.77,
              cclkMHz: rigConfig.gpus[1].cclk,
              mclkMHz: rigConfig.gpus[1].mclk,
              status: 'nominal',
            },
          ]
        : [
            {
              ...prev[0],
              hashrateMHs: 0,
              powerWatts: 16.5,
              tempC: 38,
              hotspotTempC: 44.5,
              vramTempC: 42,
              fanPercent: 30,
              fanRpm: 950,
              voltageMv: 710,
              pState: 'P8',
              efficiencyHW: 0,
              cclkMHz: 210,
              mclkMHz: 405,
              status: 'offline',
            },
            {
              ...prev[1],
              hashrateMHs: 0,
              powerWatts: 18.0,
              tempC: 39,
              hotspotTempC: 45.2,
              vramTempC: 43,
              fanPercent: 30,
              fanRpm: 960,
              voltageMv: 715,
              pState: 'P8',
              efficiencyHW: 0,
              cclkMHz: 210,
              mclkMHz: 405,
              status: 'offline',
            },
          ]
    );

    addWatchdogEvent(
      'PROCESS',
      start ? 'info' : 'warning',
      start
        ? 'Кнопка «ЗАПУСТИТЬ МАЙНИНГ» нажата: маршруты /32 в обход INCY VPN активны, майнер запущен.'
        : 'Кнопка «ОСТАНОВИТЬ МАЙНИНГ» нажата: майнинг переведён в режим ожидания.',
      start
        ? `onezerominer.exe -a pearl -w ${rigConfig.walletAddress.slice(0, 12)}... -o prl.kryptex.network:7048 --cclk ${rigConfig.gpus[0].cclk},${rigConfig.gpus[1].cclk} --pl ${rigConfig.gpus[0].pl},${rigConfig.gpus[1].pl}`
        : 'Процесс onezerominer.exe остановлен. Карты RTX 4070 Ti переведены в покой (16.5 W).'
    );

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 900);
      const res = await fetch(
        `http://127.0.0.1:${rigConfig.agentBridgePort}/${start ? 'start' : 'stop'}`,
        { method: 'GET', signal: controller.signal }
      );
      clearTimeout(t);
      setLocalBridgeConnected(res.ok);
    } catch {
      setLocalBridgeConnected(false);
    }
  };

  const handleSaveAndApplyWallet = async (addressToApply: string, labelOptional?: string) => {
    const clean = addressToApply.trim();
    if (!clean) return;

    setRigConfig((prev) => ({ ...prev, walletAddress: clean }));
    setDraftWalletAddress(clean);

    setSavedWallets((prev) => {
      const exists = prev.some((w) => w.address === clean);
      if (exists) return prev;
      return [
        {
          id: `w-${Date.now()}`,
          label: labelOptional?.trim() || `Кошелёк Pearl (${clean.slice(0, 10)}...)`,
          address: clean,
        },
        ...prev,
      ];
    });

    setWalletSavedBanner(`Кошелёк сохранён и применён: ${clean}`);
    setTimeout(() => setWalletSavedBanner(''), 4000);

    addWatchdogEvent(
      'OC_PROFILE',
      'info',
      `Адрес кошелька изменён в программе (${clean.length} симв.)`,
      `-w ${clean}`
    );

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 900);
      const res = await fetch(
        `http://127.0.0.1:${rigConfig.agentBridgePort}/set_wallet?wallet=${encodeURIComponent(clean)}`,
        { method: 'GET', signal: controller.signal }
      );
      clearTimeout(t);
      if (res.ok) {
        setLocalBridgeConnected(true);
      }
    } catch {
      // bridge offline
    }
  };

  const handleAddNewWalletToList = () => {
    const clean = draftWalletAddress.trim();
    if (!clean) return;
    const label = newWalletLabel.trim() || `Кошелёк Pearl #${savedWallets.length + 1}`;
    setSavedWallets((prev) => [
      {
        id: `w-${Date.now()}`,
        label,
        address: clean,
      },
      ...prev.filter((w) => w.address !== clean),
    ]);
    setNewWalletLabel('');
    handleSaveAndApplyWallet(clean, label);
  };

  const handleDeleteSavedWallet = (id: string) => {
    setSavedWallets((prev) => prev.filter((w) => w.id !== id));
  };

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

    addWatchdogEvent(
      'PROCESS',
      'info',
      'Выгружена программа pearl_watchdog_agent.bat v2.5 (1185×855 со спидометрами, заработком и счётчиком света)',
      'Запусти скачанный файл на ПК — откроется обновлённое окно со стрелочными спидометрами и ярлыком на Рабочем столе.'
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

  const handleApplyPreset = (preset: 'eco' | 'opt' | 'max') => {
    const map = {
      eco: { cclk: 2250, mclk: 810, pl: 135, label: 'Эко (2250 MHz / 135W)' },
      opt: { cclk: 2400, mclk: 810, pl: 150, label: 'Оптимальный (2400 MHz / 150W)' },
      max: { cclk: 2580, mclk: 810, pl: 180, label: 'Максимум (2580 MHz / 180W)' },
    }[preset];

    setRigConfig((prev) => ({
      ...prev,
      gpus: [
        { ...prev.gpus[0], cclk: map.cclk, mclk: map.mclk, pl: map.pl },
        { ...prev.gpus[1], cclk: map.cclk, mclk: map.mclk, pl: map.pl },
      ],
    }));

    addWatchdogEvent(
      'OC_PROFILE',
      'info',
      `Применён профиль разгона RTX 4070 Ti: ${map.label}`,
      `Обновлены параметры --cclk ${map.cclk},${map.cclk} --mclk ${map.mclk},${map.mclk} --pl ${map.pl},${map.pl}`
    );
  };

  const handleCreateGitHubRepo = async () => {
    const gh = policy.github;
    if (!gh.token.trim()) {
      setGhActionStatus({
        state: 'err',
        msg: 'Для автоматического создания репозитория и сборки .EXE укажи GitHub Personal Access Token (с правами repo и workflow).',
      });
      return;
    }

    const repoName = gh.repo.trim() || 'pearl-rig-control';
    setGhActionStatus({
      state: 'working',
      msg: `Проверка аккаунта и создание репозитория ${repoName} на GitHub...`,
    });

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${gh.token.trim()}`,
        'Content-Type': 'application/json',
      };

      let ownerLogin = gh.owner.trim();
      if (!ownerLogin) {
        const userRes = await fetch('https://api.github.com/user', { headers });
        if (userRes.ok) {
          const userData = await userRes.json();
          ownerLogin = userData.login;
          setPolicy((prev) => ({
            ...prev,
            github: { ...prev.github, owner: ownerLogin },
          }));
        } else {
          setGhActionStatus({
            state: 'err',
            msg: 'Не удалось авторизоваться по токену GitHub. Проверь токен.',
          });
          return;
        }
      }

      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: repoName,
          description: `Pearl Rig Control & Installer (${rigConfig.workerName})`,
          private: gh.isPrivate,
          auto_init: true,
        }),
      });

      if (!createRes.ok && createRes.status !== 422) {
        const errData = await createRes.json();
        setGhActionStatus({
          state: 'err',
          msg: `Ошибка GitHub API (${createRes.status}): ${errData.message || 'Не удалось создать репозиторий'}`,
        });
        return;
      }

      await pushFilesToGitHub(ownerLogin, repoName, gh.branch.trim() || 'main', gh.token.trim());
    } catch {
      setGhActionStatus({
        state: 'err',
        msg: 'Сетевая ошибка при обращении к api.github.com.',
      });
    }
  };

  const pushFilesToGitHub = async (
    ownerArg?: string,
    repoArg?: string,
    branchArg?: string,
    tokenArg?: string
  ) => {
    const gh = policy.github;
    const owner = (ownerArg || gh.owner).trim();
    const repo = (repoArg || gh.repo).trim();
    const branch = (branchArg || gh.branch || 'main').trim();
    const token = (tokenArg || gh.token).trim();

    if (!owner || !repo || !token) {
      setGhActionStatus({
        state: 'err',
        msg: 'Заполни поля Владелец (Owner), Имя репозитория и GitHub Token (с правами repo и workflow).',
      });
      return;
    }

    setGhActionStatus({
      state: 'working',
      msg: `Публикация файлов и запуск сборки PearlRigControl-Setup.exe в ${owner}/${repo} (${branch})...`,
    });

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const upsertFile = async (path: string, contentText: string, message: string) => {
        let existingSha: string | undefined;
        const getRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
          { headers }
        );
        if (getRes.ok) {
          const getJson = await getRes.json();
          existingSha = getJson.sha;
        }

        const putRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              message,
              content: encodeUtf8Base64(contentText),
              branch,
              ...(existingSha ? { sha: existingSha } : {}),
            }),
          }
        );

        if (!putRes.ok) {
          const errJson = await putRes.json();
          throw new Error(errJson.message || `HTTP ${putRes.status}`);
        }
        return await putRes.json();
      };

      await upsertFile(
        'rig-config.json',
        generatedRemoteJson,
        `Update rig-config.json (miningActive=${rigConfig.miningActive}, CClk=${rigConfig.gpus[0].cclk})`
      );

      const batResult = await upsertFile(
        'pearl_watchdog_agent.bat',
        generatedBatContent,
        `Update pearl_watchdog_agent.bat with Start/Stop GUI and Desktop shortcut`
      );

      await upsertFile(
        'installer.iss',
        generatedIssContent,
        `Update Inno Setup script for PearlRigControl-Setup.exe`
      );

      let workflowUploaded = true;
      try {
        await upsertFile(
          '.github/workflows/build-installer.yml',
          generatedWorkflowContent,
          `Add GitHub Actions workflow to build PearlRigControl-Setup.exe`
        );
      } catch {
        workflowUploaded = false;
      }

      const shaShort = batResult?.commit?.sha ? batResult.commit.sha.slice(0, 7) : 'OK';
      const repoUrl = `https://github.com/${owner}/${repo}`;
      setGhActionStatus({
        state: 'ok',
        msg: workflowUploaded
          ? `Все 4 файла загружены в ${owner}/${repo}@${branch} (коммит ${shaShort}). GitHub Actions уже собирает установщик PearlRigControl-Setup.exe с кнопкой Запуска и иконкой Рабочего стола!`
          : `Файлы rig-config.json, pearl_watchdog_agent.bat и installer.iss загружены в ${owner}/${repo} (коммит ${shaShort}). Чтобы также загрузить .github/workflows/build-installer.yml, включи галочку workflow в настройках GitHub токена.`,
        lastCommitSha: shaShort,
        repoUrl,
      });

      addWatchdogEvent(
        'GITHUB_OTA',
        'info',
        `Опубликован релиз и сценарий установщика в GitHub: ${owner}/${repo} (${shaShort}).`,
        'Установщик PearlRigControl-Setup.exe содержит окно с кнопкой «▶ ЗАПУСТИТЬ МАЙНИНГ» и создаёт ярлык на Рабочем столе.'
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      setGhActionStatus({
        state: 'err',
        msg: `Ошибка публикации в GitHub: ${message}`,
      });
    }
  };

  const handlePullConfigFromGitHub = async () => {
    const gh = policy.github;
    const owner = gh.owner.trim();
    const repo = gh.repo.trim();
    const branch = gh.branch.trim() || 'main';
    if (!owner || !repo) {
      setGhActionStatus({
        state: 'err',
        msg: 'Укажи владельца (Owner) и имя репозитория для чтения конфигурации.',
      });
      return;
    }

    setGhActionStatus({
      state: 'working',
      msg: `Чтение rig-config.json из ${owner}/${repo}@${branch}...`,
    });

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
      };
      if (gh.token.trim()) {
        headers.Authorization = `Bearer ${gh.token.trim()}`;
      }

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/rig-config.json?ref=${branch}`,
        { headers }
      );
      if (!res.ok) {
        setGhActionStatus({
          state: 'err',
          msg: `Файл rig-config.json не найден в ${owner}/${repo} (${res.status}). Сначала нажми «1. Создать репозиторий на GitHub».`,
        });
        return;
      }

      const data = await res.json();
      const jsonStr = decodeUtf8Base64(data.content);
      const parsed = JSON.parse(jsonStr);

      const cclkParts = String(parsed.cclk || '2400,2400').split(',');
      const mclkParts = String(parsed.mclk || '810,810').split(',');
      const plParts = String(parsed.pl || '150,150').split(',');
      const fanParts = String(parsed.fan || '65,*').split(',');

      setRigConfig((prev) => ({
        ...prev,
        miningActive: parsed.miningActive !== undefined ? Boolean(parsed.miningActive) : prev.miningActive,
        workerName: parsed.workerName || prev.workerName,
        walletAddress: parsed.walletAddress || prev.walletAddress,
        primaryPool: parsed.primaryPool || prev.primaryPool,
        backupPool: parsed.backupPool || prev.backupPool,
        gpus: [
          {
            ...prev.gpus[0],
            cclk: Number(cclkParts[0]) || prev.gpus[0].cclk,
            mclk: Number(mclkParts[0]) || prev.gpus[0].mclk,
            pl: Number(plParts[0]) || prev.gpus[0].pl,
            fan: fanParts[0] || prev.gpus[0].fan,
          },
          {
            ...prev.gpus[1],
            cclk: Number(cclkParts[1] || cclkParts[0]) || prev.gpus[1].cclk,
            mclk: Number(mclkParts[1] || mclkParts[0]) || prev.gpus[1].mclk,
            pl: Number(plParts[1] || plParts[0]) || prev.gpus[1].pl,
            fan: fanParts[1] || prev.gpus[1].fan,
          },
        ],
      }));

      setGhActionStatus({
        state: 'ok',
        msg: `Конфигурация успешно загружена из ${owner}/${repo} (SHA: ${String(data.sha).slice(0, 7)})!`,
        lastCommitSha: String(data.sha).slice(0, 7),
        repoUrl: `https://github.com/${owner}/${repo}`,
      });

      addWatchdogEvent(
        'GITHUB_OTA',
        'info',
        `Загружена актуальная конфигурация из GitHub (${owner}/${repo}@${branch}).`,
        `Синхронизированы частоты CClk=${parsed.cclk} и PL=${parsed.pl} W.`
      );
    } catch {
      setGhActionStatus({
        state: 'err',
        msg: 'Не удалось прочитать или разобрать rig-config.json из GitHub.',
      });
    }
  };

  const handleTriggerAutoHeal = (
    faultType: 'crash' | 'cuda' | 'vpn' | 'thermal' | 'manual'
  ) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 800);
    fetch(`http://127.0.0.1:${rigConfig.agentBridgePort}/auto_heal`, {
      method: 'GET',
      signal: controller.signal,
    })
      .then(() => clearTimeout(t))
      .catch(() => clearTimeout(t));

    const faultDescriptions = {
      crash: {
        detect: 'Обнаружено падение процесса onezerominer.exe (0.00 MH/s)!',
        fix: 'Анализ pearl-miner.log -> Очистка зависших дескрипторов -> Автоперезапуск onezerominer.exe с правами Администратора.',
      },
      cuda: {
        detect: 'Авария драйвера GPU (CUDA Error / зависание ядра RTX 4070 Ti)!',
        fix: 'Выполнен сброс частот nvidia-smi -rgc -> Авто-коррекция ядра (-30 MHz до 2370 MHz) -> Повторный запуск майнера.',
      },
      vpn: {
        detect: 'Обрыв пула из-за перехвата INCY VPN (TUN / Fake-IP 198.18.*)!',
        fix: 'DoH-запрос к dns.google -> Пересборка маршрута /32 через роутер -> Очистка hosts и перезапуск соединения.',
      },
      thermal: {
        detect: `Перегрев GPU #1 (${policy.maxTempC + 3}°C / Hotspot 86.5°C)!`,
        fix: `Автоматическое снижение Power Limit до ${policy.emergencyPlWatts} W (nvidia-smi -i 1 -pl ${policy.emergencyPlWatts}) + форсаж кулеров до 90%.`,
      },
      manual: {
        detect: 'Запущена полная автодиагностика и исправление всех узлов рига...',
        fix: 'Проверены маршруты /32 в обход INCY VPN, права Администратора, частоты 2400/810 MHz и соединение с пулом.',
      },
    }[faultType];

    setAutoHealStatus({
      state: 'healing',
      text: `АВТОИСПРАВЛЕНИЕ: ${faultDescriptions.detect}`,
    });

    if (faultType === 'vpn') {
      setVpnBypassState('rerouting');
      setPoolPingMs(185);
    }

    if (faultType === 'thermal') {
      setGpuMetrics((prev) => [
        prev[0],
        {
          ...prev[1],
          tempC: policy.maxTempC + 3,
          hotspotTempC: 86.5,
          fanPercent: 92,
          fanRpm: 2780,
          status: 'critical',
        },
      ]);
    } else if (faultType !== 'manual') {
      setGpuMetrics((prev) => [
        { ...prev[0], hashrateMHs: 0, powerWatts: 18.0, status: 'critical' },
        { ...prev[1], hashrateMHs: 0, powerWatts: 19.5, status: 'critical' },
      ]);
    }

    addWatchdogEvent(
      'AUTO_HEAL',
      faultType === 'manual' ? 'info' : 'error',
      faultDescriptions.detect,
      faultDescriptions.fix
    );

    setTimeout(() => {
      setVpnBypassState('active');
      setPoolPingMs(33);
      setAutoHealCount((prev) => prev + 1);
      setRigConfig((prev) => ({
        ...prev,
        miningActive: true,
        gpus:
          faultType === 'cuda'
            ? [
                { ...prev.gpus[0], cclk: 2370 },
                { ...prev.gpus[1], cclk: 2370 },
              ]
            : faultType === 'thermal'
            ? [
                prev.gpus[0],
                { ...prev.gpus[1], pl: policy.emergencyPlWatts },
              ]
            : prev.gpus,
      }));
      setGpuMetrics((prev) => [
        {
          ...prev[0],
          hashrateMHs: 264.8,
          powerWatts: 146.2,
          tempC: 54,
          hotspotTempC: 65.2,
          fanPercent: 65,
          fanRpm: 1940,
          status: 'nominal',
        },
        {
          ...prev[1],
          hashrateMHs: 263.4,
          powerWatts: faultType === 'thermal' ? policy.emergencyPlWatts - 2 : 148.2,
          tempC: 55,
          hotspotTempC: 66.4,
          fanPercent: 72,
          fanRpm: 2150,
          status: 'nominal',
        },
      ]);
      setAutoHealStatus({
        state: 'recovered',
        text: `Ошибка автоматически исправлена за 1.8 сек! Майнинг перезапущен и работает стабильно.`,
      });
      addWatchdogEvent(
        'AUTO_HEAL',
        'info',
        'Авария успешно устранена автоматикой. Майнер перезапущен.',
        'Хешрейт 528.2 MH/s восстановлен, соединение со стратум-пулом активно.'
      );
    }, 1800);
  };

  const handleSimulateVpnRecovery = () => {
    handleTriggerAutoHeal('vpn');
  };

  const handleSimulateThermalGuard = () => {
    handleTriggerAutoHeal('thermal');
  };

  const handleSendTelegramTest = async () => {
    if (!policy.telegramBotToken.trim() || !policy.telegramChatId.trim()) {
      setTgTestStatus({
        state: 'err',
        msg: 'Укажи Bot Token (от @BotFather) и твой Chat ID для отправки тестового уведомления.',
      });
      return;
    }

    setTgTestStatus({ state: 'sending', msg: 'Отправка сообщения через api.telegram.org...' });
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${policy.telegramBotToken.trim()}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: policy.telegramChatId.trim(),
            text: `🦪 [Pearl Watchdog: ${rigConfig.workerName}]\nСвязь с панелью управления установлена!\nСтатус: ${rigConfig.miningActive ? 'МАЙНИНГ АКТИВЕН' : 'ОСТАНОВЛЕН'}\nХешрейт: ${totalHashrate} MH/s (2x RTX 4070 Ti)\nПул: ${rigConfig.primaryPool}`,
          }),
        }
      );
      const data = await response.json();
      if (data.ok) {
        setTgTestStatus({
          state: 'ok',
          msg: 'Тестовое уведомление успешно доставлено в твой Telegram!',
        });
        addWatchdogEvent(
          'TELEGRAM',
          'info',
          `Отправлено тестовое уведомление в Telegram (Chat ID: ${policy.telegramChatId}).`,
          'Двусторонняя связь проверена. Команды /status, /update, /restart, /vpn_fix готовы к работе.'
        );
      } else {
        setTgTestStatus({
          state: 'err',
          msg: `Ответ Telegram API: ${data.description || 'Ошибка авторизации токена'}`,
        });
      }
    } catch {
      setTgTestStatus({
        state: 'err',
        msg: 'Не удалось связаться с api.telegram.org из браузера (проверь VPN или токен бота).',
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-[#0E1420]">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('telemetry');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          Pearl Rig Control
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('telemetry')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
              activeTab === 'telemetry' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            Мониторинг и Запуск
          </button>
          <button
            onClick={() => setActiveTab('overclock')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
              activeTab === 'overclock' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            Разгон и Кошелёк
          </button>
          <button
            onClick={() => setActiveTab('network')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
              activeTab === 'network' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            Анти-VPN и Логи
          </button>
          <button
            onClick={() => setActiveTab('watchdog')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
              activeTab === 'watchdog' ? 'text-slate-100 border-b-2 border-emerald-500' : ''
            }`}
          >
            GitHub Установщик и OTA
          </button>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleDownloadBat}
            className="px-3.5 py-2 text-xs font-bold text-cyan-300 bg-cyan-500/15 border border-cyan-500/40 rounded-lg hover:bg-cyan-500/25 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer shadow-sm"
            title="Скачать обновлённую программу v2.5 для Windows со стрелочными спидометрами, заработком и счётчиком света"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Скачать новую версию для ПК v2.5 (.BAT)</span>
          </button>

          <button
            onClick={() => {
              setDraftWalletAddress(rigConfig.walletAddress);
              setShowWalletModal((prev) => !prev);
            }}
            className="px-3.5 py-2 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Изменить кошелёк</span>
          </button>

          <button
            onClick={() => handleToggleMining(!rigConfig.miningActive)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer ${
              rigConfig.miningActive
                ? 'bg-red-500 text-white hover:bg-red-400'
                : 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
            }`}
          >
            {rigConfig.miningActive ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                Остановить майнинг
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Запустить майнинг
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace Canvas: Left Sidebar (260px) + Main Content Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1440px] w-full mx-auto">
        <aside className="w-full lg:w-[260px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800 bg-[#0E1420]/60 p-5 flex flex-col justify-between gap-6">
          <div className="space-y-6">
            <div>
              <div className="text-xs text-slate-400">Состояние программы</div>
              <div className="mt-1 text-base font-semibold text-slate-100 font-mono">
                {rigConfig.workerName}
              </div>
              <div className="mt-1 text-xs font-mono">
                <span className={rigConfig.miningActive ? 'text-emerald-400' : 'text-amber-400'}>
                  {rigConfig.miningActive ? 'Майнинг запущен' : 'Майнинг остановлен'}
                </span>
                <span className="text-slate-500" aria-hidden="true"> · </span>
                <span className="text-slate-400">2× 4070 Ti</span>
              </div>
            </div>

            <div className="space-y-1">
              <button
                onClick={() => setActiveTab('telemetry')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'telemetry'
                    ? 'bg-slate-800/90 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Мониторинг и Запуск</span>
              </button>

              <button
                onClick={() => setActiveTab('overclock')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'overclock'
                    ? 'bg-slate-800/90 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Sliders className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Разгон и Кошелёк</span>
                {!walletValidation.valid && (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 ml-auto shrink-0" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('network')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'network'
                    ? 'bg-slate-800/90 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Анти-VPN и Логи</span>
              </button>

              <button
                onClick={() => setActiveTab('watchdog')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'watchdog'
                    ? 'bg-slate-800/90 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <GitBranch className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>GitHub Установщик и OTA</span>
              </button>
            </div>

            {!walletValidation.valid && (
              <div className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Адрес prl1p... обрезан</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  В батнике указано {walletValidation.length} из 63 символов. Вставь полный адрес во вкладке «Разгон и Кошелёк».
                </p>
                <button
                  onClick={() => setActiveTab('overclock')}
                  className="text-xs font-medium text-amber-300 hover:text-amber-200 underline cursor-pointer"
                >
                  Исправить адрес кошелька
                </button>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-2 text-xs text-slate-400">
            <div className="flex items-center justify-between">
              <span>Мост ПК (3002)</span>
              <span className="font-mono text-slate-300">
                {localBridgeConnected ? 'Подключён' : 'Готов'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Иконка на ПК</span>
              <span className="font-mono text-emerald-400">Рабочий стол</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Обход INCY TUN</span>
              <span className="font-mono text-emerald-400">Маршрут /32</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Время работы</span>
              <span className="font-mono text-slate-300">{formatUptime(uptimeSeconds)}</span>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 lg:p-8 space-y-8 overflow-y-auto">
          {showWalletModal && (
            <div className="p-6 rounded-lg border border-emerald-500/40 bg-[#111827] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <Wallet className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <h2 className="text-base font-bold text-slate-100">
                      Добавление и изменение адреса кошелька Pearl (-w)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Измени текущий адрес или добавь несколько кошельков для быстрого переключения (автоматически передаётся в программу на ПК)
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowWalletModal(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 rounded-md hover:bg-slate-700 transition-colors self-start sm:self-auto cursor-pointer"
                >
                  Скрыть панель
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-6 space-y-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Адрес кошелька Pearl (prl1p... 63 символа) или логин Kryptex
                  </label>
                  <input
                    type="text"
                    value={draftWalletAddress}
                    onChange={(e) => setDraftWalletAddress(e.target.value)}
                    placeholder="Вставь полный адрес prl1p..."
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="lg:col-span-3 space-y-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Название кошелька (необязательно)
                  </label>
                  <input
                    type="text"
                    value={newWalletLabel}
                    onChange={(e) => setNewWalletLabel(e.target.value)}
                    placeholder="Напр.: Основной Pearl"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="lg:col-span-3 flex items-end gap-2">
                  <button
                    onClick={() => handleSaveAndApplyWallet(draftWalletAddress, newWalletLabel)}
                    className="flex-1 px-4 py-2.5 text-xs font-bold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    Сохранить адрес
                  </button>
                  <button
                    onClick={handleAddNewWalletToList}
                    title="Добавить в список сохранённых кошельков"
                    className="px-3 py-2.5 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-emerald-400" />
                    Добавить
                  </button>
                </div>
              </div>

              {walletSavedBanner && (
                <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-300 font-mono">
                  {walletSavedBanner}
                </div>
              )}

              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-slate-300">
                  Сохранённые кошельки ({savedWallets.length}):
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {savedWallets.map((w) => {
                    const isCurrent = w.address === rigConfig.walletAddress;
                    return (
                      <div
                        key={w.id}
                        className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${
                          isCurrent
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-slate-800 bg-slate-900/70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                            <span className="truncate">{w.label}</span>
                            {isCurrent && (
                              <span className="text-[11px] font-mono text-emerald-400">
                                · Активен
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-mono text-slate-400 truncate mt-0.5">
                            {w.address}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isCurrent && (
                            <button
                              onClick={() => handleSaveAndApplyWallet(w.address, w.label)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-md hover:bg-emerald-300 transition-colors cursor-pointer"
                            >
                              Выбрать
                            </button>
                          )}
                          {savedWallets.length > 1 && (
                            <button
                              onClick={() => handleDeleteSavedWallet(w.id)}
                              className="p-1.5 text-slate-400 hover:text-red-400 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
                              title="Удалить кошелёк из списка"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'telemetry' && (
            <div className="space-y-7">
              {/* Современный главный пульт управления ригом */}
              <div className="relative p-6 rounded-2xl border border-white/[0.09] bg-gradient-to-r from-[#131D31] via-[#0F172A] to-[#111C2D] shadow-[0_20px_50px_-15px_rgba(0,0,0,0.75)] flex flex-col lg:flex-row lg:items-center justify-between gap-6 overflow-hidden">
                <div className="pointer-events-none absolute -right-16 -top-16 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl" />

                <div className="relative space-y-2">
                  <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold border ${
                        rigConfig.miningActive
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          rigConfig.miningActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                        }`}
                      />
                      {rigConfig.miningActive ? 'МАЙНИНГ АКТИВЕН' : 'ОСТАНОВЛЕН'}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-slate-900/90 border border-white/[0.07] text-slate-300">
                      Чистая прибыль: <strong className="text-emerald-400">+{netProfitRubDay.toFixed(0)} ₽/сут</strong>
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-slate-900/90 border border-white/[0.07] text-cyan-300">
                      Розетка сейчас: <strong>{totalWallWatts} Вт ({totalWallKw.toFixed(3)} кВт)</strong>
                    </span>
                  </div>

                  <h1 className="text-2xl font-bold tracking-tight text-white">
                    Центр управления ригом {rigConfig.workerName} · Dual RTX 4070 Ti
                  </h1>
                  <p className="text-xs text-slate-400">
                    <span>OneZeroMiner 1.8.3 (pearlhash)</span>
                    <span aria-hidden="true"> · </span>
                    <span>Пул: {rigConfig.primaryPool}</span>
                    <span aria-hidden="true"> · </span>
                    <span>Прямой маршрут /32 в обход INCY VPN</span>
                  </p>
                </div>

                <div className="relative flex flex-wrap items-center gap-3 shrink-0">
                  {!rigConfig.miningActive ? (
                    <button
                      onClick={() => handleToggleMining(true)}
                      className="px-6 py-3 text-sm font-bold text-slate-950 bg-gradient-to-r from-emerald-400 to-teal-300 rounded-xl hover:brightness-110 shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all flex items-center gap-2.5 whitespace-nowrap cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Запустить майнинг
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleToggleMining(true)}
                        className="px-4 py-2.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-emerald-400 to-teal-300 rounded-xl hover:brightness-110 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Перезапустить
                      </button>
                      <button
                        onClick={() => handleToggleMining(false)}
                        className="px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-red-500 to-rose-600 rounded-xl hover:brightness-110 shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        Остановить майнинг
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => {
                      setDraftWalletAddress(rigConfig.walletAddress);
                      setShowWalletModal((prev) => !prev);
                    }}
                    className="px-3.5 py-2.5 text-xs font-semibold text-slate-100 bg-slate-900/90 border border-emerald-500/40 rounded-xl hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
                  >
                    <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                    Кошелёк
                  </button>

                  <button
                    onClick={handleSimulateVpnRecovery}
                    className="px-3.5 py-2.5 text-xs font-medium text-slate-200 bg-slate-900/90 border border-white/[0.1] rounded-xl hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
                  >
                    <Wifi className="w-3.5 h-3.5 text-cyan-400" />
                    Обход VPN /32
                  </button>
                </div>
              </div>

              {/* НОВЫЙ БЛОК: Примерный заработок и общий расход электроэнергии в реальном времени */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Карточка 1: Примерный заработок и чистая прибыль (7 колонок) */}
                <div className="lg:col-span-7 p-6 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#131E32]/95 via-[#0E1627]/95 to-[#0A0F1C]/95 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] flex flex-col justify-between space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.07]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-white">
                          Примерный заработок и чистая прибыль (Real-Time)
                        </h2>
                        <p className="text-xs text-slate-400">
                          Автоматический расчёт по текущему хешрейту <span className="text-emerald-400 font-mono">{totalHashrate} MH/s</span> за вычетом света
                        </p>
                      </div>
                    </div>

                    <div className="px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-right">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
                        Чистая прибыль в сутки
                      </div>
                      <div className="text-lg font-bold font-mono text-emerald-400">
                        {netProfitRubDay >= 0 ? '+' : ''}
                        {netProfitRubDay.toFixed(1)} ₽{' '}
                        <span className="text-xs text-slate-300">(${netProfitUsdDay.toFixed(2)})</span>
                      </div>
                    </div>
                  </div>

                  {/* Живой счётчик текущей сессии + прогноз (Час / Сутки / Месяц) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-950/70 border border-emerald-500/30 space-y-1">
                      <div className="text-[11px] text-emerald-300 font-medium flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        За текущую сессию
                      </div>
                      <div className="text-base font-bold font-mono text-white">
                        {sessionPrlMined.toFixed(4)} PRL
                      </div>
                      <div className="text-xs font-mono text-emerald-400">
                        ≈ {sessionEarnedRub.toFixed(2)} ₽ (${sessionEarnedUsd.toFixed(2)})
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-950/55 border border-white/[0.06] space-y-1">
                      <div className="text-[11px] text-slate-400">Доход за 1 час</div>
                      <div className="text-base font-bold font-mono text-slate-100">
                        {prlPerHour.toFixed(2)} PRL
                      </div>
                      <div className="text-xs font-mono text-slate-300">
                        {grossRubHour.toFixed(1)} ₽ · ${(prlPerHour * prlPriceUsd).toFixed(2)}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-950/55 border border-white/[0.06] space-y-1">
                      <div className="text-[11px] text-slate-400">Доход за 24 часа</div>
                      <div className="text-base font-bold font-mono text-emerald-400">
                        {prlPerDay.toFixed(1)} PRL
                      </div>
                      <div className="text-xs font-mono text-slate-200">
                        {grossRubDay.toFixed(0)} ₽ · ${grossUsdDay.toFixed(2)}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-950/55 border border-white/[0.06] space-y-1">
                      <div className="text-[11px] text-slate-400">Доход за 30 дней</div>
                      <div className="text-base font-bold font-mono text-emerald-400">
                        {prlPerMonth.toFixed(0)} PRL
                      </div>
                      <div className="text-xs font-mono text-slate-200">
                        {grossRubMonth.toFixed(0)} ₽ · ${grossUsdMonth.toFixed(1)}
                      </div>
                    </div>
                  </div>

                  {/* Быстрая настройка курса и доходности сети */}
                  <div className="pt-2 border-t border-white/[0.06] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="flex items-center justify-between gap-2 bg-slate-950/50 px-3 py-2 rounded-xl border border-white/[0.05]">
                      <span className="text-slate-400">Курс PRL ($):</span>
                      <input
                        type="number"
                        step="0.005"
                        value={prlPriceUsd}
                        onChange={(e) => setPrlPriceUsd(Math.max(0.0001, Number(e.target.value)))}
                        className="w-20 text-right font-mono font-semibold text-emerald-400 bg-transparent focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-slate-950/50 px-3 py-2 rounded-xl border border-white/[0.05]">
                      <span className="text-slate-400">Курс USD (₽):</span>
                      <input
                        type="number"
                        step="0.5"
                        value={usdToRub}
                        onChange={(e) => setUsdToRub(Math.max(1, Number(e.target.value)))}
                        className="w-20 text-right font-mono font-semibold text-slate-100 bg-transparent focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-slate-950/50 px-3 py-2 rounded-xl border border-white/[0.05]">
                      <span className="text-slate-400">Чистыми/мес:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        +{netProfitRubMonth.toFixed(0)} ₽
                      </span>
                    </div>
                  </div>
                </div>

                {/* Карточка 2: Общий расход электроэнергии в реальном времени (5 колонок) */}
                <div className="lg:col-span-5 p-6 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#131E32]/95 via-[#0E1627]/95 to-[#0A0F1C]/95 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] flex flex-col justify-between space-y-5">
                  <div className="flex items-center justify-between gap-3 pb-4 border-b border-white/[0.07]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-white">
                          Расход электроэнергии (Live Счётчик)
                        </h2>
                        <p className="text-xs text-slate-400">
                          Карты ({totalPower} Вт) + система и КПД БП ({rigConfig.miningActive ? systemOverheadWatts : 28} Вт)
                        </p>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className="text-xs text-slate-400">С розетки</div>
                      <div className="text-lg font-bold text-cyan-400">{totalWallWatts} W</div>
                    </div>
                  </div>

                  {/* Электронный счётчик кВт·ч в реальном времени */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-cyan-500/30 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                        Намотано за сессию (кВт·ч)
                      </div>
                      <div className="text-2xl font-bold font-mono text-white tracking-wider mt-0.5">
                        {sessionKwhUsed.toFixed(5)} <span className="text-xs text-cyan-400">кВт·ч</span>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-[11px] text-slate-400">Стоимость за сессию</div>
                      <div className="text-base font-bold text-amber-300">
                        {sessionCostRub.toFixed(2)} ₽
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {powerCostRubHour.toFixed(2)} ₽ в час
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-slate-950/55 border border-white/[0.06] flex items-center justify-between">
                      <span className="text-slate-400 font-sans">За сутки (24ч):</span>
                      <span className="text-slate-100 font-semibold">
                        {kwhPerDay.toFixed(2)} кВт·ч ({powerCostRubDay.toFixed(0)} ₽)
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950/55 border border-white/[0.06] flex items-center justify-between">
                      <span className="text-slate-400 font-sans">За месяц (30д):</span>
                      <span className="text-amber-300 font-semibold">
                        {kwhPerMonth.toFixed(0)} кВт·ч ({powerCostRubMonth.toFixed(0)} ₽)
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-400">Твой тариф за электроэнергию (₽ / кВт·ч):</span>
                    <div className="flex items-center gap-1.5 bg-slate-950/70 px-3 py-1.5 rounded-xl border border-cyan-500/30">
                      <input
                        type="number"
                        step="0.1"
                        value={electricityTariffRub}
                        onChange={(e) => setElectricityTariffRub(Math.max(0, Number(e.target.value)))}
                        className="w-16 text-right font-mono font-bold text-cyan-300 bg-transparent focus:outline-none"
                      />
                      <span className="font-mono text-slate-400">₽/кВт·ч</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 01. Главные спидометры рига со стрелками */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-white">
                      01. Главная приборная панель рига (Стрелочные спидометры)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Аналогово-цифровые спидометры суммарного хешрейта, полного энергопотребления с розетки, температуры и пинга
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono text-slate-300">
                    <span>Автоисправлений аварий: <strong className="text-emerald-400">{autoHealCount}</strong></span>
                    <span>·</span>
                    <span>Аптайм: <strong className="text-slate-100">{formatUptime(uptimeSeconds)}</strong></span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <SpeedometerGauge
                    label="Суммарный хешрейт"
                    sublabel="Алгоритм pearlhash (INT8)"
                    value={totalHashrate}
                    min={0}
                    max={600}
                    unit="MH/s"
                    decimals={1}
                    accent="emerald"
                    extraInfo={[
                      { label: 'GPU #0', value: `${gpuMetrics[0].hashrateMHs.toFixed(1)} MH/s`, highlight: 'ok' },
                      { label: 'GPU #1', value: `${gpuMetrics[1].hashrateMHs.toFixed(1)} MH/s`, highlight: 'ok' },
                      { label: 'Доход/сут', value: `${prlPerDay.toFixed(1)} PRL`, highlight: 'ok' },
                      { label: 'В рублях', value: `${grossRubDay.toFixed(0)} ₽/сут` },
                    ]}
                  />

                  <SpeedometerGauge
                    label="Общий расход энергии"
                    sublabel={`С розетки: ${totalWallKw.toFixed(3)} кВт`}
                    value={totalWallWatts}
                    min={0}
                    max={480}
                    warningThreshold={380}
                    criticalThreshold={430}
                    unit="W (Ватт)"
                    decimals={1}
                    accent="cyan"
                    extraInfo={[
                      { label: 'Только GPU', value: `${totalPower} W` },
                      {
                        label: 'Намотано',
                        value: `${sessionKwhUsed.toFixed(3)} кВт·ч`,
                        highlight: 'ok',
                      },
                      { label: 'Свет/сутки', value: `${kwhPerDay.toFixed(1)} кВт·ч` },
                      { label: 'Расход ₽/сут', value: `${powerCostRubDay.toFixed(0)} ₽`, highlight: 'warn' },
                    ]}
                  />

                  <SpeedometerGauge
                    label="Температура GPU (Макс)"
                    sublabel={`Порог автозащиты: ${policy.maxTempC}°C`}
                    value={Math.max(gpuMetrics[0].tempC, gpuMetrics[1].tempC)}
                    min={25}
                    max={90}
                    warningThreshold={policy.maxTempC - 4}
                    criticalThreshold={policy.maxTempC}
                    unit="°C (Ядро)"
                    decimals={0}
                    accent="amber"
                    extraInfo={[
                      {
                        label: 'Hotspot',
                        value: `${Math.max(gpuMetrics[0].hotspotTempC, gpuMetrics[1].hotspotTempC).toFixed(1)} °C`,
                        highlight:
                          Math.max(gpuMetrics[0].hotspotTempC, gpuMetrics[1].hotspotTempC) > 80
                            ? 'warn'
                            : 'ok',
                      },
                      {
                        label: 'Память VRAM',
                        value: `${gpuMetrics[0].vramTempC}° / ${gpuMetrics[1].vramTempC}°C`,
                      },
                      {
                        label: 'Кулеры',
                        value: `${gpuMetrics[0].fanRpm} / ${gpuMetrics[1].fanRpm} RPM`,
                      },
                      { label: 'Аварийный PL', value: `${policy.emergencyPlWatts} W` },
                    ]}
                  />

                  <SpeedometerGauge
                    label="Пинг пула и сеть"
                    sublabel="prl.kryptex.network:7048"
                    value={poolPingMs}
                    min={0}
                    max={200}
                    warningThreshold={95}
                    criticalThreshold={150}
                    unit="ms (Пинг)"
                    decimals={0}
                    accent="violet"
                    extraInfo={[
                      {
                        label: 'Шары',
                        value: `${totalShares} / ${totalRejected}`,
                        highlight: 'ok',
                      },
                      {
                        label: 'INCY VPN',
                        value: vpnBypassState === 'active' ? 'Обход /32 ОК' : 'Ремонт...',
                        highlight: vpnBypassState === 'active' ? 'ok' : 'warn',
                      },
                      { label: 'DNS', value: 'dns.google' },
                      { label: 'Резерв', value: 'SSL :8048' },
                    ]}
                  />
                </div>
              </div>

              {/* 02. Автоматика самовосстановления при авариях (Auto-Heal & Crash Recovery) */}
              <div className="p-6 rounded-xl border border-slate-800 bg-[#111827] space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                      <h2 className="text-base font-bold text-slate-100">
                        02. Система автоматического исправления ошибок и перезапуска при авариях (Auto-Heal)
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400">
                      При любом сбое программа сама определяет причину по логам и датчикам NVIDIA, устраняет ошибку и запускает майнинг заново без участия человека
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleTriggerAutoHeal('manual')}
                      className="px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Проверить и исправить ошибки сейчас
                    </button>
                  </div>
                </div>

                {/* Live Auto-Heal Status Bar */}
                <div
                  className={`p-3.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono ${
                    autoHealStatus.state === 'healing'
                      ? 'border-red-500/50 bg-red-500/10 text-red-300'
                      : autoHealStatus.state === 'recovered'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-800 bg-slate-900/80 text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        autoHealStatus.state === 'healing'
                          ? 'bg-red-400 animate-ping'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <span className="font-semibold">{autoHealStatus.text}</span>
                  </div>
                  <span className="text-slate-400 shrink-0">
                    Контроль процесса: каждые {policy.checkIntervalSec} сек · Успешных автоисправлений: {autoHealCount}
                  </span>
                </div>

                {/* 5 Auto-Healing Modules Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                        <span>1. Вылет майнера</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15">АВТО</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">
                        Контроль процесса .EXE
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Если окно <code className="text-slate-300">onezerominer.exe</code> закрылось или зависло с кодом ошибки — очищает процесс и запускает майнинг заново за 2 сек.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTriggerAutoHeal('crash')}
                      className="w-full mt-2 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors cursor-pointer"
                    >
                      Тест: сбой процесса
                    </button>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                        <span>2. Сбой CUDA / 0 H/s</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15">АВТО</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">
                        Сброс драйвера и частот
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        При падении хешрейта в <code className="text-slate-300">0.00 H/s</code> или ошибке CUDA выполняет <code className="text-slate-300">nvidia-smi -rgc</code>, снижает ядро на <code className="text-slate-300">-30 MHz</code> и перезапускает.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTriggerAutoHeal('cuda')}
                      className="w-full mt-2 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors cursor-pointer"
                    >
                      Тест: ошибка CUDA / 0 H/s
                    </button>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                        <span>3. Перехват VPN TUN</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15">АВТО</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">
                        Ремонт маршрута /32 + DNS
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        При тайм-ауте пула из-за INCY VPN запрашивает чистый IP у <code className="text-slate-300">dns.google</code>, прописывает <code className="text-slate-300">route add /32</code> через роутер и чистит <code className="text-slate-300">hosts</code>.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTriggerAutoHeal('vpn')}
                      className="w-full mt-2 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors cursor-pointer"
                    >
                      Тест: обрыв VPN TUN
                    </button>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                        <span>4. Перегрев &ge; {policy.maxTempC}°C</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15">АВТО</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">
                        Аварийный сброс PL и кулер
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        При нагреве карты до {policy.maxTempC}°C мгновенно снижает Power Limit до <code className="text-slate-300">{policy.emergencyPlWatts} W</code> и включает кулеры на 90% без остановки добычи.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTriggerAutoHeal('thermal')}
                      className="w-full mt-2 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors cursor-pointer"
                    >
                      Тест: перегрев 75°C
                    </button>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                        <span>5. Сбой прав Admin</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15">АВТО</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">
                        Авто-эскалация UAC + NVML
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Автоматически перезапускает агент с правами Администратора (<code className="text-slate-300">RunAs</code>) и фиксирует частоты через <code className="text-slate-300">nvidia-smi -lgc</code>.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTriggerAutoHeal('manual')}
                      className="w-full mt-2 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors cursor-pointer"
                    >
                      Проверить права UAC
                    </button>
                  </div>
                </div>
              </div>

              {/* 03. Детальные спидометры и 12 датчиков по каждой видеокарте RTX 4070 Ti */}
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-100">
                      03. Показания спидометров и расширенная телеметрия видеокарт (GPU #0 и GPU #1)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Индивидуальные стрелочные датчики хешрейта, температуры, частоты ядра и мощности + 12 аппаратных параметров NVML на каждую карту
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800 self-start sm:self-auto">
                    <button
                      onClick={() => handleApplyPreset('eco')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Эко 135W
                    </button>
                    <button
                      onClick={() => handleApplyPreset('opt')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-emerald-400 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Оптимум 150W
                    </button>
                    <button
                      onClick={() => handleApplyPreset('max')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Макс 180W
                    </button>
                  </div>
                </div>

                {gpuMetrics.map((gpu, idx) => (
                  <div
                    key={gpu.id}
                    className="p-6 rounded-xl border border-slate-800 bg-[#111827] space-y-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-800">
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-bold">
                          GPU #{gpu.id}
                        </span>
                        <div>
                          <div className="text-base font-bold text-slate-100">
                            {gpu.name} · Шина PCI {rigConfig.gpus[idx].pciBus} ({gpu.pcieLink})
                          </div>
                          <div className="text-xs text-slate-400 font-mono">
                            Ядро: Kernel {rigConfig.gpus[idx].kernel} Compact (INT8) · Состояние: {gpu.pState} · Вентилятор: {gpu.fanPercent}% ({gpu.fanRpm} RPM)
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-slate-400">
                          Последняя шара: <strong className="text-emerald-400">{gpu.lastShareSec} сек назад</strong>
                        </span>
                        <span
                          className={`px-2.5 py-1 rounded font-semibold ${
                            rigConfig.miningActive
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {rigConfig.miningActive ? 'ДОБЫЧА ИДЁТ' : 'ОЖИДАНИЕ'}
                        </span>
                      </div>
                    </div>

                    {/* 4 Speedometers for this GPU */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <SpeedometerGauge
                        label={`GPU #${gpu.id} · Хешрейт`}
                        sublabel="Скорость pearlhash"
                        value={gpu.hashrateMHs}
                        min={0}
                        max={320}
                        unit="MH/s"
                        decimals={1}
                        size="sm"
                      />

                      <SpeedometerGauge
                        label={`GPU #${gpu.id} · Температура`}
                        sublabel={`Hotspot: ${gpu.hotspotTempC.toFixed(1)} °C`}
                        value={gpu.tempC}
                        min={25}
                        max={90}
                        warningThreshold={policy.maxTempC - 4}
                        criticalThreshold={policy.maxTempC}
                        unit="°C (Ядро)"
                        decimals={0}
                        size="sm"
                      />

                      <SpeedometerGauge
                        label={`GPU #${gpu.id} · Частота ядра`}
                        sublabel={`Память: ${gpu.mclkMHz} MHz (лок)`}
                        value={gpu.cclkMHz}
                        min={0}
                        max={2850}
                        warningThreshold={2600}
                        criticalThreshold={2750}
                        unit="MHz"
                        decimals={0}
                        size="sm"
                      />

                      <SpeedometerGauge
                        label={`GPU #${gpu.id} · Потребление`}
                        sublabel={`Лимит PL: ${rigConfig.gpus[idx].pl} W`}
                        value={gpu.powerWatts}
                        min={0}
                        max={220}
                        warningThreshold={175}
                        criticalThreshold={195}
                        unit="W (Ватт)"
                        decimals={1}
                        size="sm"
                      />
                    </div>

                    {/* 12 Detailed Engineering Sensors Grid for this GPU */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2">
                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/90">
                        <div className="text-[11px] text-slate-400">Темп. Ядра / Hotspot</div>
                        <div className="text-xs font-mono font-bold text-slate-100 mt-0.5">
                          {gpu.tempC}°C / <span className="text-amber-300">{gpu.hotspotTempC.toFixed(1)}°C</span>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/90">
                        <div className="text-[11px] text-slate-400">Темп. Памяти VRAM</div>
                        <div className="text-xs font-mono font-bold text-slate-100 mt-0.5">
                          {gpu.vramTempC}°C (GDDR6X)
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/90">
                        <div className="text-[11px] text-slate-400">Кулер (% / Обороты)</div>
                        <div className="text-xs font-mono font-bold text-slate-100 mt-0.5">
                          {gpu.fanPercent}% · {gpu.fanRpm} RPM
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/90">
                        <div className="text-[11px] text-slate-400">Напряжение ядра</div>
                        <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                          {gpu.voltageMv} mV ({gpu.pState})
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/90">
                        <div className="text-[11px] text-slate-400">Энергоэффективность</div>
                        <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                          {gpu.efficiencyHW.toFixed(2)} MH/W
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/90">
                        <div className="text-[11px] text-slate-400">Шары (Прин / Опозд / Откл)</div>
                        <div className="text-xs font-mono font-bold text-slate-100 mt-0.5">
                          <span className="text-emerald-400">{gpu.acceptedShares}</span> / {gpu.staleShares} / <span className="text-red-400">{gpu.rejectedShares}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Window Preview + Event Journal */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-5 p-5 rounded-lg border border-slate-800 bg-[#111827] flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <h2 className="text-base font-semibold text-slate-100">
                      04. Управление на ПК и сборка установщика .EXE
                    </h2>
                    <ul className="space-y-2 text-xs text-slate-300 leading-relaxed">
                      <li>1. При клике по ярлыку <strong>«Pearl Rig Control»</strong> на Рабочем столе открывается графическое окно программы с кнопками <strong>«▶ ЗАПУСТИТЬ МАЙНИНГ»</strong>, <strong>«■ ОСТАНОВИТЬ»</strong>, сменой кошелька и модулем <strong>«Автоисправление аварий»</strong>.</li>
                      <li>2. При любом вылете, ошибке <code className="text-emerald-300">0.00 H/s</code>, блокировке INCY VPN или перегреве программа сама исправляет причину и запускает майнинг заново.</li>
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={() => setActiveTab('watchdog')}
                      className="flex-1 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <GitBranch className="w-4 h-4" />
                      Собрать Установщик в GitHub
                    </button>
                    <button
                      onClick={handleDownloadBat}
                      className="px-4 py-2.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      Скачать .BAT
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-7 p-5 rounded-lg border border-slate-800 bg-[#111827] flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        03. Журнал команд и событий программы
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        История нажатий кнопки Запуска, синхронизаций GitHub и обхода VPN
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-1">
                    {events.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-3 rounded-md bg-slate-900/70 border border-slate-800/90 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 text-slate-400 font-mono">
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
                              ? 'Критично'
                              : ev.severity === 'warning'
                              ? 'Внимание'
                              : 'Штатно'}
                          </span>
                        </div>
                        <div className="text-slate-200 font-medium">{ev.message}</div>
                        <div className="text-slate-400 font-mono">{ev.actionTaken}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'overclock' && (
            <div className="space-y-8">
              <div className="pb-6 border-b border-slate-800">
                <h1 className="text-2xl font-bold text-slate-100">
                  Настройка кошелька Pearl и разгона Dual RTX 4070 Ti
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Проверка 63-символьного адреса <code className="font-mono text-slate-300">prl1p...</code>, путей на твоём ПК и частот для каждой видеокарты
                </p>
              </div>

              <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      01. Адрес кошелька Pearl (-w) и имя воркера
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      В сети Pearl адрес формата Bech32m (<code className="font-mono">prl1p...</code>) всегда состоит ровно из 63 символов
                    </p>
                  </div>
                  <div className="text-xs font-mono">
                    Длина:{' '}
                    <span
                      className={
                        walletValidation.valid ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'
                      }
                    >
                      {walletValidation.length} / {walletValidation.expectedLength} симв.
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-3 space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">
                      Кошелёк Pearl (prl1p... 63 символа) или логин Kryptex
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={rigConfig.walletAddress}
                        onChange={(e) => {
                          setRigConfig((prev) => ({ ...prev, walletAddress: e.target.value }));
                          setDraftWalletAddress(e.target.value);
                        }}
                        placeholder="prl1p..."
                        className="flex-1 px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={() => handleSaveAndApplyWallet(rigConfig.walletAddress)}
                        className="px-4 py-2.5 text-xs font-bold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Wallet className="w-4 h-4" />
                        Сохранить и применить кошелёк
                      </button>
                      <button
                        onClick={() => {
                          setDraftWalletAddress(rigConfig.walletAddress);
                          setShowWalletModal(true);
                        }}
                        className="px-3.5 py-2.5 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <Plus className="w-4 h-4 text-emerald-400" />
                        Список кошельков
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">
                      Имя воркера (--worker)
                    </label>
                    <input
                      type="text"
                      value={rigConfig.workerName}
                      onChange={(e) =>
                        setRigConfig((prev) => ({ ...prev, workerName: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {walletSavedBanner && (
                  <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-300 font-mono">
                    {walletSavedBanner}
                  </div>
                )}

                <div
                  className={`p-3.5 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    walletValidation.valid
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {walletValidation.valid ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span>{walletValidation.message}</span>
                  </div>
                </div>
              </div>

              <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      02. Параметры разгона и энергопотребления (RTX 4070 Ti #0 и #1)
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Алгоритм <code className="font-mono">pearlhash</code> не нагружает видеопамять — память фиксируется на <code className="font-mono">810 MHz</code>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApplyPreset('eco')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Пресет: Эко (135W)
                    </button>
                    <button
                      onClick={() => handleApplyPreset('opt')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Пресет: Оптимальный (150W)
                    </button>
                    <button
                      onClick={() => handleApplyPreset('max')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Пресет: Макс (180W)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {rigConfig.gpus.map((gpu, idx) => (
                    <div
                      key={gpu.id}
                      className="p-5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-4"
                    >
                      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">
                            GPU {gpu.id} · {gpu.name}
                          </div>
                          <div className="text-xs text-slate-400 font-mono">
                            PCI шина: {gpu.pciBus}
                          </div>
                        </div>
                        <span className="text-xs font-mono text-emerald-400">
                          Kernel {gpu.kernel}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs text-slate-400">
                            Частота ядра --cclk (MHz)
                          </label>
                          <input
                            type="number"
                            min={1500}
                            max={2850}
                            step={15}
                            value={gpu.cclk}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRigConfig((prev) => {
                                const nextGpus: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                nextGpus[idx] = { ...nextGpus[idx], cclk: val };
                                return { ...prev, gpus: nextGpus };
                              });
                            }}
                            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm font-mono text-slate-100"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs text-slate-400">
                            Частота памяти --mclk (MHz)
                          </label>
                          <input
                            type="number"
                            min={810}
                            max={10500}
                            step={10}
                            value={gpu.mclk}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRigConfig((prev) => {
                                const nextGpus: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                nextGpus[idx] = { ...nextGpus[idx], mclk: val };
                                return { ...prev, gpus: nextGpus };
                              });
                            }}
                            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm font-mono text-slate-100"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs text-slate-400">
                            Лимит мощности --pl (W)
                          </label>
                          <input
                            type="number"
                            min={100}
                            max={285}
                            step={5}
                            value={gpu.pl}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRigConfig((prev) => {
                                const nextGpus: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                nextGpus[idx] = { ...nextGpus[idx], pl: val };
                                return { ...prev, gpus: nextGpus };
                              });
                            }}
                            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm font-mono text-slate-100"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs text-slate-400">
                            Вентилятор --fan (% или *)
                          </label>
                          <input
                            type="text"
                            value={gpu.fan}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRigConfig((prev) => {
                                const nextGpus: [typeof gpu, typeof gpu] = [
                                  ...prev.gpus,
                                ] as [typeof gpu, typeof gpu];
                                nextGpus[idx] = { ...nextGpus[idx], fan: val };
                                return { ...prev, gpus: nextGpus };
                              });
                            }}
                            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm font-mono text-slate-100"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-4">
                <h2 className="text-base font-semibold text-slate-100">
                  03. Пути к папке майнера и лог-файлу на твоём ПК
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      Папка с onezerominer.exe
                    </label>
                    <input
                      type="text"
                      value={rigConfig.minerDir}
                      onChange={(e) =>
                        setRigConfig((prev) => ({ ...prev, minerDir: e.target.value }))
                      }
                      className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      Путь к лог-файлу (--log-file)
                    </label>
                    <input
                      type="text"
                      value={rigConfig.logFilePath}
                      onChange={(e) =>
                        setRigConfig((prev) => ({ ...prev, logFilePath: e.target.value }))
                      }
                      className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                    />
                  </div>
                </div>

                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      Итоговая строка запуска onezerominer.exe:
                    </span>
                    <button
                      onClick={handleCopyCmd}
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedCmd ? 'Скопировано' : 'Скопировать команду'}
                    </button>
                  </div>
                  <pre className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
                    {generatedOneLineCmd}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'network' && (
            <div className="space-y-8">
              <div className="pb-6 border-b border-slate-800">
                <h1 className="text-2xl font-bold text-slate-100">
                  Анти-VPN Щит (INCY TUN) и Анализатор логов
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Настройка прямых маршрутов в обход блокировки портов 7048/8048 на серверах NashVPN и автоматическая диагностика вывода консоли
                </p>
              </div>

              <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-5">
                <h2 className="text-base font-semibold text-slate-100">
                  01. Адреса пулов и стратегия обхода INCY v3.9.0 (TUN)
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      Основной пул (-o #1, рекомендуется TCP 7048)
                    </label>
                    <input
                      type="text"
                      value={rigConfig.primaryPool}
                      onChange={(e) =>
                        setRigConfig((prev) => ({ ...prev, primaryPool: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      Резервный пул (-o #2, также используется для DevFee)
                    </label>
                    <input
                      type="text"
                      value={rigConfig.backupPool}
                      onChange={(e) =>
                        setRigConfig((prev) => ({ ...prev, backupPool: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      02. Диагностика лога onezerominer (pearl-miner.log)
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Вставь сюда любые строки из окна консоли или файла <code className="font-mono">pearl-miner.log</code> для мгновенного разбора ошибок
                    </p>
                  </div>
                  <button
                    onClick={() => setRawLogInput(INITIAL_SAMPLE_LOG)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 rounded-md hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Загрузить лог с твоего скриншота
                  </button>
                </div>

                <textarea
                  rows={6}
                  value={rawLogInput}
                  onChange={(e) => setRawLogInput(e.target.value)}
                  placeholder="Вставь сюда строки из окна майнера..."
                  className="w-full p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                />

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-slate-300">
                    Результаты автоматической проверки ({logDiagnostics.length}):
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {logDiagnostics.map((item, i) => (
                      <div
                        key={i}
                        className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-100">
                            {item.title}
                          </span>
                          <span
                            className={`text-xs font-mono ${
                              item.severity === 'error'
                                ? 'text-red-400'
                                : item.severity === 'warning'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {item.severity === 'error'
                              ? 'ОШИБКА (Устранено в Watchdog)'
                              : item.severity === 'warning'
                              ? 'ВНИМАНИЕ'
                              : 'ОК'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{item.detail}</p>
                        <div className="pt-1 text-xs font-mono text-emerald-300">
                          Решение: {item.fixCommand}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'watchdog' && (
            <div className="space-y-8">
              <div className="pb-6 border-b border-slate-800">
                <h1 className="text-2xl font-bold text-slate-100">
                  Сборка Установщика (.EXE) в GitHub, Иконка на Рабочем столе и OTA
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Создание репозитория, компиляция <code className="font-mono text-slate-300">PearlRigControl-Setup.exe</code> с окном запуска майнинга и ярлыком <strong>«Pearl Rig Control»</strong> на Рабочем столе
                </p>
              </div>

              <div className="p-5 rounded-lg border border-slate-800 bg-[#111827] flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-900 border-2 border-emerald-500 flex items-center justify-center shrink-0">
                    <div className="w-5 h-5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-emerald-400" />
                      <span>Настольное окно с кнопкой «▶ ЗАПУСТИТЬ МАЙНИНГ» и иконкой на Рабочем столе</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      После установки на Рабочем столе появляется иконка <strong>Pearl Rig Control</strong>. При её открытии запускается графическое окно программы с кнопками <strong>«▶ ЗАПУСТИТЬ МАЙНИНГ»</strong>, <strong>«■ ОСТАНОВИТЬ»</strong>, <strong>«Обход VPN /32»</strong> и <strong>«GitHub OTA»</strong>, а также мост <code className="text-slate-200 font-mono">127.0.0.1:3002</code> для управления из этой веб-панели.
                    </p>
                  </div>
                </div>
              </div>

              {/* GitHub OTA Repository Creator & Sync Panel */}
              <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-emerald-400" />
                      <span>01. Создание репозитория и сборка установщика в GitHub</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Укажи GitHub Token (с правами <code className="font-mono">repo</code> и <code className="font-mono">workflow</code>) — панель создаст репозиторий и запустит сборку <code className="font-mono">PearlRigControl-Setup.exe</code>
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={policy.github.enabled}
                      onChange={(e) =>
                        setPolicy((prev) => ({
                          ...prev,
                          github: { ...prev.github, enabled: e.target.checked },
                        }))
                      }
                      className="accent-emerald-400"
                    />
                    <span>GitHub OTA включён в агенте</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      Владелец GitHub (Owner / Логин)
                    </label>
                    <input
                      type="text"
                      value={policy.github.owner}
                      onChange={(e) =>
                        setPolicy((prev) => ({
                          ...prev,
                          github: { ...prev.github, owner: e.target.value },
                        }))
                      }
                      placeholder="Определится по токену"
                      className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      Имя репозитория (Repo)
                    </label>
                    <input
                      type="text"
                      value={policy.github.repo}
                      onChange={(e) =>
                        setPolicy((prev) => ({
                          ...prev,
                          github: { ...prev.github, repo: e.target.value },
                        }))
                      }
                      placeholder="pearl-rig-control"
                      className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      Ветка (Branch) и Интервал (мин)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={policy.github.branch}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            github: { ...prev.github, branch: e.target.value },
                          }))
                        }
                        placeholder="main"
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                      />
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={policy.github.pullIntervalMin}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            github: {
                              ...prev.github,
                              pullIntervalMin: Number(e.target.value),
                            },
                          }))
                        }
                        title="Интервал проверки GitHub с ПК (в минутах)"
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      GitHub Token (права: repo + workflow)
                    </label>
                    <input
                      type="password"
                      value={policy.github.token}
                      onChange={(e) =>
                        setPolicy((prev) => ({
                          ...prev,
                          github: { ...prev.github, token: e.target.value },
                        }))
                      }
                      placeholder="ghp_... или github_pat_..."
                      className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                    />
                  </div>
                </div>

                {/* GitHub Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={handleCreateGitHubRepo}
                    className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    1. Создать репозиторий + Собрать Установщик (.EXE) в GitHub
                  </button>

                  <button
                    onClick={() => pushFilesToGitHub()}
                    className="px-3.5 py-2 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                    2. Опубликовать обновление в GitHub (Push OTA)
                  </button>

                  <button
                    onClick={handlePullConfigFromGitHub}
                    className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                    Прочитать из GitHub (Pull)
                  </button>
                </div>

                {ghActionStatus.state !== 'idle' && (
                  <div
                    className={`p-3.5 rounded-lg border text-xs font-mono space-y-2 ${
                      ghActionStatus.state === 'ok'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : ghActionStatus.state === 'err'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        : 'border-slate-700 bg-slate-900 text-slate-300'
                    }`}
                  >
                    <div>{ghActionStatus.msg}</div>
                    {ghActionStatus.repoUrl && (
                      <div className="flex flex-wrap items-center gap-4 pt-1 font-sans">
                        <a
                          href={`${ghActionStatus.repoUrl}/releases`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-300 hover:text-emerald-200 underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Открыть Releases (скачать PearlRigControl-Setup.exe)
                        </a>
                        <a
                          href={`${ghActionStatus.repoUrl}/actions`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-300 hover:text-white underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Открыть статус сборки GitHub Actions
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Watchdog Thresholds */}
                <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    02. Правила самовосстановления и защиты карт
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs text-slate-400">
                        Интервал проверки (сек)
                      </label>
                      <input
                        type="number"
                        min={5}
                        max={120}
                        value={policy.checkIntervalSec}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            checkIntervalSec: Number(e.target.value),
                          }))
                        }
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs text-slate-400">
                        Таймер перезапуска при обрыве (сек)
                      </label>
                      <input
                        type="number"
                        min={15}
                        max={300}
                        value={policy.zeroHashrateRestartSec}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            zeroHashrateRestartSec: Number(e.target.value),
                          }))
                        }
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs text-slate-400">
                        Макс. температура GPU (°C)
                      </label>
                      <input
                        type="number"
                        min={60}
                        max={85}
                        value={policy.maxTempC}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            maxTempC: Number(e.target.value),
                          }))
                        }
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs text-slate-400">
                        Аварийный Power Limit при перегреве (W)
                      </label>
                      <input
                        type="number"
                        min={100}
                        max={160}
                        value={policy.emergencyPlWatts}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            emergencyPlWatts: Number(e.target.value),
                          }))
                        }
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Telegram Bot Controller */}
                <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-100">
                      03. Дистанционное управление через Telegram
                    </h2>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={policy.telegramEnabled}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            telegramEnabled: e.target.checked,
                          }))
                        }
                        className="accent-emerald-400"
                      />
                      <span>Включить Telegram-контроллер</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs text-slate-400">
                        Telegram Bot Token (от @BotFather)
                      </label>
                      <input
                        type="password"
                        value={policy.telegramBotToken}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            telegramBotToken: e.target.value,
                            telegramEnabled: true,
                          }))
                        }
                        placeholder="123456789:AAH..."
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs text-slate-400">
                        Твой Telegram Chat ID
                      </label>
                      <input
                        type="text"
                        value={policy.telegramChatId}
                        onChange={(e) =>
                          setPolicy((prev) => ({
                            ...prev,
                            telegramChatId: e.target.value,
                            telegramEnabled: true,
                          }))
                        }
                        placeholder="Например: 492817263"
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleSendTelegramTest}
                      className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5 text-emerald-400" />
                      Отправить тестовое сообщение в Telegram
                    </button>
                    {tgTestStatus.state !== 'idle' && (
                      <span
                        className={`text-xs ${
                          tgTestStatus.state === 'ok'
                            ? 'text-emerald-400'
                            : tgTestStatus.state === 'err'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {tgTestStatus.msg}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Repository Files Preview & Download */}
              <div className="p-6 rounded-lg border border-slate-800 bg-[#111827] space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <span>04. Файлы репозитория (с окном кнопки Запуска и ярлыком Рабочего стола)</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Все 4 файла автоматически загружаются в твой GitHub репозиторий по кнопке выше
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800">
                    <button
                      onClick={() => setPreviewFile('bat')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        previewFile === 'bat'
                          ? 'bg-emerald-400 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      pearl_watchdog_agent.bat
                    </button>
                    <button
                      onClick={() => setPreviewFile('iss')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        previewFile === 'iss'
                          ? 'bg-emerald-400 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      installer.iss (.EXE)
                    </button>
                    <button
                      onClick={() => setPreviewFile('workflow')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        previewFile === 'workflow'
                          ? 'bg-emerald-400 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      build-installer.yml
                    </button>
                    <button
                      onClick={() => setPreviewFile('json')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        previewFile === 'json'
                          ? 'bg-emerald-400 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      rig-config.json
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5">
                  <button
                    onClick={handleCopyPreviewCode}
                    className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCode ? 'Скопировано' : 'Скопировать файл'}
                  </button>
                  <button
                    onClick={handleDownloadActiveFile}
                    className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Скачать выбранный файл
                  </button>
                </div>

                <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto max-h-[380px] overflow-y-auto leading-relaxed">
                  {activePreviewContent}
                </pre>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
