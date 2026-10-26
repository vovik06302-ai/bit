@echo off
chcp 65001 >nul
title Pearl Rig Control [dual4070ti]

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "SELF_BAT=%~f0"
set "PS_AGENT=%TEMP%\pearl_rig_gui_supervisor.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw = [System.IO.File]::ReadAllText($env:SELF_BAT, [System.Text.Encoding]::UTF8); $marker = ':: ___PS_' + 'START___'; $idx = $raw.IndexOf($marker); if ($idx -ge 0) { $psCode = $raw.Substring($idx + $marker.Length).TrimStart(); $utf8Bom = New-Object System.Text.UTF8Encoding($true); [System.IO.File]::WriteAllText($env:PS_AGENT, $psCode, $utf8Bom) }"

start "" powershell -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%PS_AGENT%"
exit /b

:: ___PS_START___
param([switch]$ReadOnly)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$MinerDir = "C:\Users\User\Documents\Codex\2026-10-25\new-chat\outputs\Pearl\miner\onezerominer-win64-1.8.3"
$LogFile = "C:\Users\User\Documents\Codex\2026-10-25\new-chat\work\pearl-miner.log"
$Worker = "dual4070ti"
$Pool1 = "stratum+tcp://prl-ru.kryptex.network:7048"
$Pool2 = "stratum+tcp://prl-eu.kryptex.network:7048"
$ApiPort = 3001
$BridgePort = 3002
$CheckInterval = 15
$MaxTemp = 85
$CriticalStopTemp = 88
$EmergencyPL = 125
$ZeroHashLimitSec = 90
$MaxRestartAttempts = 3

# Профиль для двух RTX 4070 Ti (без повышения напряжения):
# PL 150 W, память 810 MHz, ядро 2400 MHz, kernel 2, кулер GPU0=65%, GPU1=* (авто)
$CurrentCClk = "2400,2400"
$CurrentMClk = "810,810"
$CurrentPL = "150,150"
$CurrentKernel = "2,2"
$CurrentFan = "65,*"

# Локальное хранилище публичного адреса кошелька (без GitHub и без обрезанного адреса)
$LocalStateDir = "$env:LOCALAPPDATA\PearlRigControl"
if (-not (Test-Path $LocalStateDir)) { New-Item -ItemType Directory -Path $LocalStateDir -Force | Out-Null }
$LocalWalletFile = "$LocalStateDir\wallet-local.json"

$Wallet = ""
$WalletSaved = $false
$WalletEditMode = $true

# Состояние процесса майнера: НЕ запускаем при установке или первом открытии
$MiningDesired = $false
$UserStoppedManually = $false
$IsMiningRunning = $false
$MinerPid = $null

# Счётчики восстановления связи с пулом
$DisconnectElapsedSec = 0
$RestartCount = 0
$ReconnectStage = "idle"
$SharesAtRestart = 0
$RecoveryConfirmed = $false
$ThermalThrottled = $false

# Реальные показатели телеметрии ($null = нет данных, никаких случайных чисел)
$ApiAvailable = $false
$NvmlAvailable = $false
$PoolConnected = $null
$ActivePoolUrl = $null
$UptimeSec = $null
$Gpu0Hash = $null
$Gpu1Hash = $null
$TotalHash = $null
$SharesAcc = $null
$SharesRej = $null
$Gpu0Temp = $null
$Gpu1Temp = $null
$Gpu0Power = $null
$Gpu1Power = $null
$Gpu0Fan = $null
$Gpu1Fan = $null
$Gpu0CClkNow = $null
$Gpu1CClkNow = $null
$Gpu0MClkNow = $null
$Gpu1MClkNow = $null

