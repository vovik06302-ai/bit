; Inno Setup 6 Script for PearlRigControl-Setup.exe
[Setup]
AppId={{8F9C2E41-5A7D-4E3B-9C12-7D8E4A2F6B90}
AppName=Pearl Rig Control (dual4070ti)
AppVersion=1.3.0
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

[Icons]
; Автоматическое создание иконки на Рабочем столе (без лишних галочек)
Name: "{autodesktop}\Pearl Rig Control"; Filename: "{app}\pearl_watchdog_agent.bat"; WorkingDir: "{app}"; IconFilename: "{app}\pearl-icon.ico"; Comment: "Pearl Rig Control & Mining Launcher (dual4070ti)"
; Иконка в меню Пуск
Name: "{group}\Pearl Rig Control"; Filename: "{app}\pearl_watchdog_agent.bat"; WorkingDir: "{app}"; IconFilename: "{app}\pearl-icon.ico"

[Run]
Filename: "{app}\pearl_watchdog_agent.bat"; Description: "Launch Pearl Rig Control"; Flags: nowait postinstall skipifsilent shellexec
