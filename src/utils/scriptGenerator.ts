import { RigConfig, WatchdogPolicy, LogDiagnosticItem } from '../types/rig';

export function validatePearlWallet(address: string): {
  valid: boolean;
  type: 'prl1p_taproot' | 'prl1q_segwit' | 'kryptex_account' | 'truncated_prl' | 'invalid';
  length: number;
  expectedLength: number;
  message: string;
} {
  const clean = address.trim();
  if (!clean) {
    return {
      valid: false,
      type: 'invalid',
      length: 0,
      expectedLength: 63,
      message: 'Адрес кошелька пуст. Укажи 63-символьный адрес prl1p... или логин Kryptex.',
    };
  }

  if (clean.startsWith('prl1p')) {
    if (clean.length === 63) {
      return {
        valid: true,
        type: 'prl1p_taproot',
        length: clean.length,
        expectedLength: 63,
        message: 'Корректный адрес Pearl Mainnet (Bech32m, 63 символа).',
      };
    }
    return {
      valid: false,
      type: 'truncated_prl',
      length: clean.length,
      expectedLength: 63,
      message: `Внимание: адрес prl1p... обрезан (${clean.length} из 63 символов). Скопируй полный адрес из кошелька Pearl, иначе пул отклонит выплаты.`,
    };
  }

  if (clean.startsWith('prl1q')) {
    if (clean.length >= 42 && clean.length <= 44) {
      return {
        valid: true,
        type: 'prl1q_segwit',
        length: clean.length,
        expectedLength: 42,
        message: `Корректный адрес Pearl (Bech32, ${clean.length} симв.).`,
      };
    }
    return {
      valid: false,
      type: 'truncated_prl',
      length: clean.length,
      expectedLength: 42,
      message: `Адрес prl1q... имеет нестандартную длину (${clean.length} симв., ожидается 42–43).`,
    };
  }

  if (clean.startsWith('krx') || clean.includes('@')) {
    return {
      valid: true,
      type: 'kryptex_account',
      length: clean.length,
      expectedLength: clean.length,
      message: 'Используется внутренний аккаунт Kryptex (автообмен в BTC/USDT).',
    };
  }

  return {
    valid: false,
    type: 'invalid',
    length: clean.length,
    expectedLength: 63,
    message: 'Неизвестный формат адреса. Адрес Pearl должен начинаться с prl1p... (63 симв.) или prl1q...',
  };
}