# Pure conversion functions; neither starts processes nor changes GPU settings.
function ConvertTo-PearlNumber($Value) {
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    $number = 0.0
    if ([double]::TryParse([string]$Value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -and
        -not [double]::IsNaN($number) -and -not [double]::IsInfinity($number) -and $number -ge 0) { return $number }
    return $null
}

function Convert-PearlTelemetry($ApiResponse, $NvidiaLines, [double]$NowUnix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) {
    $updated = ConvertTo-PearlNumber $ApiResponse.last_update
    $fresh = $null -ne $updated -and [Math]::Abs($NowUnix - $updated) -le 20
    $algo = $null
    $devices = @()
    if ($fresh) {
        $algo = @($ApiResponse.algos | Where-Object { $_.name -eq 'pearlhash' } | Select-Object -First 1)
        $algo = if ($algo.Count) { $algo[0] } else { $null }
        $devices = @($ApiResponse.devices)
    }
    $poolConnected = $null
    if ($null -ne $algo.pool_connected -and $algo.pool_connected -is [bool]) { $poolConnected = $algo.pool_connected }
    elseif ($algo.pool_status) {
        switch -Regex (([string]$algo.pool_status).Trim()) {
            '^(Connected|Online|Active)$' { $poolConnected = $true }
            '^(Disconnected|Offline|Inactive|Connecting|Reconnecting)$' { $poolConnected = $false }
        }
    }
    $nv = @{}
    foreach ($line in $NvidiaLines) {
        $parts = $line -split ','
        if ($parts.Count -ne 8) { continue }
        $index = ConvertTo-PearlNumber $parts[0].Trim()
        if ($null -eq $index -or $index -notin @(0,1)) { continue }
        $bus = $null
        if ($parts[1].Trim() -match '^[0-9A-Fa-f]+:([0-9A-Fa-f]+):[0-9A-Fa-f]+\.[0-9]+$') {
            $bus = [Convert]::ToInt32($Matches[1], 16)
        }
        $nv[[int]$index] = @{
            bus = $bus
            tempC = ConvertTo-PearlNumber $parts[2].Trim()
            powerWatts = ConvertTo-PearlNumber $parts[3].Trim()
            fanPercent = ConvertTo-PearlNumber $parts[4].Trim()
            cclkMHz = ConvertTo-PearlNumber $parts[5].Trim()
            mclkMHz = ConvertTo-PearlNumber $parts[6].Trim()
            vramTempC = ConvertTo-PearlNumber $parts[7].Trim()
        }
    }
    $gpus = foreach ($id in @(0,1)) {
        $position = -1
        for ($i=0; $i -lt $devices.Count; $i++) {
            $matchesDevice = if ($nv.ContainsKey($id) -and $null -ne $nv[$id].bus) {
                $null -ne $devices[$i].bus_id -and [int]$devices[$i].bus_id -eq $nv[$id].bus
            } else { $devices[$i].id -eq $id }
            if ($matchesDevice) { $position = $i; break }
        }
        $device = if ($position -ge 0) { $devices[$position] } else { $null }
        $rate = $null; $accepted = $null; $rejected = $null
        if ($null -ne $algo -and $position -ge 0) {
            if ($null -ne $algo.hashrates -and $position -lt @($algo.hashrates).Count) { $rate = ConvertTo-PearlNumber $algo.hashrates[$position] }
            if ($null -ne $algo.devices_accepted_shares -and $position -lt @($algo.devices_accepted_shares).Count) { $accepted = ConvertTo-PearlNumber $algo.devices_accepted_shares[$position] }
            if ($null -ne $algo.devices_rejected_shares -and $position -lt @($algo.devices_rejected_shares).Count) { $rejected = ConvertTo-PearlNumber $algo.devices_rejected_shares[$position] }
        }
        $sensors = if ($nv.ContainsKey($id)) { $nv[$id] } else { @{
            tempC = ConvertTo-PearlNumber $device.temp
            powerWatts = ConvertTo-PearlNumber $device.power
            fanPercent = ConvertTo-PearlNumber $device.fan
            cclkMHz = ConvertTo-PearlNumber $device.cclk
            mclkMHz = ConvertTo-PearlNumber $device.mclk
            vramTempC = ConvertTo-PearlNumber $device.mem_temp
        } }
        @{
            id = $id; name = if ($device.name) { $device.name } else { "GPU $id" }
            hashrateTHs = if ($null -ne $rate) { $rate / 1e12 } else { $null }
            acceptedShares = $accepted; rejectedShares = $rejected
            tempC = $sensors.tempC; powerWatts = $sensors.powerWatts; fanPercent = $sensors.fanPercent
            cclkMHz = $sensors.cclkMHz; mclkMHz = $sensors.mclkMHz; vramTempC = $sensors.vramTempC
            sensorSource = if ($nv.ContainsKey($id)) { 'nvidia-smi' } elseif ($device) { 'miner-api' } else { $null }
        }
    }
    $totalRate = ConvertTo-PearlNumber $algo.total_hashrate
    return @{
        ok = $true; schemaVersion = 4; sampledAt = [DateTimeOffset]::FromUnixTimeSeconds([long]$NowUnix).ToString('o')
        apiAvailable = $fresh -and $null -ne $algo; nvmlAvailable = $nv.Count -gt 0
        poolConnected = $poolConnected; poolUrl = $algo.pool
        uptimeSec = if ($fresh) { ConvertTo-PearlNumber $ApiResponse.uptime_seconds } else { $null }
        totalHashrateTHs = if ($null -ne $totalRate) { $totalRate / 1e12 } else { $null }
        acceptedShares = ConvertTo-PearlNumber $algo.total_accepted_shares
        rejectedShares = ConvertTo-PearlNumber $algo.total_rejected_shares
        invalidShares = ConvertTo-PearlNumber $algo.total_invalid_shares
        gpus = @($gpus)
    }
}

function Test-PearlWalletFormat([string]$Addr) {
    if ([string]::IsNullOrWhiteSpace($Addr)) {
        return @{ Valid = $false; Reason = "Адрес пуст. Введите публичный адрес кошелька Pearl (prl1p... 63 символа)." }
    }
    $clean = $Addr.Trim()
    if ($clean -match "\s" -or $clean -match "^[0-9a-fA-F]{64}$" -or $clean.StartsWith("0x") -or $clean.StartsWith("xprv")) {
        return @{ Valid = $false; Reason = "ОШИБКА: Не вводите seed-фразу или приватный ключ! Нужен только публичный адрес prl1p..." }
    }
    $lower = $clean.ToLowerInvariant()
    if ($lower -eq "prl1psn90qwn5r86zjvk9dsvs0ayz") {
        return @{ Valid = $false; Reason = "Обрезанный тестовый адрес (29 симв.) заблокирован. Введите полный 63-символьный адрес." }
    }
    if ($lower.StartsWith("prl1p")) {
        $body = $lower.Substring(5)
        if ($lower.Length -eq 63 -and ($body -match "^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$")) {
            return @{ Valid = $true; Reason = "Корректный публичный адрес Pearl (Bech32m, 63 символа)." }
        }
        return @{ Valid = $false; Reason = "Неверный формат prl1p...: длина $($lower.Length) из 63 символов или недопустимые символы." }
    }
    if ($lower.StartsWith("prl1q")) {
        $body = $lower.Substring(5)
        if ($lower.Length -ge 42 -and $lower.Length -le 44 -and ($body -match "^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$")) {
            return @{ Valid = $true; Reason = "Корректный публичный адрес Pearl (Bech32, $($lower.Length) симв.)." }
        }
        return @{ Valid = $false; Reason = "Неверный формат prl1q...: длина $($lower.Length) (ожидается 42-44 символа)." }
    }
    return @{ Valid = $false; Reason = "Адрес должен начинаться с prl1p... (63 симв.) или prl1q... (42-44 симв.)." }
}

# Загрузка ранее сохранённого локального адреса
if (Test-Path $LocalWalletFile) {
    try {
        $savedObj = Get-Content -LiteralPath $LocalWalletFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($savedObj -and $savedObj.walletAddress) {
            $chk = Test-PearlWalletFormat $savedObj.walletAddress
            if ($chk.Valid) {
                $Wallet = $savedObj.walletAddress.Trim()
                $WalletSaved = $true
                $WalletEditMode = $false
            }
        }
    } catch {}
}

# ============================================================================
# ОКНО УПРАВЛЕНИЯ PEARL RIG CONTROL (БЕЗ АВТОЗАПУСКА И СИМУЛЯЦИИ)
# ============================================================================
$form = New-Object System.Windows.Forms.Form
$form.Text = "Pearl Rig Control v3.0.1 [$Worker] - Dual RTX 4070 Ti"
$form.Size = New-Object System.Drawing.Size(1120, 780)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$form.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "PEARL RIG CONTROL · DUAL RTX 4070 Ti (PL 150W | CClk 2400 | MClk 810 | Kernel 2)"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 12.5, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$lblTitle.Location = New-Object System.Drawing.Point(20, 14)
$lblTitle.Size = New-Object System.Drawing.Size(1060, 24)
$form.Controls.Add($lblTitle)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Статус: Ожидание (майнер не запущен)"
$lblStatus.Font = New-Object System.Drawing.Font("Consolas", 9.5, [System.Drawing.FontStyle]::Bold)
$lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
$lblStatus.Location = New-Object System.Drawing.Point(20, 42)
$lblStatus.Size = New-Object System.Drawing.Size(1060, 20)
$form.Controls.Add($lblStatus)

# БЛОК 1: Публичный адрес кошелька Pearl (обязателен ДО первого запуска)
$grpWallet = New-Object System.Windows.Forms.Panel
$grpWallet.Location = New-Object System.Drawing.Point(20, 68)
$grpWallet.Size = New-Object System.Drawing.Size(1065, 92)
$grpWallet.BackColor = [System.Drawing.Color]::FromArgb(17, 24, 39)
$grpWallet.BorderStyle = "FixedSingle"
$form.Controls.Add($grpWallet)

$lblWalletHeader = New-Object System.Windows.Forms.Label
$lblWalletHeader.Text = "ПУБЛИЧНЫЙ АДРЕС КОШЕЛЬКА PEARL (-w) · Никогда не вводите seed-фразу или приватный ключ!"
$lblWalletHeader.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$lblWalletHeader.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$lblWalletHeader.Location = New-Object System.Drawing.Point(12, 8)
$lblWalletHeader.Size = New-Object System.Drawing.Size(1030, 18)
$grpWallet.Controls.Add($lblWalletHeader)

$txtWallet = New-Object System.Windows.Forms.TextBox
$txtWallet.Text = $Wallet
$txtWallet.ReadOnly = (-not $WalletEditMode)
$txtWallet.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$txtWallet.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$txtWallet.Font = New-Object System.Drawing.Font("Consolas", 10, [System.Drawing.FontStyle]::Bold)
$txtWallet.Location = New-Object System.Drawing.Point(12, 32)
$txtWallet.Size = New-Object System.Drawing.Size(680, 26)
$grpWallet.Controls.Add($txtWallet)

$btnCheckWallet = New-Object System.Windows.Forms.Button
$btnCheckWallet.Text = "Проверить формат"
$btnCheckWallet.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$btnCheckWallet.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnCheckWallet.ForeColor = [System.Drawing.Color]::White
$btnCheckWallet.FlatStyle = "Flat"
$btnCheckWallet.Location = New-Object System.Drawing.Point(702, 30)
$btnCheckWallet.Size = New-Object System.Drawing.Size(128, 28)
$grpWallet.Controls.Add($btnCheckWallet)

$btnSaveWallet = New-Object System.Windows.Forms.Button
$btnSaveWallet.Text = "Сохранить локально"
$btnSaveWallet.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$btnSaveWallet.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$btnSaveWallet.ForeColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$btnSaveWallet.FlatStyle = "Flat"
$btnSaveWallet.Location = New-Object System.Drawing.Point(838, 30)
$btnSaveWallet.Size = New-Object System.Drawing.Size(132, 28)
$grpWallet.Controls.Add($btnSaveWallet)

$btnEditWallet = New-Object System.Windows.Forms.Button
$btnEditWallet.Text = "Изменить"
$btnEditWallet.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$btnEditWallet.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$btnEditWallet.ForeColor = [System.Drawing.Color]::White
$btnEditWallet.FlatStyle = "Flat"
$btnEditWallet.Location = New-Object System.Drawing.Point(976, 30)
$btnEditWallet.Size = New-Object System.Drawing.Size(78, 28)
$grpWallet.Controls.Add($btnEditWallet)

$lblWalletHint = New-Object System.Windows.Forms.Label
$lblWalletHint.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$lblWalletHint.Location = New-Object System.Drawing.Point(12, 64)
$lblWalletHint.Size = New-Object System.Drawing.Size(1035, 20)
$grpWallet.Controls.Add($lblWalletHint)

# БЛОК 2: Кнопки управления майнером
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "▶ ЗАПУСТИТЬ"
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$btnStart.ForeColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$btnStart.FlatStyle = "Flat"
$btnStart.Location = New-Object System.Drawing.Point(20, 170)
$btnStart.Size = New-Object System.Drawing.Size(210, 38)
$form.Controls.Add($btnStart)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "■ СТОП"
$btnStop.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.FlatStyle = "Flat"
$btnStop.Location = New-Object System.Drawing.Point(240, 170)
$btnStop.Size = New-Object System.Drawing.Size(160, 38)
$form.Controls.Add($btnStop)

$btnRefreshNow = New-Object System.Windows.Forms.Button
$btnRefreshNow.Text = "Обновить датчики (API :3001 + nvidia-smi)"
$btnRefreshNow.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$btnRefreshNow.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnRefreshNow.ForeColor = [System.Drawing.Color]::White
$btnRefreshNow.FlatStyle = "Flat"
$btnRefreshNow.Location = New-Object System.Drawing.Point(410, 170)
$btnRefreshNow.Size = New-Object System.Drawing.Size(280, 38)
$form.Controls.Add($btnRefreshNow)

# БЛОК 3: Карточки реальной телеметрии (без выдуманных чисел)
$lblTelemetryBox = New-Object System.Windows.Forms.Label
$lblTelemetryBox.Font = New-Object System.Drawing.Font("Consolas", 9.5)
$lblTelemetryBox.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$lblTelemetryBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblTelemetryBox.BorderStyle = "FixedSingle"
$lblTelemetryBox.Location = New-Object System.Drawing.Point(20, 218)
$lblTelemetryBox.Size = New-Object System.Drawing.Size(1065, 280)
$lblTelemetryBox.Padding = New-Object System.Windows.Forms.Padding(12)
$form.Controls.Add($lblTelemetryBox)

# БЛОК 4: Журнал событий и ошибок
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(5, 8, 14)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 9)
$txtLog.Location = New-Object System.Drawing.Point(20, 510)
$txtLog.Size = New-Object System.Drawing.Size(1065, 215)
$form.Controls.Add($txtLog)

