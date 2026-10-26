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
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$MinerDir = "C:\Users\User\Documents\Codex\2026-10-25\new-chat\outputs\Pearl\miner\onezerominer-win64-1.8.3"
$LogFile = "C:\Users\User\Documents\Codex\2026-10-25\new-chat\work\pearl-miner.log"
$Worker = "dual4070ti"
$Pool1 = "stratum+tcp://prl.kryptex.network:7048"
$Pool2 = "stratum+tcp://prl-eu.kryptex.network:7048"
$ApiPort = 3001
$BridgePort = 3002
$CheckInterval = 15
$MaxTemp = 85
$CriticalStopTemp = 88
$EmergencyPL = 125
$ZeroHashLimitSec = 90
$MaxRestartAttempts = 3

# Текущая версия агента и канал проверки обновлений (GitHub Releases)
$AppVersion = "3.1.0"
$UpdateRepo = "pearl-miner/pearl-rig-control"
$script:LatestVersion = $null
$script:UpdateAvailable = $false
$script:DownloadActive = $false
$script:DownloadProgress = 0

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

# Публичный адрес кошелька Pearl по умолчанию (только адрес выплат, без секретных ключей)
$DefaultWallet = "prl1psn90qwn5r86z4rhfaz2tmetf5uhtvcxl82e6xrmv62rka2jvk9dsvs0ayz"
$Wallet = $DefaultWallet
$WalletSaved = $true
$WalletEditMode = $false

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

