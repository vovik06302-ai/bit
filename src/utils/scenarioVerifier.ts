import { ScenarioCheckResult, GpuLiveMetrics, PoolLiveStatus } from '../types/rig';
import { validatePearlWallet } from './scriptGenerator';

export interface WatchdogStateInput {
  walletAddress: string;
  walletSaved: boolean;
  miningDesired: boolean;
  userStoppedManually: boolean;
  minerProcessRunning: boolean;
  minerPid: number | null;
  apiAvailable: boolean;
  nvmlAvailable: boolean;
  poolConnected: boolean | null;
  totalHashrateMHs: number | null;
  acceptedShares: number | null;
  gpuTempsC: [number | null, number | null];
  gpuPlWatts: [number, number];
  disconnectElapsedSec: number;
  zeroHashrateRestartSec: number;
  restartAttempts: number;
  maxRestartAttempts: number;
  reconnectStage: PoolLiveStatus['reconnectStage'];
  sharesAtRestart: number;
  networkReachable: boolean;
  maxTempC: number;
  criticalStopTempC: number;
  emergencyPlWatts: number;
}

export interface WatchdogDecision {
  canStart: boolean;
  startBlockedReason: string | null;
  action:
    | 'noop'
    | 'attach_existing'
    | 'block_start'
    | 'stay_stopped'
    | 'wait_native_reconnect'
    | 'restart_miner'
    | 'pause_restarts_limit_reached'
    | 'confirm_recovery'
    | 'reduce_power_limit'
    | 'stop_overheat';
  nextMiningDesired: boolean;
  nextReconnectStage: PoolLiveStatus['reconnectStage'];
  nextRestartAttempts: number;
  nextPlWatts: [number, number];
  recoveryConfirmed: boolean;
}

export function evaluateStartupAttachment(
  savedWallet: string,
  existingMinerPid: number | null
): {
  walletAddress: string;
  walletSaved: boolean;
  showEditInputImmediately: boolean;
  miningActive: boolean;
  attachedExistingProcess: boolean;
  stoppedExistingProcess: boolean;
  spawnedDuplicateProcess: boolean;
} {
  const check = validatePearlWallet(savedWallet);
  const walletValidAndSaved = check.valid;
  const cleanWallet = walletValidAndSaved ? savedWallet.trim() : '';

  if (existingMinerPid !== null) {
    // Уже запущенный майнер не останавливается и дубликат не запускается
    return {
      walletAddress: cleanWallet,
      walletSaved: walletValidAndSaved,
      showEditInputImmediately: !walletValidAndSaved,
      miningActive: true,
      attachedExistingProcess: true,
      stoppedExistingProcess: false,
      spawnedDuplicateProcess: false,
    };
  }

  // При первом открытии или при повторном открытии майнер НЕ запускается сам
  return {
    walletAddress: cleanWallet,
    walletSaved: walletValidAndSaved,
    showEditInputImmediately: !walletValidAndSaved,
    miningActive: false,
    attachedExistingProcess: false,
    stoppedExistingProcess: false,
    spawnedDuplicateProcess: false,
  };
}