function Write-AgentLog([string]$Level, [string]$Msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    $line = "[$ts][$Level] $Msg`r`n"
    if ($txtLog -and -not $txtLog.IsDisposed) {
        $txtLog.AppendText($line)
    }
}

function Sync-WalletUiState {
    $chk = Test-PearlWalletFormat $script:Wallet
    if ($script:WalletSaved -and $chk.Valid -and (-not $script:WalletEditMode)) {
        $txtWallet.ReadOnly = $true
        $btnSaveWallet.Enabled = $false
        $btnEditWallet.Enabled = $true
        $btnStart.Enabled = $true
        $lblWalletHint.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        $lblWalletHint.Text = "Сохранённый адрес активен ($($script:Wallet.Length) симв.). Для смены нажмите «Изменить». Можете нажать «▶ ЗАПУСТИТЬ»."
    } else {
        $txtWallet.ReadOnly = $false
        $btnSaveWallet.Enabled = $true
        $btnEditWallet.Enabled = $script:WalletSaved
        $btnStart.Enabled = ($script:WalletSaved -and $chk.Valid)
        $draftChk = Test-PearlWalletFormat $txtWallet.Text
        if ($draftChk.Valid) {
            $lblWalletHint.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
            $lblWalletHint.Text = "Формат верный. Нажмите «Сохранить локально», чтобы разблокировать кнопку «▶ ЗАПУСТИТЬ»."
        } else {
            $lblWalletHint.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
            $lblWalletHint.Text = "$($draftChk.Reason) (Запуск заблокирован)"
        }
    }
}

