param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'Dev Space'))
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'release\Dev Space'
if (-not (Test-Path -LiteralPath (Join-Path $source 'Dev Space.exe'))) { throw 'Portable release is missing. Use the setup executable or build the release first.' }
if (Get-Process -Name 'dev-space','Dev Space' -ErrorAction SilentlyContinue) { throw 'Close Dev Space before updating. Other applications and their agents will not be stopped.' }
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'Dev Space.exe') -Destination (Join-Path $destinationPath 'Dev Space.exe') -Force
Copy-Item -LiteralPath (Join-Path $source 'runtime') -Destination $destinationPath -Recurse -Force
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Dev Space.lnk'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $destinationPath 'Dev Space.exe'
$shortcut.WorkingDirectory = $destinationPath
$shortcut.IconLocation = (Join-Path $destinationPath 'Dev Space.exe') + ',0'
$shortcut.Description = 'Dev Space - projects and agent workspace'
$shortcut.Save()
Write-Output "Dev Space installed: $destinationPath"
Write-Output "Desktop shortcut: $shortcutPath"
