<#
.SYNOPSIS
  Creates .env from .env.example with freshly generated random secrets.

.DESCRIPTION
  Replaces every __GENERATE_*__ placeholder:
    __GENERATE_BASE64_32__  base64 of 32 random bytes (ENCRYPTION_KEY, AES-256)
    __GENERATE_BASE64_48__  base64 of 48 random bytes (JWT_ACCESS_SECRET)
    __GENERATE_HEX_24__     48 hex chars (URL-safe passwords: Postgres, Redis, Grafana)
  Output is UTF-8 without BOM and LF line endings (Docker Compose friendly).

.EXAMPLE
  .\scripts\generate-secrets.ps1
  .\scripts\generate-secrets.ps1 -Domain sem.example.com
  .\scripts\generate-secrets.ps1 -Force -Output C:\temp\test.env
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [string]$Domain = "",
    [string]$Output = ""
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$template = Join-Path $root '.env.example'
if (-not $Output) { $Output = Join-Path $root '.env' }

if (-not (Test-Path $template)) { throw "missing $template" }
if ((Test-Path $Output) -and -not $Force) {
    Write-Error "$Output already exists - use -Force to overwrite (this ROTATES all secrets; never do that on a live system: ENCRYPTION_KEY protects stored data)."
    exit 1
}

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function Get-RandomBytes([int]$n) {
    $b = New-Object byte[] $n
    $rng.GetBytes($b)
    return ,$b
}
function New-Base64([int]$n) { [Convert]::ToBase64String((Get-RandomBytes $n)) }
function New-Hex([int]$n) { -join ((Get-RandomBytes $n) | ForEach-Object { $_.ToString('x2') }) }

$lines = [System.IO.File]::ReadAllLines($template)
$out = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
    while ($line.Contains('__GENERATE_BASE64_32__')) {
        $idx = $line.IndexOf('__GENERATE_BASE64_32__')
        $line = $line.Substring(0, $idx) + (New-Base64 32) + $line.Substring($idx + 22)
    }
    while ($line.Contains('__GENERATE_BASE64_48__')) {
        $idx = $line.IndexOf('__GENERATE_BASE64_48__')
        $line = $line.Substring(0, $idx) + (New-Base64 48) + $line.Substring($idx + 22)
    }
    while ($line.Contains('__GENERATE_HEX_24__')) {
        $idx = $line.IndexOf('__GENERATE_HEX_24__')
        $line = $line.Substring(0, $idx) + (New-Hex 24) + $line.Substring($idx + 19)
    }
    if ($Domain) {
        $line = $line.Replace('https://localhost', "https://$Domain")
        if ($line.StartsWith('DOMAIN=')) { $line = "DOMAIN=$Domain" }
    }
    $out.Add($line)
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Output, (($out -join "`n") + "`n"), $utf8NoBom)

# Restrict the file to the current user.
try {
    $acl = Get-Acl $Output
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -Path $Output -AclObject $acl
} catch {
    Write-Warning "Could not restrict ACL on ${Output}: $_"
}

Write-Host "Wrote $Output with freshly generated secrets."
Write-Host "Next:"
Write-Host "  1. Review SMTP / SSO / LDAP / Twilio settings in $Output"
Write-Host "  2. Store a copy of ENCRYPTION_KEY in your password vault - it cannot be recovered."
Write-Host "  3. For production set SEED_DEMO_DATA=false and a strong SEED_ADMIN_PASSWORD."