function Format-Metric($val, [string]$suffix = "") {
    if ($null -eq $val) { return "нет данных" }
    if ($val -is [double] -or $val -is [single] -or $val -is [decimal]) { $val = [Math]::Round($val, 2) }
    return "$val$suffix"
}

function Update-TelemetryDisplay {
    $poolStr = if ($null -eq $script:PoolConnected) { "нет данных" } elseif ($script:PoolConnected) { "Connected ($($script:ActivePoolUrl))" } else { "Disconnected" }
    $apiStr = if ($script:ApiAvailable) { "Доступен (127.0.0.1:$ApiPort)" } else { "нет данных (API 127.0.0.1:$ApiPort недоступен)" }
    $nvmlStr = if ($script:NvmlAvailable) { "nvidia-smi (реальные датчики)" } elseif ($script:ApiAvailable) { "API майнера (nvidia-smi недоступен)" } else { "нет данных" }
    $procStr = if ($script:IsMiningRunning) { "Работает (PID: $($script:MinerPid))" } elseif ($script:UserStoppedManually) { "Намеренно остановлен пользователем (Стоп)" } else { "Не запущен" }

    $lines = @(
        "СОСТОЯНИЕ ПРОЦЕССА И ИСТОЧНИКОВ ДАННЫХ:",
        "  Процесс OneZeroMiner : $procStr",
        "  API OneZeroMiner     : $apiStr",
        "  Датчики nvidia-smi   : $nvmlStr",
        "  Статус пула Kryptex  : $poolStr",
        "  Этап переподключения : $($script:ReconnectStage) (Попыток перезапуска: $($script:RestartCount)/$MaxRestartAttempts | Подтверждение восстановления: $($script:RecoveryConfirmed))",
        "",
        "ПОКАЗАТЕЛИ МАЙНИНГА (из API http://127.0.0.1:$ApiPort):",
        "  Суммарный хешрейт    : $(Format-Metric $script:TotalHash ' TH/s')   (GPU #0: $(Format-Metric $script:Gpu0Hash ' TH/s') | GPU #1: $(Format-Metric $script:Gpu1Hash ' TH/s'))",
        "  GPU #0 шары         : $(Format-Metric $script:TelemetrySnapshot.gpus[0].acceptedShares) / $(Format-Metric $script:TelemetrySnapshot.gpus[0].rejectedShares)  | GPU #1: $(Format-Metric $script:TelemetrySnapshot.gpus[1].acceptedShares) / $(Format-Metric $script:TelemetrySnapshot.gpus[1].rejectedShares)",
        "  Шар принято / откл.  : $(Format-Metric $script:SharesAcc) / $(Format-Metric $script:SharesRej)   | Время работы майнера: $(Format-Metric $script:UptimeSec ' сек')",
        "",
        "ДАТЧИКИ ВИДЕОКАРТ (источник: $nvmlStr; профиль: PL 150W, MClk 810 MHz, CClk 2400 MHz, Kernel 2, Fan 65%/*):",
        "  GPU #0 (RTX 4070 Ti) : Темп: $(Format-Metric $script:Gpu0Temp ' °C') | Мощность: $(Format-Metric $script:Gpu0Power ' Вт') | Кулер: $(Format-Metric $script:Gpu0Fan ' %') | Частоты: $(Format-Metric $script:Gpu0CClkNow)/$(Format-Metric $script:Gpu0MClkNow) MHz",
        "  GPU #1 (RTX 4070 Ti) : Темп: $(Format-Metric $script:Gpu1Temp ' °C') | Мощность: $(Format-Metric $script:Gpu1Power ' Вт') | Кулер: $(Format-Metric $script:Gpu1Fan ' %') | Частоты: $(Format-Metric $script:Gpu1CClkNow)/$(Format-Metric $script:Gpu1MClkNow) MHz"
    )
    $lblTelemetryBox.Text = ($lines -join "`r`n")
}

