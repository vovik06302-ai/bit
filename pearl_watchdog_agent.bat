@echo off
chcp 65001 >nul
title Pearl Rig Control [dual4070ti]

:: ============================================================================
:: 1. АВТОМАТИЧЕСКИЙ ЗАПРОС ПРАВ АДМИНИСТРАТОРА (ДЛЯ РАЗГОНА И МАРШРУТОВ VPN)
:: ============================================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "SELF_BAT=%~f0"
set "PS_AGENT=%TEMP%\pearl_rig_gui_supervisor.ps1"

powershell -NoProfile -Command "$lines = Get-Content -LiteralPath $env:SELF_BAT -Encoding UTF8; $idx = [Array]::IndexOf($lines, ':: ___PS_START___'); if ($idx -ge 0) { Set-Content -LiteralPath $env:PS_AGENT -Value $lines[($idx+1)..($lines.Length-1)] -Encoding UTF8 }"

start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%PS_AGENT%"
exit /b

:: ___PS_START___
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$MinerDir = "C:\Users\User\Documents\Codex\2026-10-25\new-chat\outputs\Pearl\miner\onezerominer-win64-1.8.3"
$LogFile = "C:\Users\User\Documents\Codex\2026-10-25\new-chat\work\pearl-miner.log"
$Wallet = "prl1psn90qwn5r86zjvk9dsvs0ayz"
$Worker = "dual4070ti"
$Pool1 = "prl.kryptex.network:7048"
$Pool2 = "prl-eu.kryptex.network:7048"
$ApiPort = 4000
$BridgePort = 3002
$CheckInterval = 15
$MaxTemp = 72
$EmergencyPL = 125
$ZeroHashLimitSec = 90
$AutoBypassVPN = $true
$FixHostsFakeIP = $true
$TgEnabled = $false
$TgToken = ""
$TgChatId = ""

# Параметры GitHub OTA
$GhEnabled = $true
$GhOwner = "vovik06302-ai"
$GhRepo = "bit"
$GhBranch = "main"
$GhToken = ""
$GhPullIntervalSec = 300
$GhAutoConfig = $true
$GhAutoSelfUpdate = $true

$CurrentCClk = "2400,2400"
$CurrentMClk = "810,810"
$CurrentPL = "150,150"
$CurrentKernel = "2,2"
$CurrentFan = "65,*"

$MiningDesired = $true
$ZeroHashCounter = 0
$GhTimerSec = 0
$LastTgUpdateId = 0
$RestartCount = 0
$LastConfigSignature = "$MiningDesired|$Wallet|$Worker|$Pool1|$Pool2|$CurrentCClk|$CurrentMClk|$CurrentPL|$CurrentFan|$MaxTemp"

# ============================================================================
# СОЗДАНИЕ ОКНА ПРОГРАММЫ PEARL RIG CONTROL С КНОПКОЙ ЗАПУСКА МАЙНИНГА
# ============================================================================
$form = New-Object System.Windows.Forms.Form
$form.Text = "Pearl Rig Control [$Worker] - Dual RTX 4070 Ti"
$form.Size = New-Object System.Drawing.Size(680, 565)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$form.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "Pearl Rig Control · Dual RTX 4070 Ti"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$lblTitle.Location = New-Object System.Drawing.Point(20, 16)
$lblTitle.Size = New-Object System.Drawing.Size(420, 28)
$form.Controls.Add($lblTitle)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Статус: Готов к запуску | Обход INCY VPN: Активен"
$lblStatus.Font = New-Object System.Drawing.Font("Consolas", 9.5)
$lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$lblStatus.Location = New-Object System.Drawing.Point(20, 48)
$lblStatus.Size = New-Object System.Drawing.Size(620, 22)
$form.Controls.Add($lblStatus)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "▶ ЗАПУСТИТЬ МАЙНИНГ"
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$btnStart.ForeColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$btnStart.FlatStyle = "Flat"
$btnStart.Location = New-Object System.Drawing.Point(20, 78)
$btnStart.Size = New-Object System.Drawing.Size(210, 42)
$form.Controls.Add($btnStart)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "■ ОСТАНОВИТЬ"
$btnStop.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.FlatStyle = "Flat"
$btnStop.Location = New-Object System.Drawing.Point(240, 78)
$btnStop.Size = New-Object System.Drawing.Size(145, 42)
$form.Controls.Add($btnStop)