export function buildOneZeroMinerCommand(config: RigConfig): string {
  const cclk = `${config.gpus[0].cclk},${config.gpus[1].cclk}`;
  const mclk = `${config.gpus[0].mclk},${config.gpus[1].mclk}`;
  const pl = `${config.gpus[0].pl},${config.gpus[1].pl}`;
  const kernel = `${config.gpus[0].kernel},${config.gpus[1].kernel}`;
  const fan = `${config.gpus[0].fan},${config.gpus[1].fan}`;

  return [
    'onezerominer.exe',
    '-a pearl',
    `-w ${config.walletAddress.trim()}`,
    `-o ${config.primaryPool.trim()}`,
    config.backupPool.trim() ? `-o ${config.backupPool.trim()}` : '',
    `--worker ${config.workerName.trim()}`,
    `--cclk ${cclk}`,
    `--mclk ${mclk}`,
    `--pl ${pl}`,
    `--kernel ${kernel}`,
    `--fan ${fan}`,
    `--api-port ${config.apiPort}`,
    `--log-file "${config.logFilePath.trim()}"`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildRemoteRigConfigJson(config: RigConfig, policy: WatchdogPolicy): string {
  const payload = {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    miningActive: config.miningActive,
    workerName: config.workerName.trim(),
    walletAddress: config.walletAddress.trim(),
    primaryPool: config.primaryPool.trim(),
    backupPool: config.backupPool.trim(),
    cclk: `${config.gpus[0].cclk},${config.gpus[1].cclk}`,
    mclk: `${config.gpus[0].mclk},${config.gpus[1].mclk}`,
    pl: `${config.gpus[0].pl},${config.gpus[1].pl}`,
    kernel: `${config.gpus[0].kernel},${config.gpus[1].kernel}`,
    fan: `${config.gpus[0].fan},${config.gpus[1].fan}`,
    maxTempC: policy.maxTempC,
    emergencyPlWatts: policy.emergencyPlWatts,
    checkIntervalSec: policy.checkIntervalSec,
    zeroHashrateRestartSec: policy.zeroHashrateRestartSec,
    autoBypassVpnTun: policy.autoBypassVpnTun,
    fixHostsFakeIp: policy.fixHostsFakeIp,
  };
  return JSON.stringify(payload, null, 2);
}

export function generateInnoSetupScript(config: RigConfig): string {
  return `; Inno Setup 6 Script for PearlRigControl-Setup.exe
[Setup]
AppId={{8F9C2E41-5A7D-4E3B-9C12-7D8E4A2F6B90}
AppName=Pearl Rig Control (${config.workerName})
AppVersion=1.3.0
AppPublisher=Pearl Rig Control
DefaultDirName={autopf}\\PearlRigControl
DefaultGroupName=Pearl Rig Control
OutputBaseFilename=PearlRigControl-Setup
SetupIconFile=pearl-icon.ico
UninstallDisplayIcon={app}\\pearl-icon.ico
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
WizardStyle=modern

[Languages]
Name: "default"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "pearl_watchdog_agent.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "rig-config.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "pearl-icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Иконка на Рабочем столе (создаётся автоматически при установке)
Name: "{autodesktop}\\Pearl Rig Control"; Filename: "{app}\\pearl_watchdog_agent.bat"; WorkingDir: "{app}"; IconFilename: "{app}\\pearl-icon.ico"; Comment: "Pearl Rig Control & Mining Launcher (${config.workerName})"
; Иконка в меню Пуск
Name: "{group}\\Pearl Rig Control"; Filename: "{app}\\pearl_watchdog_agent.bat"; WorkingDir: "{app}\\pearl-icon.ico"

[Run]
Filename: "{app}\\pearl_watchdog_agent.bat"; Description: "Launch Pearl Rig Control"; Flags: nowait postinstall skipifsilent shellexec
`;
}

export function generateGitHubWorkflowYaml(): string {
  return `name: Build Pearl Rig Installer (.EXE)

on:
  push:
    branches: [ "main", "master" ]
  release:
    types: [ published, created, prereleased, edited ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-windows-installer:
    runs-on: windows-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Generate Pearl Desktop Icon (pearl-icon.ico)
        shell: pwsh
        run: |
          Add-Type -AssemblyName System.Drawing
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
          $fs = New-Object System.IO.FileStream("pearl-icon.ico", [System.IO.FileMode]::Create)
          $icon.Save($fs)
          $fs.Close()
          $bmp.Dispose()

      - name: Prepare UTF-8 BOM for Inno Setup and Compile PearlRigControl-Setup.exe
        shell: pwsh
        run: |
          $utf8Bom = New-Object System.Text.UTF8Encoding($true)
          $issContent = Get-Content -LiteralPath "installer.iss" -Raw -Encoding UTF8
          [System.IO.File]::WriteAllText((Join-Path $PWD "installer.iss"), $issContent, $utf8Bom)

          $iscc = "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe"
          if (-not (Test-Path $iscc)) {
            choco install innosetup -y
          }
          & $iscc "installer.iss"

      - name: Upload Installer Artifact
        uses: actions/upload-artifact@v4
        with:
          name: PearlRigControl-Setup
          path: Output/PearlRigControl-Setup.exe

      - name: Attach PearlRigControl-Setup.exe to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ github.event.release.tag_name || format('v1.0.{0}', github.run_number) }}
          name: \${{ github.event.release.name || format('Pearl Rig Control Installer v1.0.{0}', github.run_number) }}
          prerelease: false
          body: |
            ### Установщик программы Pearl Rig Control (Dual RTX 4070 Ti)
            1. Скачай и запусти **PearlRigControl-Setup.exe** из блока **Assets** ниже.
            2. После установки на **Рабочем столе** появится иконка **Pearl Rig Control**.
            3. В окне программы нажми кнопку **«▶ ЗАПУСТИТЬ МАЙНИНГ»**.
          files: |
            Output/PearlRigControl-Setup.exe
            pearl_watchdog_agent.bat
            rig-config.json
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}

export function generateWatchdogBatScript(config: RigConfig, policy: WatchdogPolicy): string {
  const cclk = `${config.gpus[0].cclk},${config.gpus[1].cclk}`;
  const mclk = `${config.gpus[0].mclk},${config.gpus[1].mclk}`;
  const pl = `${config.gpus[0].pl},${config.gpus[1].pl}`;
  const kernel = `${config.gpus[0].kernel},${config.gpus[1].kernel}`;
  const fan = `${config.gpus[0].fan},${config.gpus[1].fan}`;

  const gh = policy.github || {
    enabled: true,
    owner: '',
    repo: 'pearl-rig-control',
    branch: 'main',
    isPrivate: false,
    token: '',
    pullIntervalMin: 5,
    autoApplyRemoteConfig: true,
    autoSelfUpdateAgent: true,
  };

  return `@echo off
chcp 65001 >nul
title Pearl Rig Control [${config.workerName}]

:: ============================================================================
:: 1. АВТОМАТИЧЕСКИЙ ЗАПРОС ПРАВ АДМИНИСТРАТОРА (ДЛЯ РАЗГОНА И МАРШРУТОВ VPN)
:: ============================================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "SELF_BAT=%~f0"
set "PS_AGENT=%TEMP%\\pearl_rig_gui_supervisor.ps1"

powershell -NoProfile -Command "$lines = Get-Content -LiteralPath $env:SELF_BAT -Encoding UTF8; $idx = [Array]::IndexOf($lines, ':: ___PS_START___'); if ($idx -ge 0) { Set-Content -LiteralPath $env:PS_AGENT -Value $lines[($idx+1)..($lines.Length-1)] -Encoding UTF8 }"

start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%PS_AGENT%"
exit /b

:: ___PS_START___
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$MinerDir = "${config.minerDir}"
$LogFile = "${config.logFilePath}"
$Wallet = "${config.walletAddress.trim()}"
$Worker = "${config.workerName.trim()}"
$Pool1 = "${config.primaryPool.trim()}"
$Pool2 = "${config.backupPool.trim()}"
$ApiPort = ${config.apiPort}
$BridgePort = ${config.agentBridgePort}
$CheckInterval = ${policy.checkIntervalSec}
$MaxTemp = ${policy.maxTempC}
$EmergencyPL = ${policy.emergencyPlWatts}
$ZeroHashLimitSec = ${policy.zeroHashrateRestartSec}
$AutoBypassVPN = $${policy.autoBypassVpnTun ? 'true' : 'false'}
$FixHostsFakeIP = $${policy.fixHostsFakeIp ? 'true' : 'false'}
$TgEnabled = $${policy.telegramEnabled ? 'true' : 'false'}
$TgToken = "${policy.telegramBotToken.trim()}"
$TgChatId = "${policy.telegramChatId.trim()}"

# Параметры GitHub OTA
$GhEnabled = $${gh.enabled ? 'true' : 'false'}
$GhOwner = "${gh.owner.trim()}"
$GhRepo = "${gh.repo.trim()}"
$GhBranch = "${gh.branch.trim() || 'main'}"
$GhToken = "${gh.token.trim()}"
$GhPullIntervalSec = ${Math.max(1, gh.pullIntervalMin) * 60}
$GhAutoConfig = $${gh.autoApplyRemoteConfig ? 'true' : 'false'}
$GhAutoSelfUpdate = $${gh.autoSelfUpdateAgent ? 'true' : 'false'}

$CurrentCClk = "${cclk}"
$CurrentMClk = "${mclk}"
$CurrentPL = "${pl}"
$CurrentKernel = "${kernel}"
$CurrentFan = "${fan}"

$MiningDesired = $${config.miningActive ? 'true' : 'false'}
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
    $line = "[$ts][$Level] $Msg\`r\`n"
    if ($txtLog -and -not $txtLog.IsDisposed) {
        $txtLog.AppendText($line)
    }
}

function Ensure-DesktopShortcut {
    try {
        $installDir = "$env:LOCALAPPDATA\\Programs\\PearlRigControl"
        if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Path $installDir -Force | Out-Null }
        $installedBat = "$installDir\\pearl_watchdog_agent.bat"
        $iconPath = "$installDir\\pearl-icon.ico"

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

function Send-TelegramAlert([string]$Text) {
    if (-not $TgEnabled -or [string]::IsNullOrWhiteSpace($TgToken) -or [string]::IsNullOrWhiteSpace($TgChatId)) { return }
    try {
        $body = @{ chat_id = $TgChatId; text = "[Pearl Rig: $Worker]\`n$Text" }
        Invoke-RestMethod -Uri "https://api.telegram.org/bot$TgToken/sendMessage" -Method Post -Body $body -TimeoutSec 5 | Out-Null
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

    $hostsPath = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"
    $hostsLines = @(Get-Content $hostsPath | Where-Object { $_ -notmatch "kryptex\\.network" })
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
    $minerArgs = "-a pearl -w $Wallet -o $Pool1 -o $Pool2 --worker $Worker --cclk $CurrentCClk --mclk $CurrentMClk --pl $CurrentPL --kernel $CurrentKernel --fan $CurrentFan --api-port $ApiPort --log-file \`"$LogFile\`""
    Write-AgentLog "OK" "ЗАПУСК МАЙНИНГА: onezerominer.exe (CClk=$CurrentCClk, PL=$CurrentPL W)"
    Start-Process -FilePath "$MinerDir\\onezerominer.exe" -ArgumentList $minerArgs -WindowStyle Minimized
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
                $cleanBase64 = ($resp.content -replace "\\s", "")
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

# Локальный HTTP-мост (127.0.0.1:3002), чтобы кнопки в браузере управляли ПК напрямую
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
    # Проверяем команды от кнопки в веб-программе (127.0.0.1:3002)
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
`;
}

export function analyzeMinerLog(rawLog: string, currentWallet: string): LogDiagnosticItem[] {
  const results: LogDiagnosticItem[] = [];
  const walletCheck = validatePearlWallet(currentWallet);

  if (!walletCheck.valid) {
    results.push({
      severity: 'error',
      title: 'Обрезанный или некорректный адрес кошелька (-w)',
      detail: walletCheck.message,
      fixCommand: 'Скопируй полный 63-символьный адрес prl1p... из кошелька Oyster / Pearl CLI',
    });
  } else {
    results.push({
      severity: 'ok',
      title: 'Формат адреса кошелька проверен',
      detail: walletCheck.message,
      fixCommand: `-w ${currentWallet}`,
    });
  }

  if (rawLog.includes('the current user does not have permission to perform this operation')) {
    results.push({
      severity: 'error',
      title: 'Отсутствуют права Администратора для разгона (--cclk / --mclk / --pl)',
      detail:
        'Windows заблокировала фиксацию частот ядра (2400 MHz), памяти (810 MHz) и Power Limit (150 W), так как cmd.exe был запущен от обычного пользователя.',
      fixCommand: 'net session >nul 2>&1 || powershell -Command "Start-Process \'%~f0\' -Verb RunAs"',
    });
  }

  if (rawLog.includes('Failed to connect through SOCKS5 proxy')) {
    results.push({
      severity: 'error',
      title: 'Конфликт флага --proxy с режимом TUN в INCY VPN',
      detail:
        'В INCY уже включён режим TUN, а сервер NashVPN блокирует нестандартные порты майнинга (7048/8048). Передача --proxy приводит к сбросу соединения.',
      fixCommand: 'Убрать флаг --proxy и прописать прямые /32 маршруты через шлюз роутера',
    });
  }

  if (rawLog.includes('TCP connection timed out') || rawLog.includes('[Dev] Failed to connect to pool')) {
    results.push({
      severity: 'error',
      title: 'Тайм-аут подключения к пулу Kryptex (включая проверку [Dev] пула)',
      detail:
        'Трафик onezerominer.exe попадает в виртуальный адаптер INCY TUN, где сервер VPN фильтрует порты 7048 и 8048, либо DNS возвращает Fake-IP 198.18.x.x.',
      fixCommand: 'route add <IP_ПУЛА> mask 255.255.255.255 <ШЛЮЗ_РОУТЕРА> metric 1 + запись реального IP в hosts',
    });
  }

  if (rawLog.includes('kernel 2 (compact)')) {
    results.push({
      severity: 'ok',
      title: 'Инициализация вычислительного ядра pearlhash (Kernel 2 Compact)',
      detail: 'Обе видеокарты RTX 4070 Ti успешно инициализировали INT8 матричное ядро Kernel 2.',
      fixCommand: '--kernel 2,2',
    });
  }

  return results;
}