function Poll-RealTelemetry {
    $api = $null
    $nvLines = @()
    try { $api = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/" -TimeoutSec 2 -ErrorAction Stop } catch {}
    try {
        $nvLines = @(& nvidia-smi --query-gpu=index,pci.bus_id,temperature.gpu,power.draw,fan.speed,clocks.current.graphics,clocks.current.memory,temperature.memory --format=csv,noheader,nounits 2>$null)
        if ($LASTEXITCODE -ne 0) { $nvLines = @() }
    } catch { $nvLines = @() }
    $script:TelemetrySnapshot = Convert-PearlTelemetry $api $nvLines
    $sample = $script:TelemetrySnapshot
    $script:ApiAvailable = $sample.apiAvailable
    $script:NvmlAvailable = $sample.nvmlAvailable
    $script:PoolConnected = $sample.poolConnected
    $script:ActivePoolUrl = $sample.poolUrl
    $script:UptimeSec = $sample.uptimeSec
    $script:TotalHash = $sample.totalHashrateTHs
    $script:SharesAcc = $sample.acceptedShares
    $script:SharesRej = $sample.rejectedShares
    foreach ($id in @(0,1)) {
        $gpu = $sample.gpus[$id]
        foreach ($mapping in @(@('Hash','hashrateTHs'),@('Temp','tempC'),@('Power','powerWatts'),@('Fan','fanPercent'),@('CClkNow','cclkMHz'),@('MClkNow','mclkMHz'))) {
            Set-Variable -Scope Script -Name ("Gpu"+$id+$mapping[0]) -Value $gpu[$mapping[1]]
        }
    }
    $proc = Get-Process -Name 'onezerominer' -ErrorAction SilentlyContinue | Select-Object -First 1
    $script:IsMiningRunning = $null -ne $proc
    $script:MinerPid = if ($proc) { $proc.Id } else { $null }
    Update-TelemetryDisplay
}

function Start-MinerProcess([bool]$IsWatchdogRestart = $false) {
    if ($ReadOnly) { return }
    $chk = Test-PearlWalletFormat $script:Wallet
    if (-not $script:WalletSaved -or -not $chk.Valid) {
        $lblStatus.Text = "Статус: ЗАПУСК ЗАБЛОКИРОВАН — сначала введите и сохраните корректный адрес Pearl!"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        Write-AgentLog "ERROR" "Запуск отклонён: публичный адрес кошелька пуст, неверен или не сохранён локально."
        return
    }

    $existing = Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and (-not $IsWatchdogRestart)) {
        $script:MiningDesired = $true
        $script:UserStoppedManually = $false
        $script:IsMiningRunning = $true
        $script:MinerPid = $existing.Id
        $lblStatus.Text = "Статус: OneZeroMiner уже работает (PID $($existing.Id)). Дубликат не запущен."
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        Write-AgentLog "INFO" "Процесс onezerominer.exe (PID $($existing.Id)) уже запущен. Подключён мониторинг без остановки процесса."
        Poll-RealTelemetry
        return
    }

    if ($existing -and $IsWatchdogRestart) {
        Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
    }

    if (-not (Test-Path "$MinerDir\onezerominer.exe")) {
        $lblStatus.Text = "Статус: ОШИБКА — файл onezerominer.exe не найден по пути $MinerDir"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        Write-AgentLog "ERROR" "Не найден исполняемый файл: $MinerDir\onezerominer.exe"
        return
    }

    $logDir = Split-Path $LogFile -Parent
    if ($logDir -and (-not (Test-Path $logDir))) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    $script:MiningDesired = $true
    $script:UserStoppedManually = $false
    $script:ThermalThrottled = $false

    Set-Location $MinerDir
    $minerArgs = "-a pearl -w $($script:Wallet) -o $Pool1 --worker $Worker --cclk $CurrentCClk --mclk $CurrentMClk --pl $CurrentPL --kernel $CurrentKernel --fan $CurrentFan --api-port $ApiPort --log-file `"$LogFile`""
    $started = Start-Process -FilePath "$MinerDir\onezerominer.exe" -ArgumentList $minerArgs -WindowStyle Normal -PassThru -ErrorAction Stop
    $script:IsMiningRunning = $true
    $script:MinerPid = if ($started) { $started.Id } else { $null }

    $lblStatus.Text = "Статус: МАЙНЕР ЗАПУЩЕН (PID $($script:MinerPid)) -> $Pool1"
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
    Write-AgentLog "OK" "Запущен onezerominer.exe (PID $($script:MinerPid)): -w $($script:Wallet) -o $Pool1 --cclk $CurrentCClk --mclk $CurrentMClk --pl $CurrentPL --kernel $CurrentKernel --fan $CurrentFan"
    Poll-RealTelemetry
}

function Stop-MinerProcess([string]$Reason = "Нажата кнопка «Стоп» пользователем") {
    if ($ReadOnly) { return }
    $script:UserStoppedManually = $true
    $script:MiningDesired = $false
    $script:ReconnectStage = "idle"
    $script:DisconnectElapsedSec = 0

    Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $script:IsMiningRunning = $false
    $script:MinerPid = $null

    $lblStatus.Text = "Статус: ОСТАНОВЛЕН ($Reason). Watchdog не будет перезапускать майнер."
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
    Write-AgentLog "WARN" "Майнинг остановлен ($Reason). Автоматический перезапуск отключён до явной команды «Запустить»."
    Poll-RealTelemetry
}

function Test-PoolTcpConnection {
    foreach ($endpoint in @($Pool1, $Pool2)) {
        $clean = ($endpoint -replace "^stratum\+(tcp|ssl)://", "")
        $parts = $clean -split ":"
        $hostName = $parts[0]
        $port = if ($parts.Count -ge 2) { [int]$parts[1] } else { 7048 }
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $iar = $tcp.BeginConnect($hostName, $port, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(1200, $false) -and $tcp.Connected) {
                $tcp.Close()
                return $true
            }
            $tcp.Close()
        } catch {}
    }
    return $false
}

function Invoke-WatchdogCheck {
    if ($ReadOnly -or -not $script:MiningDesired -or $script:UserStoppedManually) { return }
    $maxTempNow = $null
    if ($null -ne $script:Gpu0Temp -and $null -ne $script:Gpu1Temp) {
        $maxTempNow = [Math]::Max($script:Gpu0Temp, $script:Gpu1Temp)
    } elseif ($null -ne $script:Gpu0Temp) {
        $maxTempNow = $script:Gpu0Temp
    } elseif ($null -ne $script:Gpu1Temp) {
        $maxTempNow = $script:Gpu1Temp
    }

    if ($null -ne $maxTempNow -and $maxTempNow -ge $MaxTemp) {
        if ($maxTempNow -ge $CriticalStopTemp -or $script:ThermalThrottled) {
            Write-AgentLog "THERMAL" "КРИТИЧЕСКИЙ ПЕРЕГРЕВ GPU ($maxTempNow °C >= $MaxTemp °C)! Немедленная остановка майнера."
            Stop-MinerProcess "Аварийная остановка из-за перегрева GPU ($maxTempNow °C)"
            return
        } else {
            $script:ThermalThrottled = $true
            $script:CurrentPL = "$EmergencyPL,$EmergencyPL"
            & nvidia-smi -i 0 -pl $EmergencyPL >$null 2>&1
            & nvidia-smi -i 1 -pl $EmergencyPL >$null 2>&1
            Write-AgentLog "THERMAL" "Перегрев GPU ($maxTempNow °C >= $MaxTemp °C): лимит мощности снижен до $EmergencyPL Вт на обеих картах."
            $lblStatus.Text = "Статус: ЗАЩИТА ОТ ПЕРЕГРЕВА ($maxTempNow °C) — Power Limit снижен до $EmergencyPL Вт"
            $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        }
    }

    if (-not $script:MiningDesired -or $script:UserStoppedManually) {
        return
    }

    if ($script:ReconnectStage -eq "awaiting_confirmation") {
        $hasConnected = ($script:PoolConnected -eq $true)
        $hasHashrate = ($null -ne $script:TotalHash -and $script:TotalHash -gt 0)
        $hasNewShare = ($null -ne $script:SharesAcc -and $script:SharesAcc -gt $script:SharesAtRestart)
        if ($hasConnected -and $hasHashrate -and $hasNewShare) {
            $script:RecoveryConfirmed = $true
            $script:ReconnectStage = "idle"
            $script:RestartCount = 0
            $script:DisconnectElapsedSec = 0
            Write-AgentLog "OK" "Восстановление подтверждено: пул Connected, хешрейт $($script:TotalHash) TH/s, принята новая шара ($($script:SharesAcc) > $($script:SharesAtRestart))."
            $lblStatus.Text = "Статус: МАЙНИНГ ВОССТАНОВЛЕН И ПОДТВЕРЖДЁН ($($script:TotalHash) TH/s)"
            $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        }
    }

    $poolHealthy = ($script:IsMiningRunning -and $script:ApiAvailable -and ($script:PoolConnected -eq $true) -and ($null -ne $script:TotalHash) -and ($script:TotalHash -gt 0))

    if ($poolHealthy) {
        $script:DisconnectElapsedSec = 0
        if ($script:ReconnectStage -eq "native_wait") {
            $script:ReconnectStage = "idle"
            Write-AgentLog "OK" "OneZeroMiner самостоятельно переподключился к пулу Kryptex."
        }
        return
    }

    $script:DisconnectElapsedSec += $CheckInterval
    if ($script:DisconnectElapsedSec -lt $ZeroHashLimitSec) {
        $script:ReconnectStage = "native_wait"
        Write-AgentLog "WARN" "Связь с пулом потеряна или хешрейт 0. Ожидание штатного переподключения OneZeroMiner ($($script:DisconnectElapsedSec)/$ZeroHashLimitSec сек)..."
        return
    }

    $script:DisconnectElapsedSec = 0
    if ($script:RestartCount -ge $MaxRestartAttempts) {
        $script:ReconnectStage = "limit_reached"
        $lblStatus.Text = "Статус: Достигнут лимит перезапусков ($MaxRestartAttempts/$MaxRestartAttempts). Проверьте соединение с пулом."
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        Write-AgentLog "ERROR" "Превышен лимит попыток перезапуска ($MaxRestartAttempts). Автоперезапуск приостановлен до вмешательства пользователя."
        return
    }

    $netOk = Test-PoolTcpConnection
    if (-not $netOk) {
        Write-AgentLog "WARN" "Сеть/пул $Pool1 сейчас не отвечает по TCP. Попытка перезапуска отложена до восстановления сети."
        return
    }

    $script:RestartCount++
    $script:ReconnectStage = "awaiting_confirmation"
    $script:RecoveryConfirmed = $false
    $script:SharesAtRestart = 0 # New miner session resets accepted shares.
    Write-AgentLog "WARN" "Устойчивый сбой пула. Сеть доступна. Перезапуск майнера (попытка $($script:RestartCount) из $MaxRestartAttempts)..."
    Start-MinerProcess -IsWatchdogRestart $true
}

$httpListener = New-Object System.Net.HttpListener
$httpListener.Prefixes.Add("http://127.0.0.1:$BridgePort/")
$script:httpTask = $null
try {
    $httpListener.Start()
    $script:httpTask = $httpListener.GetContextAsync()
    Write-AgentLog "OK" "Защищённый локальный интерфейс телеметрии запущен на http://127.0.0.1:$BridgePort/telemetry (только чтение)"
} catch {}

$btnCheckWallet.Add_Click({
    $chk = Test-PearlWalletFormat $txtWallet.Text
    if ($chk.Valid) {
        $lblWalletHint.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        $lblWalletHint.Text = $chk.Reason
    } else {
        $lblWalletHint.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        $lblWalletHint.Text = $chk.Reason
    }
})

$btnSaveWallet.Add_Click({
    $candidate = $txtWallet.Text.Trim()
    $chk = Test-PearlWalletFormat $candidate
    if (-not $chk.Valid) {
        [System.Windows.Forms.MessageBox]::Show($chk.Reason, "Ошибка формата адреса Pearl", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
        Sync-WalletUiState
        return
    }
    $script:Wallet = $candidate
    $script:WalletSaved = $true
    $script:WalletEditMode = $false
    $payload = @{ walletAddress = $script:Wallet; savedAt = (Get-Date).ToString("o") } | ConvertTo-Json
    [System.IO.File]::WriteAllText($LocalWalletFile, $payload, [System.Text.Encoding]::UTF8)
    Write-AgentLog "OK" "Публичный адрес кошелька проверен и сохранён локально ($($script:Wallet.Length) симв.). Теперь можно нажать «▶ ЗАПУСТИТЬ»."
    Sync-WalletUiState
})

$btnEditWallet.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show("Разблокировать поле для изменения публичного адреса выплат Pearl?", "Подтверждение изменения адреса", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
        $script:WalletEditMode = $true
        $script:WalletSaved = $false
        Sync-WalletUiState
        $txtWallet.Focus()
    }
})

$btnStart.Add_Click({ Start-MinerProcess -IsWatchdogRestart $false })
$btnStop.Add_Click({ Stop-MinerProcess "Явная остановка пользователем (кнопка Стоп)" })
$btnRefreshNow.Add_Click({ Poll-RealTelemetry })

$existingOnOpen = Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingOnOpen) {
    $script:IsMiningRunning = $true
    $script:MiningDesired = $false
    $script:MinerPid = $existingOnOpen.Id
    $lblStatus.Text = "Статус: Обнаружен уже работающий OneZeroMiner (PID $($existingOnOpen.Id)). Мониторинг подключён."
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
    Write-AgentLog "INFO" "При открытии обнаружен работающий процесс onezerominer.exe (PID $($existingOnOpen.Id)). Остановка или дублирующий запуск не выполнялись."
} else {
    Write-AgentLog "INFO" "Панель открыта. Автозапуск майнера отключён. Проверьте сохранённый адрес кошелька и нажмите «▶ ЗАПУСТИТЬ»."
}

Sync-WalletUiState
if ($ReadOnly) {
    $form.Text += " - только мониторинг"
    $btnStart.Enabled = $false
    $btnStop.Enabled = $false
    $btnSaveWallet.Enabled = $false
    $btnEditWallet.Enabled = $false
    $txtWallet.ReadOnly = $true
    $lblWalletHint.Text = "Режим мониторинга: настройки и работа майнера не изменяются."
}
Poll-RealTelemetry

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$tickSec = 0

$timer.Add_Tick({
    Poll-RealTelemetry

    if ($httpListener.IsListening) {
        try {
            if ($null -eq $script:httpTask) {
                $script:httpTask = $httpListener.GetContextAsync()
            }
            if ($script:httpTask.IsCompleted) {
                $ctx = $script:httpTask.GetAwaiter().GetResult()
                $script:httpTask = $httpListener.GetContextAsync()
                $req = $ctx.Request
                $res = $ctx.Response

                $origin = $req.Headers["Origin"]
                $allowedOrigins = @("http://127.0.0.1:3000", "http://localhost:3000")
                if ($origin -and ($allowedOrigins -notcontains $origin)) {
                    $res.StatusCode = 403
                    $res.Close()
                } else {
                    if ($origin) {
                        $res.Headers.Add("Access-Control-Allow-Origin", $origin)
                        $res.Headers.Add("Vary", "Origin")
                    }
                    $path = $req.Url.AbsolutePath
                    if ($req.HttpMethod -eq "GET" -and ($path -eq "/telemetry" -or $path -eq "/status")) {
                        $payload = $script:TelemetrySnapshot.Clone()
                        $payload.minerProcessRunning = $script:IsMiningRunning
                        $payload.minerPid = $script:MinerPid
                        $payload.miningDesired = $script:MiningDesired
                        $payload.userStoppedManually = $script:UserStoppedManually
                        $payload.reconnectStage = $script:ReconnectStage
                        $payload.restartAttempts = $script:RestartCount
                        $payload.sharesAtRestart = $script:SharesAtRestart
                        $payload.recoveryConfirmed = $script:RecoveryConfirmed
                        $telemetryJson = $payload | ConvertTo-Json -Depth 5
                        $buf = [System.Text.Encoding]::UTF8.GetBytes($telemetryJson)
                        $res.StatusCode = 200
                        $res.Headers["Cache-Control"] = "no-store"
                        $res.ContentType = "application/json; charset=utf-8"
                        $res.ContentLength64 = $buf.Length
                        $res.OutputStream.Write($buf, 0, $buf.Length)
                        $res.Close()
                    } else {
                        $errJson = @{ ok = $false; error = "Команды управления через GET и внешняя смена кошелька заблокированы политикой безопасности." } | ConvertTo-Json
                        $buf = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                        $res.StatusCode = 405
                        $res.Headers["Cache-Control"] = "no-store"
                        $res.ContentType = "application/json; charset=utf-8"
                        $res.ContentLength64 = $buf.Length
                        $res.OutputStream.Write($buf, 0, $buf.Length)
                        $res.Close()
                    }
                }
            }
        } catch {
            try { $script:httpTask = $httpListener.GetContextAsync() } catch {}
        }
    }

    $script:tickSec += 2
    if ($script:tickSec -ge $CheckInterval) {
        $script:tickSec = 0
        Invoke-WatchdogCheck
    }
})

$form.Add_Shown({
    $form.Activate()
    $timer.Start()
})

[void]$form.ShowDialog()
$timer.Stop()
if ($httpListener.IsListening) { $httpListener.Stop() }