$btnVpn = New-Object System.Windows.Forms.Button
$btnVpn.Text = "Обход VPN /32"
$btnVpn.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$btnVpn.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnVpn.ForeColor = [System.Drawing.Color]::White
$btnVpn.FlatStyle = "Flat"
$btnVpn.Location = New-Object System.Drawing.Point(395, 78)
$btnVpn.Size = New-Object System.Drawing.Size(120, 42)
$form.Controls.Add($btnVpn)

$btnGit = New-Object System.Windows.Forms.Button
$btnGit.Text = "GitHub OTA"
$btnGit.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$btnGit.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnGit.ForeColor = [System.Drawing.Color]::White
$btnGit.FlatStyle = "Flat"
$btnGit.Location = New-Object System.Drawing.Point(525, 78)
$btnGit.Size = New-Object System.Drawing.Size(120, 42)
$form.Controls.Add($btnGit)

$lblWallet = New-Object System.Windows.Forms.Label
$lblWallet.Text = "Адрес кошелька Pearl (-w):"
$lblWallet.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$lblWallet.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$lblWallet.Location = New-Object System.Drawing.Point(20, 128)
$lblWallet.Size = New-Object System.Drawing.Size(260, 16)
$form.Controls.Add($lblWallet)

$txtWallet = New-Object System.Windows.Forms.TextBox
$txtWallet.Text = $Wallet
$txtWallet.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$txtWallet.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$txtWallet.Font = New-Object System.Drawing.Font("Consolas", 9.5)
$txtWallet.Location = New-Object System.Drawing.Point(20, 146)
$txtWallet.Size = New-Object System.Drawing.Size(445, 28)
$form.Controls.Add($txtWallet)

$btnSaveWallet = New-Object System.Windows.Forms.Button
$btnSaveWallet.Text = "💾 ИЗМЕНИТЬ КОШЕЛЁК"
$btnSaveWallet.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$btnSaveWallet.BackColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$btnSaveWallet.ForeColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$btnSaveWallet.FlatStyle = "Flat"
$btnSaveWallet.Location = New-Object System.Drawing.Point(475, 143)
$btnSaveWallet.Size = New-Object System.Drawing.Size(170, 30)
$form.Controls.Add($btnSaveWallet)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(7, 10, 16)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 9)
$txtLog.Location = New-Object System.Drawing.Point(20, 184)
$txtLog.Size = New-Object System.Drawing.Size(625, 320)
$form.Controls.Add($txtLog)

function Write-AgentLog([string]$Level, [string]$Msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    $line = "[$ts][$Level] $Msg`r`n"
    if ($txtLog -and -not $txtLog.IsDisposed) {
        $txtLog.AppendText($line)
    }
}