function Test-PearlWalletFormat([string]$Addr) {
    if ([string]::IsNullOrWhiteSpace($Addr)) {
        return @{ Valid = $false; Reason = "Адрес пуст. Введите публичный адрес кошелька Pearl (prl1p... 63 символа)." }
    }
    $clean = $Addr.Trim()
    if ($clean -match "\s" -or $clean -match "^[0-9a-fA-F]{64}$" -or $clean.StartsWith("0x") -or $clean.StartsWith("xprv")) {
        return @{ Valid = $false; Reason = "ОШИБКА: Не вводите seed-фразу или приватный ключ! Нужен только публичный адрес prl1p..." }
    }
    $lower = $clean.ToLowerInvariant()
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
$form.Text = "Pearl Rig Control v3.0 [$Worker] - Dual RTX 4070 Ti"
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

# БЛОК 2b: Обновление агента (версия, проверка, огненная шкала загрузки)
$lblVersion = New-Object System.Windows.Forms.Label
$lblVersion.Text = "Версия агента: v$AppVersion"
$lblVersion.Font = New-Object System.Drawing.Font("Consolas", 9, [System.Drawing.FontStyle]::Bold)
$lblVersion.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$lblVersion.Location = New-Object System.Drawing.Point(700, 178)
$lblVersion.Size = New-Object System.Drawing.Size(200, 22)
$form.Controls.Add($lblVersion)

$btnCheckUpdate = New-Object System.Windows.Forms.Button
$btnCheckUpdate.Text = "Проверить обновления"
$btnCheckUpdate.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$btnCheckUpdate.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnCheckUpdate.ForeColor = [System.Drawing.Color]::FromArgb(125, 211, 252)
$btnCheckUpdate.FlatStyle = "Flat"
$btnCheckUpdate.Location = New-Object System.Drawing.Point(905, 174)
$btnCheckUpdate.Size = New-Object System.Drawing.Size(180, 30)
$form.Controls.Add($btnCheckUpdate)

$lblUpdateInfo = New-Object System.Windows.Forms.Label
$lblUpdateInfo.Text = ""
$lblUpdateInfo.Font = New-Object System.Drawing.Font("Consolas", 9, [System.Drawing.FontStyle]::Bold)
$lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
$lblUpdateInfo.Location = New-Object System.Drawing.Point(20, 214)
$lblUpdateInfo.Size = New-Object System.Drawing.Size(1065, 20)
$form.Controls.Add($lblUpdateInfo)

$pbarDownload = New-Object System.Windows.Forms.ProgressBar
$pbarDownload.Style = "Continuous"
$pbarDownload.Minimum = 0
$pbarDownload.Maximum = 100
$pbarDownload.Value = 0
$pbarDownload.Visible = $false
$pbarDownload.Location = New-Object System.Drawing.Point(20, 238)
$pbarDownload.Size = New-Object System.Drawing.Size(1065, 18)
$form.Controls.Add($pbarDownload)

$script:updateLayer = $null
$script:updateTimer = $null

function Start-FireProgressBar {
    if ($script:updateLayer -and -not $script:updateLayer.IsDisposed) { return }
    $layer = New-Object System.Windows.Forms.Panel
    $layer.Location = $pbarDownload.Location
    $layer.Size = $pbarDownload.Size
    $layer.BackColor = [System.Drawing.Color]::Transparent
    $pbarDownload.Parent.Controls.Add($layer)
    $layer.BringToFront()
    $script:updateLayer = $layer

    $tm = New-Object System.Windows.Forms.Timer
    $tm.Interval = 80
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $tm.Add_Tick({
        if (-not $script:updateLayer -or $script:updateLayer.IsDisposed) { $tm.Stop(); return }
        $g = $script:updateLayer.CreateGraphics()
        try {
            $g.Clear([System.Drawing.Color]::Transparent)
            $w = $script:updateLayer.Width
            $h = $script:updateLayer.Height
            $frac = $pbarDownload.Value / 100.0
            $fillW = [int]($w * $frac)
            if ($fillW -gt 2) {
                $cols = @([System.Drawing.Color]::FromArgb(255, 220, 38, 38), [System.Drawing.Color]::FromArgb(255, 249, 115, 22), [System.Drawing.Color]::FromArgb(255, 251, 191, 36))
                $segW = [Math]::Max(6, [int]($fillW / 24))
                $x = 0
                $ci = 0
                while ($x -lt $fillW) {
                    $brush = New-Object System.Drawing.SolidBrush($cols[$ci % 3])
                    $g.FillRectangle($brush, $x, 0, [Math]::Min($segW, $fillW - $x), $h)
                    $brush.Dispose()
                    $x += $segW
                    $ci++
                }
                $flicker = [System.Drawing.Color]::FromArgb(255, 254, 240, 138)
                if (((Get-Date).Millisecond -band 1) -eq 0) {
                    $fb = New-Object System.Drawing.SolidBrush($flicker)
                    $g.FillRectangle($fb, [Math]::Max(0, $fillW - 6), 0, 6, $h)
                    $fb.Dispose()
                }
            }
            $txt = "$($pbarDownload.Value)% · v$AppVersion -> v$($script:LatestVersion)"
            $fmt = New-Object System.Drawing.StringFormat
            $fmt.Alignment = "Center"
            $rect = New-Object System.Drawing.RectangleF(0, 0, $w, $h)
            $g.DrawString($txt, $script:updateLayer.Font, [System.Drawing.Brushes]::White, $rect, $fmt)
            $fmt.Dispose()
        } finally {
            $g.Dispose()
        }
        if ($sw.Elapsed.TotalSeconds -gt 1.5) {
            $script:updateLayer.Invalidate()
            $pbarDownload.Invalidate()
            $sw.Restart()
        }
    })
    $script:updateTimer = $tm
    $tm.Start()
}

function Stop-FireProgressBar {
    if ($script:updateTimer) { $script:updateTimer.Stop(); $script:updateTimer.Dispose(); $script:updateTimer = $null }
    if ($script:updateLayer -and -not $script:updateLayer.IsDisposed) {
        $script:updateLayer.Visible = $false
        $script:updateLayer.Dispose()
    }
    $script:updateLayer = $null
}

function Get-GitHubLatestRelease {
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$UpdateRepo/releases/latest" -Method Get -TimeoutSec 8 -Headers @{ "User-Agent" = "PearlRigControl"; "Accept" = "application/vnd.github+json" } -ErrorAction Stop
        $tag = [string]$rel.tag_name
        $ver = $tag -replace "^[vV]", ""
        $assetUrl = $null
        foreach ($a in $rel.assets) {
            if ($a.name -like "*PearlRigControl-Setup*") { $assetUrl = [string]$a.browser_download_url; break }
        }
        if (-not $assetUrl -and $rel.assets.Count -gt 0) { $assetUrl = [string]$rel.assets[0].browser_download_url }
        return @{ Version = $ver; Url = $assetUrl }
    } catch {
        return $null
    }
}