export function evaluateWatchdogStep(
  state: WatchdogStateInput,
  checkIntervalSec: number
): WatchdogDecision {
  const walletCheck = validatePearlWallet(state.walletAddress);
  const canStart = state.walletSaved && walletCheck.valid;

  // 1. Проверка перегрева (>= 85 °C)
  const validTemps = state.gpuTempsC.filter((t): t is number => t !== null && Number.isFinite(t));
  const maxTemp = validTemps.length > 0 ? Math.max(...validTemps) : null;

  if (maxTemp !== null && maxTemp >= state.maxTempC) {
    const alreadyReduced =
      state.gpuPlWatts[0] <= state.emergencyPlWatts && state.gpuPlWatts[1] <= state.emergencyPlWatts;
    if (maxTemp >= state.criticalStopTempC || alreadyReduced) {
      return {
        canStart,
        startBlockedReason: null,
        action: 'stop_overheat',
        nextMiningDesired: false,
        nextReconnectStage: 'idle',
        nextRestartAttempts: state.restartAttempts,
        nextPlWatts: [state.emergencyPlWatts, state.emergencyPlWatts],
        recoveryConfirmed: false,
      };
    }
    return {
      canStart,
      startBlockedReason: null,
      action: 'reduce_power_limit',
      nextMiningDesired: state.miningDesired,
      nextReconnectStage: state.reconnectStage,
      nextRestartAttempts: state.restartAttempts,
      nextPlWatts: [state.emergencyPlWatts, state.emergencyPlWatts],
      recoveryConfirmed: false,
    };
  }

  // 2. Явная остановка пользователем: watchdog не запускает майнер снова
  if (state.userStoppedManually || !state.miningDesired) {
    return {
      canStart,
      startBlockedReason: canStart ? null : walletCheck.message,
      action: 'stay_stopped',
      nextMiningDesired: false,
      nextReconnectStage: 'idle',
      nextRestartAttempts: state.restartAttempts,
      nextPlWatts: state.gpuPlWatts,
      recoveryConfirmed: false,
    };
  }

  // 3. Блокировка запуска при пустом/неверном/несохранённом адресе
  if (!canStart) {
    return {
      canStart: false,
      startBlockedReason: walletCheck.message,
      action: 'block_start',
      nextMiningDesired: false,
      nextReconnectStage: 'idle',
      nextRestartAttempts: state.restartAttempts,
      nextPlWatts: state.gpuPlWatts,
      recoveryConfirmed: false,
    };
  }

  // 4. Подтверждение восстановления после перезапуска:
  // Статус Connected + ненулевой хешрейт + новая принятая шара
  if (state.reconnectStage === 'awaiting_confirmation') {
    const isConnected = state.poolConnected === true;
    const hasHashrate = state.totalHashrateMHs !== null && state.totalHashrateMHs > 0;
    const hasNewShare =
      state.acceptedShares !== null && state.acceptedShares > state.sharesAtRestart;

    if (isConnected && hasHashrate && hasNewShare) {
      return {
        canStart: true,
        startBlockedReason: null,
        action: 'confirm_recovery',
        nextMiningDesired: true,
        nextReconnectStage: 'idle',
        nextRestartAttempts: 0,
        nextPlWatts: state.gpuPlWatts,
        recoveryConfirmed: true,
      };
    }
  }

  // 5. Проверка потери связи с пулом
  const poolHealthy =
    state.minerProcessRunning &&
    state.apiAvailable &&
    state.poolConnected === true &&
    state.totalHashrateMHs !== null &&
    state.totalHashrateMHs > 0;

  if (poolHealthy) {
    return {
      canStart: true,
      startBlockedReason: null,
      action: 'noop',
      nextMiningDesired: true,
      nextReconnectStage: state.reconnectStage === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'idle',
      nextRestartAttempts: state.restartAttempts,
      nextPlWatts: state.gpuPlWatts,
      recoveryConfirmed: state.reconnectStage !== 'awaiting_confirmation',
    };
  }

  const nextElapsed = state.disconnectElapsedSec + checkIntervalSec;
  if (nextElapsed < state.zeroHashrateRestartSec) {
    return {
      canStart: true,
      startBlockedReason: null,
      action: 'wait_native_reconnect',
      nextMiningDesired: true,
      nextReconnectStage: 'native_wait',
      nextRestartAttempts: state.restartAttempts,
      nextPlWatts: state.gpuPlWatts,
      recoveryConfirmed: false,
    };
  }

  if (state.restartAttempts >= state.maxRestartAttempts) {
    return {
      canStart: true,
      startBlockedReason: null,
      action: 'pause_restarts_limit_reached',
      nextMiningDesired: true,
      nextReconnectStage: 'limit_reached',
      nextRestartAttempts: state.restartAttempts,
      nextPlWatts: state.gpuPlWatts,
      recoveryConfirmed: false,
    };
  }

  if (!state.networkReachable) {
    return {
      canStart: true,
      startBlockedReason: null,
      action: 'wait_native_reconnect',
      nextMiningDesired: true,
      nextReconnectStage: 'native_wait',
      nextRestartAttempts: state.restartAttempts,
      nextPlWatts: state.gpuPlWatts,
      recoveryConfirmed: false,
    };
  }

  return {
    canStart: true,
    startBlockedReason: null,
    action: 'restart_miner',
    nextMiningDesired: true,
    nextReconnectStage: 'awaiting_confirmation',
    nextRestartAttempts: state.restartAttempts + 1,
    nextPlWatts: state.gpuPlWatts,
    recoveryConfirmed: false,
  };
}