function Ensure-DesktopShortcut {
    try {
        $installDir = "$env:LOCALAPPDATA\Programs\PearlRigControl"
        if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Path $installDir -Force | Out-Null }
        $installedBat = "$installDir\pearl_watchdog_agent.bat"
        $iconPath = "$installDir\pearl-icon.ico"

        if ($env:SELF_BAT -and ($env:SELF_BAT -ne $installedBat)) {
            Copy-Item -LiteralPath $env:SELF_BAT -Destination $installedBat -Force
        }

        if (-not (Test-Path $iconPath)) {
            $bmp = New-Object System.Drawing.Bitmap(64, 64)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 15, 23))
            $g.FillEllipse($bgBrush, 2, 2, 60, 60)
            $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 16, 185, 129), 4)
            $g.DrawEllipse($ringPen, 6, 6, 52, 52)
            $pearlBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 52, 211, 153))
            $g.FillEllipse($pearlBrush, 20, 20, 24, 24)
            $g.Dispose()
            $hIcon = $bmp.GetHicon()
            $icon = [System.Drawing.Icon]::FromHandle($hIcon)
            $fs = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create)
            $icon.Save($fs)
            $fs.Close()
            $bmp.Dispose()
        }

        if (Test-Path $iconPath) {
            $form.Icon = New-Object System.Drawing.Icon($iconPath)
        }

        $desktopPath = [Environment]::GetFolderPath("Desktop")
        $lnkPath = Join-Path $desktopPath "Pearl Rig Control.lnk"
        if (-not (Test-Path $lnkPath)) {
            $wsh = New-Object -ComObject WScript.Shell
            $sc = $wsh.CreateShortcut($lnkPath)
            $sc.TargetPath = $installedBat
            $sc.WorkingDirectory = $installDir
            $sc.IconLocation = "$iconPath,0"
            $sc.Description = "Pearl Rig Control & Watchdog ($Worker)"
            $sc.Save()

            $bytes = [System.IO.File]::ReadAllBytes($lnkPath)
            $bytes[0x15] = $bytes[0x15] -bor 0x20
            [System.IO.File]::WriteAllBytes($lnkPath, $bytes)
            Write-AgentLog "OK" "Ярлык «Pearl Rig Control» создан на Рабочем столе."
        }
    } catch {}
}

function Repair-VpnBypassRoutes {
    if (-not $AutoBypassVPN) { return }
    $domains = @("prl.kryptex.network", "prl-eu.kryptex.network")

    $gw = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
        Where-Object {
            $_.NextHop -ne "0.0.0.0" -and
            $_.NextHop -notlike "198.18.*" -and
            $_.NextHop -notlike "172.19.*" -and
            $_.InterfaceAlias -notmatch "TUN|Meta|Clash|VPN|wintun|sing|inc"
        } | Sort-Object RouteMetric | Select-Object -First 1).NextHop

    if (-not $gw) {
        $gw = (Get-NetIPConfiguration |
            Where-Object {
                $_.IPv4DefaultGateway -ne $null -and
                $_.InterfaceAlias -notmatch "TUN|Meta|Clash|VPN|wintun|sing|inc"
            } | Select-Object -First 1).IPv4DefaultGateway.NextHop
    }

    if (-not $gw) {
        Write-AgentLog "WARN" "Шлюз роутера не определен."
        return
    }

    $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
    $hostsLines = @(Get-Content $hostsPath | Where-Object { $_ -notmatch "kryptex\.network" })
    $changedHosts = $false

    foreach ($d in $domains) {
        try {
            $doh = Invoke-RestMethod -Uri "https://dns.google/resolve?name=$d&type=A" -TimeoutSec 5
            $ips = $doh.Answer | Where-Object { $_.type -eq 1 } | Select-Object -ExpandProperty data
            if ($ips) {
                foreach ($ip in $ips) {
                    route.exe delete $ip >$null 2>&1
                    route.exe add $ip mask 255.255.255.255 $gw metric 1 >$null 2>&1
                }
                $primaryIp = ($ips | Select-Object -First 1)
                $hostsLines += "$primaryIp $d"
                $changedHosts = $true
            }
        } catch {}
    }

    if ($FixHostsFakeIP -and $changedHosts) {
        Set-Content -Path $hostsPath -Value $hostsLines -Encoding ASCII -Force
        ipconfig /flushdns >$null 2>&1
    }
    Write-AgentLog "VPN" "Маршруты /32 в обход INCY TUN активны (шлюз: $gw)"
}

