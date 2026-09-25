<#
.SYNOPSIS
  Builds the SecureEndpoint agent on Windows using Docker (no local Go needed).

.EXAMPLE
  .\scripts\build.ps1                 # vet + test + cross-compile all targets into .\bin and .\dist\downloads
  .\scripts\build.ps1 -SkipTests
  .\scripts\build.ps1 -Image          # also build the sem-agent-dist Docker image
#>
param(
    [string]$Version = (Get-Content (Join-Path $PSScriptRoot '..\VERSION') -ErrorAction SilentlyContinue | Select-Object -First 1),
    [switch]$SkipTests,
    [switch]$Image,
    [string]$GoImage = 'golang:1.23'
)
$ErrorActionPreference = 'Stop'
if (-not $Version) { $Version = '0.0.0-dev' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$src = $root -replace '\\', '/'

$steps = @('go mod download')
if (-not $SkipTests) {
    $steps += 'go vet ./...', 'GOOS=windows go vet ./...', 'GOOS=darwin go vet ./...', 'go test -count=1 ./...'
}
$steps += "VERSION=$Version OUT=dist/downloads BIN=bin sh scripts/build-dist.sh"
$cmd = ($steps -join ' && ')

Write-Host "==> $cmd"
docker run --rm -v "${src}:/src" -v sem-gomod:/go/pkg/mod -v sem-gocache:/root/.cache/go-build -w /src `
    -e GOFLAGS=-buildvcs=false -e GOTOOLCHAIN=local -e CGO_ENABLED=0 $GoImage sh -c $cmd
if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }

if ($Image) {
    docker build --build-arg VERSION=$Version -t "sem-agent-dist:$Version" -t sem-agent-dist:latest $root
    if ($LASTEXITCODE -ne 0) { throw "docker build failed ($LASTEXITCODE)" }
}
Write-Host "Artifacts: $root\bin and $root\dist\downloads" -ForegroundColor Green