function Test-UpdateAvailable {
    $latest = Get-GitHubLatestRelease
    if (-not $latest -or -not $latest.Version) {
        Write-AgentLog "WARN" "Не удалось получить информацию о последней версии агента (нет доступа к GitHub Releases)."
        $lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        $lblUpdateInfo.Text = "Обновления: нет связи с GitHub Releases — повторите позже."
        return
    }
    $script:LatestVersion = $latest.Version
    try {
        $cur = [System.Version]$AppVersion
        $new = [System.Version]$latest.Version
        $script:UpdateAvailable = ($new -gt $cur)
    } catch {
        $script:UpdateAvailable = ($latest.Version -ne $AppVersion)
    }
    if ($script:UpdateAvailable) {
        $lblVersion.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
        $lblVersion.Text = "Версия агента: v$AppVersion → доступна v$($latest.Version)"
        $lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(251, 146, 60)
        $lblUpdateInfo.Text = "ОБНАРУЖЕНА НОВАЯ ВЕРСИЯ: v$($latest.Version). Нажмите «Скачать v$($latest.Version)»."
        $btnCheckUpdate.Text = "Скачать v$($latest.Version)"
        $btnCheckUpdate.BackColor = [System.Drawing.Color]::FromArgb(234, 88, 12)
        $btnCheckUpdate.ForeColor = [System.Drawing.Color]::White
        Write-AgentLog "OK" "Обнаружена новая версия агента: v$($latest.Version) (текущая v$AppVersion)."
    } else {
        $lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        $lblUpdateInfo.Text = "Обновления: ваша версия v$AppVersion актуальна (последняя release: v$($latest.Version))."
        Write-AgentLog "INFO" "Проверка обновлений: установлена актуальная версия v$AppVersion."
    }
}

function Start-AgentUpdateDownload {
    if ($script:DownloadActive) { return }
    $latest = Get-GitHubLatestRelease
    if (-not $latest -or -not $latest.Url) {
        Write-AgentLog "ERROR" "Не найден файл установки для скачивания в последнем релизе."
        return
    }
    $script:DownloadActive = $true
    $script:DownloadProgress = 0
    $pbarDownload.Value = 0
    $pbarDownload.Visible = $true
    Start-FireProgressBar
    $lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(251, 146, 60)
    $lblUpdateInfo.Text = "Загрузка v$($latest.Version)... 0%"
    $btnCheckUpdate.Enabled = $false
    Write-AgentLog "INFO" "Начата загрузка новой версии агента v$($latest.Version): $($latest.Url)"

    $tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "PearlRigControl-Setup-$($latest.Version).exe"
    try {
        $req = [System.Net.HttpWebRequest]::Create($latest.Url)
        $req.UserAgent = "PearlRigControl"
        $req.AllowAutoRedirect = $true
        $resp = $req.GetResponse()
        $total = [int]$resp.ContentLength
        if ($total -lt 1) { $total = 25000000 }
        $inStream = $resp.GetResponseStream()
        $outStream = [System.IO.File]::Create($tmpFile)
        $buffer = New-Object byte[] 65536
        $done = 0
        while ($true) {
            $read = $inStream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            $outStream.Write($buffer, 0, $read)
            $done += $read
            $pct = [Math]::Min(100, [int](($done * 100.0) / $total))
            $pbarDownload.Value = $pct
            $script:DownloadProgress = $pct
            $lblUpdateInfo.Text = "Загрузка v$($latest.Version)... $pct% ($([Math]::Round($done/1MB, 1)) МБ из $([Math]::Round($total/1MB, 1)) МБ)"
        }
        $outStream.Close(); $inStream.Close(); $resp.Close()
        Stop-FireProgressBar
        $pbarDownload.Visible = $false
        $lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        $lblUpdateInfo.Text = "Загрузка v$($latest.Version) завершена (100%). Установщик сохранён: $tmpFile"
        Write-AgentLog "OK" "Новая версия v$($latest.Version) загружена в $tmpFile. Для обновления запустите установщик."
        $confirm = [System.Windows.Forms.MessageBox]::Show("Установка v$($latest.Version) успешно загружена.`n`nЗапустить установщик прямо сейчас?", "Обновление готово", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
            Start-Process -FilePath $tmpFile
        }
    } catch {
        Stop-FireProgressBar
        $pbarDownload.Visible = $false
        $lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        $lblUpdateInfo.Text = "Ошибка загрузки обновления: $($_.Exception.Message)"
        Write-AgentLog "ERROR" "Сбой при загрузке обновления: $($_.Exception.Message)"
    } finally {
        $script:DownloadActive = $false
        $btnCheckUpdate.Enabled = $true
    }
}