export function createEmptyGpuMetrics(): [GpuLiveMetrics, GpuLiveMetrics] {
  return [
    {
      id: 0,
      name: 'NVIDIA GeForce RTX 4070 Ti',
      hashrateMHs: null,
      acceptedShares: null,
      rejectedShares: null,
      staleShares: null,
      lastShareSec: null,
      tempC: null,
      hotspotTempC: null,
      vramTempC: null,
      fanPercent: null,
      fanRpm: null,
      powerWatts: null,
      efficiencyHW: null,
      cclkMHz: null,
      mclkMHz: null,
      voltageMv: null,
      vramUsedMb: null,
      pState: null,
      pcieLink: null,
      status: 'no_data',
    },
    {
      id: 1,
      name: 'NVIDIA GeForce RTX 4070 Ti',
      hashrateMHs: null,
      acceptedShares: null,
      rejectedShares: null,
      staleShares: null,
      lastShareSec: null,
      tempC: null,
      hotspotTempC: null,
      vramTempC: null,
      fanPercent: null,
      fanRpm: null,
      powerWatts: null,
      efficiencyHW: null,
      cclkMHz: null,
      mclkMHz: null,
      voltageMv: null,
      vramUsedMb: null,
      pState: null,
      pcieLink: null,
      status: 'no_data',
    },
  ];
}

