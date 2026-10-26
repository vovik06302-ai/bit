; Inno Setup 6 Script for PearlRigControl-Setup.exe
; Майнер НЕ запускается автоматически при установке или первом открытии
[Setup]
AppId={{8F9C2E41-5A7D-4E3B-9C12-7D8E4A2F6B90}
AppName=Pearl Rig Control (dual4070ti)
AppVersion=3.1.0
AppPublisher=Pearl Rig Control
DefaultDirName={autopf}\PearlRigControl
DefaultGroupName=Pearl Rig Control
OutputBaseFilename=PearlRigControl-Setup
SetupIconFile=pearl-icon.ico
UninstallDisplayIcon={app}\pearl-icon.ico
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
Source: "Start-Pearl-Rig-Control.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "bundle\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "bundle\NODE-LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "scripts\*.mjs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "scripts\*.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\Pearl Rig Control"; Filename: "{app}\Start-Pearl-Rig-Control.bat"; WorkingDir: "{app}"; IconFilename: "{app}\pearl-icon.ico"; Comment: "Pearl: доход, температуры, состояние и настройки"
Name: "{group}\Pearl Rig Control"; Filename: "{app}\Start-Pearl-Rig-Control.bat"; WorkingDir: "{app}"; IconFilename: "{app}\pearl-icon.ico"