# БЛОК 3: Карточки реальной телеметрии (без выдуманных чисел)
$lblTelemetryBox = New-Object System.Windows.Forms.Label
$lblTelemetryBox.Font = New-Object System.Drawing.Font("Consolas", 9.5)
$lblTelemetryBox.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$lblTelemetryBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblTelemetryBox.BorderStyle = "FixedSingle"
$lblTelemetryBox.Location = New-Object System.Drawing.Point(20, 264)
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
    return "$val$suffix"
}

function Update-TelemetryDisplay {
    $poolStr = if ($null -eq $script:PoolConnected) { "нет данных" } elseif ($script:PoolConnected) { "Connected ($($script:ActivePoolUrl))" } else { "Disconnected" }
    $apiStr = if ($script:ApiAvailable) { "Доступен (127.0.0.1:$ApiPort)" } else { "нет данных (API 127.0.0.1:$ApiPort недоступен)" }
    $nvmlStr = if ($script:NvmlAvailable) { "Доступен (nvidia-smi)" } else { "нет данных (nvidia-smi недоступен)" }
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
        "  Суммарный хешрейт    : $(Format-Metric $script:TotalHash ' MH/s')   (GPU #0: $(Format-Metric $script:Gpu0Hash ' MH/s') | GPU #1: $(Format-Metric $script:Gpu1Hash ' MH/s'))",
        "  Шар принято / откл.  : $(Format-Metric $script:SharesAcc) / $(Format-Metric $script:SharesRej)   | Время работы майнера: $(Format-Metric $script:UptimeSec ' сек')",
        "",
        "ДАТЧИКИ ВИДЕОКАРТ (из nvidia-smi, профиль: PL 150W, MClk 810 MHz, CClk 2400 MHz, Kernel 2, Fan 65%/*):",
        "  GPU #0 (RTX 4070 Ti) : Темп: $(Format-Metric $script:Gpu0Temp ' °C') | Мощность: $(Format-Metric $script:Gpu0Power ' Вт') | Кулер: $(Format-Metric $script:Gpu0Fan ' %') | Частоты: $(Format-Metric $script:Gpu0CClkNow)/$(Format-Metric $script:Gpu0MClkNow) MHz",
        "  GPU #1 (RTX 4070 Ti) : Темп: $(Format-Metric $script:Gpu1Temp ' °C') | Мощность: $(Format-Metric $script:Gpu1Power ' Вт') | Кулер: $(Format-Metric $script:Gpu1Fan ' %') | Частоты: $(Format-Metric $script:Gpu1CClkNow)/$(Format-Metric $script:Gpu1MClkNow) MHz"
    )
    $lblTelemetryBox.Text = ($lines -join "`r`n")
}

