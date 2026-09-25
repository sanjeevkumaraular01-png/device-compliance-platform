# Removes the SecureEndpoint agent from Windows.
#   .\uninstall.ps1            # keep C:\ProgramData\SecureEndpoint (config, logs)
#   .\uninstall.ps1 -Purge     # also delete config, keys, state and logs
# or: irm https://SERVER/downloads/uninstall.ps1 | iex; Uninstall-SemAgent [-Purge]

function Uninstall-SemAgent {
    [CmdletBinding()]
    param(
        [switch]$Purge,
        [string]$InstallDir = (Join-Path $env:ProgramFiles 'SecureEndpoint')
    )
    $ErrorActionPreference = 'Stop'
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Uninstall-SemAgent must run in an elevated PowerShell.'
    }
    $exe = Join-Path $InstallDir 'sem-agent.exe'
    if (Test-Path $exe) {
        & $exe stop 2>$null
        # Undo USB enforcement (USBSTOR, write protection, disabled devices).
        & $exe reset-usb 2>$null
        & $exe uninstall 2>$null
        # Stop per-user activity helpers running in signed-in sessions
        Get-CimInstance Win32_Process -Filter "Name LIKE 'sem-agent%'" | Where-Object { $_.CommandLine -match 'user-helper' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    elseif (Get-Service -Name 'SecureEndpointAgent' -ErrorAction SilentlyContinue) {
        Stop-Service -Name 'SecureEndpointAgent' -Force -ErrorAction SilentlyContinue
        & sc.exe delete SecureEndpointAgent | Out-Null
    }
    Start-Sleep -Seconds 2
    Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    if ($Purge) {
        Remove-Item -Recurse -Force (Join-Path $env:ProgramData 'SecureEndpoint') -ErrorAction SilentlyContinue
        Write-Host 'Configuration, keys and logs removed.'
    }
    Write-Host 'SecureEndpoint agent uninstalled. Retire the device in the console to revoke its credentials.' -ForegroundColor Green
}

if ($MyInvocation.InvocationName -ne '.' -and $MyInvocation.MyCommand.Path) {
    Uninstall-SemAgent @args
}
