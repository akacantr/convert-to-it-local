$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronExe = Join-Path $ProjectDir "node_modules\electron\dist\electron.exe"
$IconPath = Join-Path $ProjectDir "upstream\favicon.ico"

if (-not (Test-Path $ElectronExe)) {
    Write-Error "Electron executable not found at: $ElectronExe"
}

$WshShell = New-Object -ComObject WScript.Shell

# 1. Desktop Shortcut
$DesktopDir = [Environment]::GetFolderPath("Desktop")
$DesktopShortcutPath = Join-Path $DesktopDir "Convert to it!.lnk"
$Shortcut = $WshShell.CreateShortcut($DesktopShortcutPath)
$Shortcut.TargetPath = $ElectronExe
$Shortcut.Arguments = "`"$ProjectDir`""
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Description = "Convert to it! - Local Offline File Converter"
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = "$IconPath,0"
}
$Shortcut.Save()
Write-Output "Created Desktop shortcut: $DesktopShortcutPath"

# 2. Start Menu Shortcut
$StartMenuDir = [Environment]::GetFolderPath("Programs")
$StartMenuShortcutPath = Join-Path $StartMenuDir "Convert to it!.lnk"
$StartShortcut = $WshShell.CreateShortcut($StartMenuShortcutPath)
$StartShortcut.TargetPath = $ElectronExe
$StartShortcut.Arguments = "`"$ProjectDir`""
$StartShortcut.WorkingDirectory = $ProjectDir
$StartShortcut.Description = "Convert to it! - Local Offline File Converter"
if (Test-Path $IconPath) {
    $StartShortcut.IconLocation = "$IconPath,0"
}
$StartShortcut.Save()
Write-Output "Created Start Menu shortcut: $StartMenuShortcutPath"