function Poll-RealTelemetry {
    $proc = Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) {
        $script:IsMiningRunning = $true
        $script:MinerPid = $proc.Id
    } else {
        $script:IsMiningRunning = $false
        $script:MinerPid = $null
    }

    $script:ApiAvailable = $false
    $script:Gpu0Hash = $null
    $script:Gpu1Hash = $null
    $script:TotalHash = $null
    $script:SharesAcc = $null
    $script:SharesRej = $null
    $script:PoolConnected = $null
    $script:ActivePoolUrl = $null
    $script:UptimeSec = $null

    try {
        $apiResp = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/" -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($null -ne $apiResp) {
            $script:ApiAvailable = $true
            if ($null -ne $apiResp.uptime_seconds) { $script:UptimeSec = [int]$apiResp.uptime_seconds }
            elseif ($null -ne $apiResp.uptime) { $script:UptimeSec = [int]$apiResp.uptime }

            if ($apiResp.algos -and $apiResp.algos.Count -gt 0) {
                $algo = $apiResp.algos[0]
                if ($null -ne $algo.total_hashrate) {
                    $rawTotal = [double]$algo.total_hashrate
                    $script:TotalHash = if ($rawTotal -gt 10000) { [Math]::Round($rawTotal / 1000000.0, 2) } else { [Math]::Round($rawTotal, 2) }
                }
                if ($algo.hashrates -and $algo.hashrates.Count -ge 2) {
                    $h0 = [double]$algo.hashrates[0]
                    $h1 = [double]$algo.hashrates[1]
                    $script:Gpu0Hash = if ($h0 -gt 10000) { [Math]::Round($h0 / 1000000.0, 2) } else { [Math]::Round($h0, 2) }
                    $script:Gpu1Hash = if ($h1 -gt 10000) { [Math]::Round($h1 / 1000000.0, 2) } else { [Math]::Round($h1, 2) }
                }
                if ($null -ne $algo.total_accepted_shares) { $script:SharesAcc = [int]$algo.total_accepted_shares }
                if ($null -ne $algo.total_rejected_shares) { $script:SharesRej = [int]$algo.total_rejected_shares }
                if ($null -ne $algo.pool_connected) { $script:PoolConnected = [bool]$algo.pool_connected }
                elseif ($algo.pool_status) { $script:PoolConnected = ($algo.pool_status -match "Connected|Online|Active") }
                elseif ($null -ne $script:TotalHash) { $script:PoolConnected = ($script:TotalHash -gt 0) }
                if ($algo.pool) { $script:ActivePoolUrl = [string]$algo.pool } else { $script:ActivePoolUrl = $Pool1 }
            } elseif ($apiResp.devices) {
                $sumH = 0.0
                $accS = 0
                $rejS = 0
                if ($apiResp.devices.Count -ge 1) {
                    $d0 = [double]$apiResp.devices[0].hashrate
                    $script:Gpu0Hash = if ($d0 -gt 10000) { [Math]::Round($d0 / 1000000.0, 2) } else { [Math]::Round($d0, 2) }
                    $sumH += $script:Gpu0Hash
                    if ($null -ne $apiResp.devices[0].accepted_shares) { $accS += [int]$apiResp.devices[0].accepted_shares }
                    if ($null -ne $apiResp.devices[0].rejected_shares) { $rejS += [int]$apiResp.devices[0].rejected_shares }
                }
                if ($apiResp.devices.Count -ge 2) {
                    $d1 = [double]$apiResp.devices[1].hashrate
                    $script:Gpu1Hash = if ($d1 -gt 10000) { [Math]::Round($d1 / 1000000.0, 2) } else { [Math]::Round($d1, 2) }
                    $sumH += $script:Gpu1Hash
                    if ($null -ne $apiResp.devices[1].accepted_shares) { $accS += [int]$apiResp.devices[1].accepted_shares }
                    if ($null -ne $apiResp.devices[1].rejected_shares) { $rejS += [int]$apiResp.devices[1].rejected_shares }
                }
                $script:TotalHash = [Math]::Round($sumH, 2)
                $script:SharesAcc = $accS
                $script:SharesRej = $rejS
                $script:PoolConnected = ($script:TotalHash -gt 0)
                $script:ActivePoolUrl = $Pool1
            }
        }
    } catch {
        $script:ApiAvailable = $false
    }

    $script:NvmlAvailable = $false
    $script:Gpu0Temp = $null; $script:Gpu1Temp = $null
    $script:Gpu0Power = $null; $script:Gpu1Power = $null
    $script:Gpu0Fan = $null; $script:Gpu1Fan = $null
    $script:Gpu0CClkNow = $null; $script:Gpu1CClkNow = $null
    $script:Gpu0MClkNow = $null; $script:Gpu1MClkNow = $null

    try {
        $smiOut = & nvidia-smi --query-gpu=index,temperature.gpu,power.draw,fan.speed,clocks.current.graphics,clocks.current.memory --format=csv,noheader,nounits 2>$null
        if ($LASTEXITCODE -eq 0 -and $smiOut) {
            $lines = @($smiOut -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
            if ($lines.Count -ge 1) {
                $script:NvmlAvailable = $true
                foreach ($line in $lines) {
                    $parts = $line -split ","
                    if ($parts.Count -ge 6) {
                        $idx = [int]($parts[0].Trim())
                        $tVal = 0; $pVal = 0.0; $fVal = 0; $ccVal = 0; $mcVal = 0
                        $tOk = [int]::TryParse($parts[1].Trim(), [ref]$tVal)
                        $pOk = [double]::TryParse(($parts[2].Trim() -replace ",", "."), [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$pVal)
                        $fOk = [int]::TryParse($parts[3].Trim(), [ref]$fVal)
                        $ccOk = [int]::TryParse($parts[4].Trim(), [ref]$ccVal)
                        $mcOk = [int]::TryParse($parts[5].Trim(), [ref]$mcVal)
                        if ($idx -eq 0) {
                            if ($tOk) { $script:Gpu0Temp = $tVal }
                            if ($pOk) { $script:Gpu0Power = [Math]::Round($pVal, 1) }
                            if ($fOk) { $script:Gpu0Fan = $fVal }
                            if ($ccOk) { $script:Gpu0CClkNow = $ccVal }
                            if ($mcOk) { $script:Gpu0MClkNow = $mcVal }
                        } elseif ($idx -eq 1) {
                            if ($tOk) { $script:Gpu1Temp = $tVal }
                            if ($pOk) { $script:Gpu1Power = [Math]::Round($pVal, 1) }
                            if ($fOk) { $script:Gpu1Fan = $fVal }
                            if ($ccOk) { $script:Gpu1CClkNow = $ccVal }
                            if ($mcOk) { $script:Gpu1MClkNow = $mcVal }
                        }
                    }
                }
            }
        }
    } catch {
        $script:NvmlAvailable = $false
    }

    Update-TelemetryDisplay
}

function Start-MinerProcess([bool]$IsWatchdogRestart = $false) {
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
    $minerArgs = "-a pearl -w $($script:Wallet) -o $Pool1 -o $Pool2 --worker $Worker --cclk $CurrentCClk --mclk $CurrentMClk --pl $CurrentPL --kernel $CurrentKernel --fan $CurrentFan --api-port $ApiPort --log-file `"$LogFile`""
    $started = Start-Process -FilePath "$MinerDir\onezerominer.exe" -ArgumentList $minerArgs -WindowStyle Minimized -PassThru
    $script:IsMiningRunning = $true
    $script:MinerPid = if ($started) { $started.Id } else { $null }

    $lblStatus.Text = "Статус: МАЙНЕР ЗАПУЩЕН (PID $($script:MinerPid)) -> $Pool1"
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
    Write-AgentLog "OK" "Запущен onezerominer.exe (PID $($script:MinerPid)): -w $($script:Wallet) -o $Pool1 --cclk $CurrentCClk --mclk $CurrentMClk --pl $CurrentPL --kernel $CurrentKernel --fan $CurrentFan"
    Poll-RealTelemetry
}

function Stop-MinerProcess([string]$Reason = "Нажата кнопка «Стоп» пользователем") {
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
            Write-AgentLog "OK" "Восстановление подтверждено: пул Connected, хешрейт $($script:TotalHash) MH/s, принята новая шара ($($script:SharesAcc) > $($script:SharesAtRestart))."
            $lblStatus.Text = "Статус: МАЙНИНГ ВОССТАНОВЛЕН И ПОДТВЕРЖДЁН ($($script:TotalHash) MH/s)"
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
    $script:SharesAtRestart = if ($null -ne $script:SharesAcc) { $script:SharesAcc } else { 0 }
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

# Кнопка обновлений: без новой версии — повторная проверка; с новой версией — загрузка с огненной шкалой
$btnCheckUpdate.Add_Click({
    if ($script:DownloadActive) { return }
    if ($script:UpdateAvailable -and $script:LatestVersion) {
        Start-AgentUpdateDownload
    } else {
        $lblUpdateInfo.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
        $lblUpdateInfo.Text = "Проверка обновлений на GitHub Releases..."
        Test-UpdateAvailable
    }
})

$existingOnOpen = Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingOnOpen) {
    $script:IsMiningRunning = $true
    $script:MiningDesired = $true
    $script:MinerPid = $existingOnOpen.Id
    $lblStatus.Text = "Статус: Обнаружен уже работающий OneZeroMiner (PID $($existingOnOpen.Id)). Мониторинг подключён."
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
    Write-AgentLog "INFO" "При открытии обнаружен работающий процесс onezerominer.exe (PID $($existingOnOpen.Id)). Остановка или дублирующий запуск не выполнялись."
} else {
    Write-AgentLog "INFO" "Панель открыта. Автозапуск майнера отключён. Проверьте сохранённый адрес кошелька и нажмите «▶ ЗАПУСТИТЬ»."
}

Sync-WalletUiState
Poll-RealTelemetry
Test-UpdateAvailable

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
                        $telemetryJson = @{
                            ok = $true
                            minerProcessRunning = $script:IsMiningRunning
                            minerPid = $script:MinerPid
                            miningDesired = $script:MiningDesired
                            userStoppedManually = $script:UserStoppedManually
                            apiAvailable = $script:ApiAvailable
                            nvmlAvailable = $script:NvmlAvailable
                            poolConnected = $script:PoolConnected
                            poolUrl = $script:ActivePoolUrl
                            uptimeSec = $script:UptimeSec
                            totalHashrateMHs = $script:TotalHash
                            acceptedShares = $script:SharesAcc
                            rejectedShares = $script:SharesRej
                            reconnectStage = $script:ReconnectStage
                            restartAttempts = $script:RestartCount
                            recoveryConfirmed = $script:RecoveryConfirmed
                            gpus = @(
                                @{
                                    id = 0
                                    hashrateMHs = $script:Gpu0Hash
                                    tempC = $script:Gpu0Temp
                                    powerWatts = $script:Gpu0Power
                                    fanPercent = $script:Gpu0Fan
                                    cclkMHz = $script:Gpu0CClkNow
                                    mclkMHz = $script:Gpu0MClkNow
                                },
                                @{
                                    id = 1
                                    hashrateMHs = $script:Gpu1Hash
                                    tempC = $script:Gpu1Temp
                                    powerWatts = $script:Gpu1Power
                                    fanPercent = $script:Gpu1Fan
                                    cclkMHz = $script:Gpu1CClkNow
                                    mclkMHz = $script:Gpu1MClkNow
                                }
                            )
                        } | ConvertTo-Json -Depth 4
                        $buf = [System.Text.Encoding]::UTF8.GetBytes($telemetryJson)
                        $res.StatusCode = 200
                        $res.ContentType = "application/json; charset=utf-8"
                        $res.ContentLength64 = $buf.Length
                        $res.OutputStream.Write($buf, 0, $buf.Length)
                        $res.Close()
                    } else {
                        $errJson = @{ ok = $false; error = "Команды управления через GET и внешняя смена кошелька заблокированы политикой безопасности." } | ConvertTo-Json
                        $buf = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                        $res.StatusCode = 405
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