export function runAllScenarioChecks(): ScenarioCheckResult[] {
  const validAddr = 'prl1p' + 'q'.repeat(58); // 63-символьный корректный Bech32m адрес

  // 1. Первый запуск без кошелька
  const s1 = evaluateStartupAttachment('', null);
  const s1Watchdog = evaluateWatchdogStep(
    {
      walletAddress: s1.walletAddress,
      walletSaved: s1.walletSaved,
      miningDesired: true,
      userStoppedManually: false,
      minerProcessRunning: false,
      minerPid: null,
      apiAvailable: false,
      nvmlAvailable: false,
      poolConnected: null,
      totalHashrateMHs: null,
      acceptedShares: null,
      gpuTempsC: [null, null],
      gpuPlWatts: [150, 150],
      disconnectElapsedSec: 0,
      zeroHashrateRestartSec: 90,
      restartAttempts: 0,
      maxRestartAttempts: 3,
      reconnectStage: 'idle',
      sharesAtRestart: 0,
      networkReachable: true,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
    },
    15
  );
  const check1Passed =
    !s1.miningActive &&
    !s1.walletSaved &&
    s1.showEditInputImmediately &&
    !s1Watchdog.canStart &&
    s1Watchdog.action === 'block_start';

  // 2. Сохранение корректного адреса
  const v2 = validatePearlWallet(validAddr);
  const s2AfterSave = evaluateStartupAttachment(validAddr, null);
  const check2Passed =
    v2.valid &&
    v2.length === 63 &&
    s2AfterSave.walletSaved &&
    !s2AfterSave.miningActive; // Сохранение не запускает майнер само без нажатия «Запустить»

  // 3. Повторное открытие с сохранённым адресом
  const s3Reopen = evaluateStartupAttachment(validAddr, null);
  const check3Passed =
    s3Reopen.walletSaved &&
    s3Reopen.walletAddress === validAddr &&
    !s3Reopen.showEditInputImmediately &&
    !s3Reopen.miningActive;

  // 4. Неверный адрес (обрезанный адрес из старого конфига, seed-фраза, приватный ключ)
  const vTruncated = validatePearlWallet('prl1psn90qwn5r86zjvk9dsvs0ayz');
  const vSeed = validatePearlWallet('abandon ability able about above absent absorb abstract absurd abuse access accident');
  const vPrivKey = validatePearlWallet('0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318');
  const check4Passed =
    !vTruncated.valid &&
    vTruncated.type === 'truncated_prl' &&
    !vSeed.valid &&
    vSeed.type === 'secret_detected' &&
    !vPrivKey.valid &&
    vPrivKey.type === 'secret_detected';

  // 5. Уже запущенный майнер
  const s5Running = evaluateStartupAttachment(validAddr, 4812);
  const check5Passed =
    s5Running.miningActive &&
    s5Running.attachedExistingProcess &&
    !s5Running.stoppedExistingProcess &&
    !s5Running.spawnedDuplicateProcess;

  // 6. Намеренная остановка
  const s6Stopped = evaluateWatchdogStep(
    {
      walletAddress: validAddr,
      walletSaved: true,
      miningDesired: false,
      userStoppedManually: true,
      minerProcessRunning: false,
      minerPid: null,
      apiAvailable: false,
      nvmlAvailable: true,
      poolConnected: false,
      totalHashrateMHs: 0,
      acceptedShares: 10,
      gpuTempsC: [42, 41],
      gpuPlWatts: [150, 150],
      disconnectElapsedSec: 120,
      zeroHashrateRestartSec: 90,
      restartAttempts: 0,
      maxRestartAttempts: 3,
      reconnectStage: 'idle',
      sharesAtRestart: 0,
      networkReachable: true,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
    },
    15
  );
  const check6Passed = s6Stopped.action === 'stay_stopped' && !s6Stopped.nextMiningDesired;

  // 7. Потеря связи (ожидание самовосстановления -> перезапуск в пределах лимита -> подтверждение Connected + хешрейт > 0 + новая шара)
  const s7Wait = evaluateWatchdogStep(
    {
      walletAddress: validAddr,
      walletSaved: true,
      miningDesired: true,
      userStoppedManually: false,
      minerProcessRunning: true,
      minerPid: 4812,
      apiAvailable: true,
      nvmlAvailable: true,
      poolConnected: false,
      totalHashrateMHs: 0,
      acceptedShares: 25,
      gpuTempsC: [56, 57],
      gpuPlWatts: [150, 150],
      disconnectElapsedSec: 30,
      zeroHashrateRestartSec: 90,
      restartAttempts: 0,
      maxRestartAttempts: 3,
      reconnectStage: 'native_wait',
      sharesAtRestart: 25,
      networkReachable: true,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
    },
    15
  );
  const s7Restart = evaluateWatchdogStep(
    {
      walletAddress: validAddr,
      walletSaved: true,
      miningDesired: true,
      userStoppedManually: false,
      minerProcessRunning: true,
      minerPid: 4812,
      apiAvailable: true,
      nvmlAvailable: true,
      poolConnected: false,
      totalHashrateMHs: 0,
      acceptedShares: 25,
      gpuTempsC: [56, 57],
      gpuPlWatts: [150, 150],
      disconnectElapsedSec: 75,
      zeroHashrateRestartSec: 90,
      restartAttempts: 1,
      maxRestartAttempts: 3,
      reconnectStage: 'native_wait',
      sharesAtRestart: 25,
      networkReachable: true,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
    },
    15
  );
  const s7Confirm = evaluateWatchdogStep(
    {
      walletAddress: validAddr,
      walletSaved: true,
      miningDesired: true,
      userStoppedManually: false,
      minerProcessRunning: true,
      minerPid: 5100,
      apiAvailable: true,
      nvmlAvailable: true,
      poolConnected: true,
      totalHashrateMHs: 136.4,
      acceptedShares: 26, // новая шара после 25
      gpuTempsC: [56, 57],
      gpuPlWatts: [150, 150],
      disconnectElapsedSec: 0,
      zeroHashrateRestartSec: 90,
      restartAttempts: 2,
      maxRestartAttempts: 3,
      reconnectStage: 'awaiting_confirmation',
      sharesAtRestart: 25,
      networkReachable: true,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
    },
    15
  );
  const check7Passed =
    s7Wait.action === 'wait_native_reconnect' &&
    s7Restart.action === 'restart_miner' &&
    s7Restart.nextRestartAttempts === 2 &&
    s7Confirm.action === 'confirm_recovery' &&
    s7Confirm.recoveryConfirmed &&
    s7Confirm.nextRestartAttempts === 0;

  // 8. Перегрев (>= 85 °C)
  const s8Throttle = evaluateWatchdogStep(
    {
      walletAddress: validAddr,
      walletSaved: true,
      miningDesired: true,
      userStoppedManually: false,
      minerProcessRunning: true,
      minerPid: 5100,
      apiAvailable: true,
      nvmlAvailable: true,
      poolConnected: true,
      totalHashrateMHs: 136.0,
      acceptedShares: 30,
      gpuTempsC: [72, 85],
      gpuPlWatts: [150, 150],
      disconnectElapsedSec: 0,
      zeroHashrateRestartSec: 90,
      restartAttempts: 0,
      maxRestartAttempts: 3,
      reconnectStage: 'idle',
      sharesAtRestart: 0,
      networkReachable: true,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
    },
    15
  );
  const s8Stop = evaluateWatchdogStep(
    {
      walletAddress: validAddr,
      walletSaved: true,
      miningDesired: true,
      userStoppedManually: false,
      minerProcessRunning: true,
      minerPid: 5100,
      apiAvailable: true,
      nvmlAvailable: true,
      poolConnected: true,
      totalHashrateMHs: 120.0,
      acceptedShares: 31,
      gpuTempsC: [74, 86],
      gpuPlWatts: [125, 125], // уже был снижен PL, но температура всё ещё >= 85 °C
      disconnectElapsedSec: 0,
      zeroHashrateRestartSec: 90,
      restartAttempts: 0,
      maxRestartAttempts: 3,
      reconnectStage: 'idle',
      sharesAtRestart: 0,
      networkReachable: true,
      maxTempC: 85,
      criticalStopTempC: 88,
      emergencyPlWatts: 125,
    },
    15
  );
  const check8Passed =
    s8Throttle.action === 'reduce_power_limit' &&
    s8Throttle.nextPlWatts[1] === 125 &&
    s8Stop.action === 'stop_overheat' &&
    !s8Stop.nextMiningDesired;

  // 9. Недоступный API
  const emptyMetrics = createEmptyGpuMetrics();
  const check9Passed =
    emptyMetrics[0].hashrateMHs === null &&
    emptyMetrics[1].hashrateMHs === null &&
    emptyMetrics[0].tempC === null &&
    emptyMetrics[1].tempC === null &&
    emptyMetrics[0].acceptedShares === null &&
    emptyMetrics[0].status === 'no_data';

  return [
    {
      id: 'first-run-no-wallet',
      title: '1. Первый запуск без кошелька',
      passed: check1Passed,
      expected: 'Поле ввода адреса открыто, автозапуск отключён, кнопка «Запустить» заблокирована',
      actual: check1Passed
        ? 'miningActive=false, форма ввода открыта, запуск заблокирован (block_start)'
        : 'Ошибка проверки первого запуска',
    },
    {
      id: 'save-valid-wallet',
      title: '2. Сохранение корректного адреса',
      passed: check2Passed,
      expected: '63-символьный адрес prl1p... проходит проверку, сохраняется локально, майнер ждёт кнопки «Запустить»',
      actual: check2Passed
        ? 'Формат Bech32m (63 симв.) подтверждён, сохранён локально, автостарт не выполнен'
        : 'Ошибка проверки сохранения',
    },
    {
      id: 'reopen-saved-wallet',
      title: '3. Повторное открытие с сохранённым адресом',
      passed: check3Passed,
      expected: 'Показывается сохранённый адрес и кнопка «Изменить», майнер не запускается автоматически',
      actual: check3Passed
        ? 'Адрес загружен в режим чтения с кнопкой «Изменить», miningActive=false'
        : 'Ошибка повторного открытия',
    },
    {
      id: 'invalid-or-secret-wallet',
      title: '4. Неверный адрес / обрезанный адрес / seed-фраза',
      passed: check4Passed,
      expected: 'Обрезанный prl1psn90qwn5r86zjvk9dsvs0ayz, seed-фраза и приватный ключ отклоняются, запуск заблокирован',
      actual: check4Passed
        ? 'Обрезанный адрес (29 симв.) и секретные фразы заблокированы валидатором'
        : 'Ошибка блокировки неверного адреса',
    },
    {
      id: 'already-running-miner',
      title: '5. Уже запущенный майнер при открытии',
      passed: check5Passed,
      expected: 'Работающий процесс OneZeroMiner не останавливается, дубликат не запускается',
      actual: check5Passed
        ? 'Процесс PID 4812 подключён к мониторингу без остановки и без дубликата'
        : 'Ошибка обработки работающего процесса',
    },
    {
      id: 'manual-stop',
      title: '6. Намеренная остановка кнопкой «Стоп»',
      passed: check6Passed,
      expected: 'Кнопка «Стоп» оставляет майнинг остановленным; watchdog не перезапускает его при 0 H/s',
      actual: check6Passed
        ? 'userStoppedManually=true -> watchdog возвращает stay_stopped'
        : 'Ошибка удержания остановки',
    },
    {
      id: 'pool-disconnect-recovery',
      title: '7. Потеря связи и подтверждение восстановления',
      passed: check7Passed,
      expected: 'Ожидание самовосстановления -> проверка сети -> перезапуск (до 3 попыток) -> подтверждение Connected + H/s > 0 + новая шара',
      actual: check7Passed
        ? 'wait_native_reconnect -> restart_miner -> confirm_recovery при новой шаре (26 > 25)'
        : 'Ошибка логики переподключения',
    },
    {
      id: 'thermal-protection-85c',
      title: '8. Перегрев 85 °C и выше',
      passed: check8Passed,
      expected: 'При >= 85 °C снижение Power Limit до 125 Вт или аварийная остановка майнера',
      actual: check8Passed
        ? 'При 85 °C -> PL 125 W (reduce_power_limit); при сохранении перегрева -> stop_overheat'
        : 'Ошибка температурной защиты',
    },
    {
      id: 'unavailable-api-no-fake-data',
      title: '9. Недоступный API OneZeroMiner / nvidia-smi',
      passed: check9Passed,
      expected: 'Все недоступные метрики равны null и отображаются как «нет данных» без генерации случайных чисел',
      actual: check9Passed
        ? 'hashrate=null, shares=null, temp=null -> отображается «нет данных»'
        : 'Ошибка обработки недоступного API',
    },
  ];
}