function Start-MinerProcess {
    $script:MiningDesired = $true
    Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 900
    Repair-VpnBypassRoutes

    $logDir = Split-Path $LogFile -Parent
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    Set-Location $MinerDir
    $minerArgs = "-a pearl -w $Wallet -o $Pool1 -o $Pool2 --worker $Worker --cclk $CurrentCClk --mclk $CurrentMClk --pl $CurrentPL --kernel $CurrentKernel --fan $CurrentFan --api-port $ApiPort --log-file `"$LogFile`""
    Write-AgentLog "OK" "ЗАПУСК МАЙНИНГА: onezerominer.exe (CClk=$CurrentCClk, PL=$CurrentPL W)"
    Start-Process -FilePath "$MinerDir\onezerominer.exe" -ArgumentList $minerArgs -WindowStyle Minimized
    $lblStatus.Text = "Статус: МАЙНИНГ ЗАПУЩЕН (CClk=$CurrentCClk MHz | PL=$CurrentPL W)"
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
}

function Stop-MinerProcess {
    $script:MiningDesired = $false
    Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-AgentLog "WARN" "МАЙНИНГ ОСТАНОВЛЕН пользователем через программу."
    $lblStatus.Text = "Статус: МАЙНИНГ ОСТАНОВЛЕН (ожидание кнопки Запустить)"
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
}

function Sync-FromGitHub([bool]$ForceLog = $false) {
    if (-not $GhEnabled -or [string]::IsNullOrWhiteSpace($GhOwner) -or [string]::IsNullOrWhiteSpace($GhRepo)) { return }

    $headers = @{ "User-Agent" = "Pearl-Watchdog-Agent" }
    if (-not [string]::IsNullOrWhiteSpace($GhToken)) {
        $headers["Authorization"] = "Bearer $GhToken"
    }

    if ($GhAutoConfig) {
        try {
            $apiUrl = "https://api.github.com/repos/$GhOwner/$GhRepo/contents/rig-config.json?ref=$GhBranch"
            $resp = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 6
            if ($resp -and $resp.content) {
                $cleanBase64 = ($resp.content -replace "\s", "")
                $jsonText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($cleanBase64))
                $remoteCfg = $jsonText | ConvertFrom-Json

                $newActive = if ($null -ne $remoteCfg.miningActive) { [bool]$remoteCfg.miningActive } else { $MiningDesired }
                $newWallet = if ($remoteCfg.walletAddress) { $remoteCfg.walletAddress } else { $Wallet }
                $newWorker = if ($remoteCfg.workerName) { $remoteCfg.workerName } else { $Worker }
                $newPool1  = if ($remoteCfg.primaryPool) { $remoteCfg.primaryPool } else { $Pool1 }
                $newPool2  = if ($remoteCfg.backupPool) { $remoteCfg.backupPool } else { $Pool2 }
                $newCClk   = if ($remoteCfg.cclk) { $remoteCfg.cclk } else { $CurrentCClk }
                $newMClk   = if ($remoteCfg.mclk) { $remoteCfg.mclk } else { $CurrentMClk }
                $newPL     = if ($remoteCfg.pl) { $remoteCfg.pl } else { $CurrentPL }
                $newFan    = if ($remoteCfg.fan) { $remoteCfg.fan } else { $CurrentFan }
                $newTemp   = if ($remoteCfg.maxTempC) { [int]$remoteCfg.maxTempC } else { $MaxTemp }

                $newSig = "$newActive|$newWallet|$newWorker|$newPool1|$newPool2|$newCClk|$newMClk|$newPL|$newFan|$newTemp"
                if ($newSig -ne $LastConfigSignature) {
                    Write-AgentLog "GIT" "Получена команда/конфиг из GitHub ($GhOwner/$GhRepo)!"
                    $script:Wallet = $newWallet
                    $script:Worker = $newWorker
                    $script:Pool1 = $newPool1
                    $script:Pool2 = $newPool2
                    $script:CurrentCClk = $newCClk
                    $script:CurrentMClk = $newMClk
                    $script:CurrentPL = $newPL
                    $script:CurrentFan = $newFan
                    $script:MaxTemp = $newTemp
                    $script:LastConfigSignature = $newSig

                    if ($newActive) {
                        Start-MinerProcess
                    } else {
                        Stop-MinerProcess
                    }
                } elseif ($ForceLog) {
                    Write-AgentLog "GIT" "GitHub ($GhOwner/$GhRepo) проверен: изменений нет."
                }
            }
        } catch {}
    }
}

function Update-WalletAddress([string]$NewWallet) {
    $clean = $NewWallet.Trim()
    if ([string]::IsNullOrWhiteSpace($clean)) { return }
    $script:Wallet = $clean
    if ($txtWallet -and -not $txtWallet.IsDisposed) {
        $txtWallet.Text = $clean
    }
    Write-AgentLog "OK" "Адрес кошелька изменён на: $clean (длина: $($clean.Length) симв.)"
    if ($script:MiningDesired) {
        Start-MinerProcess
    }
}

$httpListener = New-Object System.Net.HttpListener
$httpListener.Prefixes.Add("http://127.0.0.1:$BridgePort/")
try {
    $httpListener.Start()
    Write-AgentLog "OK" "Локальный мост управления из браузера активен на 127.0.0.1:$BridgePort"
} catch {}

$btnStart.Add_Click({ Start-MinerProcess })
$btnStop.Add_Click({ Stop-MinerProcess })
$btnVpn.Add_Click({ Repair-VpnBypassRoutes })
$btnGit.Add_Click({ Sync-FromGitHub -ForceLog $true })
$btnSaveWallet.Add_Click({ Update-WalletAddress $txtWallet.Text })

Ensure-DesktopShortcut

if ($MiningDesired) {
    Start-MinerProcess
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$tickSec = 0

$timer.Add_Tick({
    if ($httpListener.IsListening) {
        while ($httpListener.Pending()) {
            $ctx = $httpListener.GetContext()
            $req = $ctx.Request
            $res = $ctx.Response
            $res.Headers.Add("Access-Control-Allow-Origin", "*")
            $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            $res.Headers.Add("Access-Control-Allow-Headers", "*")
            $res.Headers.Add("Access-Control-Allow-Private-Network", "true")

            if ($req.HttpMethod -eq "OPTIONS") {
                $res.StatusCode = 200
                $res.Close()
                continue
            }

            $path = $req.Url.AbsolutePath
            if ($path -eq "/start") {
                Start-MinerProcess
            } elseif ($path -eq "/stop") {
                Stop-MinerProcess
            } elseif ($path -eq "/vpn_fix") {
                Repair-VpnBypassRoutes
            } elseif ($path -eq "/set_wallet") {
                $newW = $req.QueryString["wallet"]
                if ($newW) {
                    Update-WalletAddress $newW
                }
            }

            $procNow = Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue
            $statusJson = @{ ok = $true; mining = ($null -ne $procNow); worker = $Worker; wallet = $Wallet; cclk = $CurrentCClk; pl = $CurrentPL } | ConvertTo-Json
            $buf = [System.Text.Encoding]::UTF8.GetBytes($statusJson)
            $res.ContentType = "application/json"
            $res.ContentLength64 = $buf.Length
            $res.OutputStream.Write($buf, 0, $buf.Length)
            $res.Close()
        }
    }

    $script:tickSec += 2
    if ($script:tickSec -ge $CheckInterval) {
        $script:tickSec = 0
        if ($MiningDesired) {
            $proc = Get-Process -Name "onezerominer" -ErrorAction SilentlyContinue
            if (-not $proc) {
                $script:RestartCount++
                Write-AgentLog "ERR" "Процесс майнера закрылся! Автоперезапуск #$RestartCount..."
                Start-MinerProcess
            }
        }

        $script:GhTimerSec += $CheckInterval
        if ($script:GhTimerSec -ge $GhPullIntervalSec) {
            $script:GhTimerSec = 0
            Sync-FromGitHub -ForceLog $false
        }
    }
})
$timer.Start()

[void]$form.ShowDialog()
if ($httpListener.IsListening) { $httpListener.Stop() }
