# SecureEndpoint Agent (`sem-agent`)

Cross-platform endpoint agent for **SecureEndpoint Manager**. It is a single
Go binary per OS/architecture. It enrolls the device, reports hardware,
security posture, software and patch state, and enforces the device policy:
USB storage control, blacklisted-software removal, screen lock, automatic
updates and firewall. It also runs whitelisted remote commands.

The wire protocol is defined in [`../docs/API.md`](../docs/API.md), section
"Agent protocol — /agent". Enum values match `backend/prisma/schema.prisma`.

## Architecture

```
cmd/sem-agent            CLI: enroll | run | install | uninstall | start | stop | restart | status | collect | usb | reset-usb | renew-cert | version
internal/model           wire types (HardwareInfo, SecurityStatus, AgentPolicy, AgentCommand, events …)
internal/platform        data/state/log paths, admin check, secure file writes (DACL / 0600), bounded exec runner
internal/config          agent.json load/save; agent token protected with DPAPI (Windows) or 0600 root (Unix)
internal/pki             RSA-2048 key + CSR (CN = serial number); node-forge on the backend only signs RSA
internal/api             HTTPS client: TLS 1.2+, extra CA / enrollment CA, mTLS client cert, Bearer + X-Device-Id,
                         exponential backoff with jitter + Retry-After, optional gzip, offline spool (JSONL)
internal/collector       hardware / security / software / patches, one file per OS; every probe has a timeout
                         and degrades to UNKNOWN (or leaves the field out) instead of failing the report
internal/usb             USB watcher (polling), policy evaluation (whitelist, temporary approvals), enforcement
internal/software        inventory diff -> INSTALLED/REMOVED, blacklist matcher (EXACT/CONTAINS/REGEX), uninstall
internal/enforce         screen lock, auto-update, firewall (idempotent: read, then change only if needed)
internal/commands        command dispatcher: fixed set of types, expiry check, de-duplication, per-OS actions
internal/service         main loop + kardianos/service wrapper (Windows Service, systemd, launchd)
internal/logging         slog JSON logs -> rotated file (lumberjack, 10 MB x 5, 30 days, gzip)
packaging/               install/uninstall scripts, systemd unit, launchd plist, nfpm, WiX, sample .mobileconfig
```

### Main loop (`sem-agent run`)

| Task | Interval | Details |
|---|---|---|
| Heartbeat `POST /agent/heartbeat` | `policy.checkinIntervalSec`, ±10 % jitter (min 30 s; default 300 s) | returns the policy and pending commands; the offline spool is flushed after each successful heartbeat |
| Full report `POST /agent/report` | `policy.inventoryIntervalSec`, ±10 % jitter (min 5 min; default 1 h), 5–30 s after start, and on `COLLECT_INVENTORY` | the missing-patch scan is cached for 4 h (Windows Update and `softwareupdate` are slow) |
| Software diff | each report | compares with the persisted snapshot and sends `INSTALLED`/`REMOVED` events to `/agent/software-events`; with `autoUninstallBlacklisted`, blacklisted items are removed and reported as `BLOCKED` |
| Policy enforcement | on a new policy `version` / `policyId`, on `APPLY_POLICY`, and once after the first report | screen lock, auto-update, firewall and USB rules |
| USB watcher | every 2 s (5 s on macOS) | `CONNECTED` / `DISCONNECTED` / `BLOCKED` / `ALLOWED` events, sent in batches to `/agent/usb-events`; rules are refreshed when a temporary approval expires |
| Certificate renewal `POST /agent/certificate/renew` | daily (first check 1–3 min after start) | when the device certificate is missing or expires within 30 days: new RSA-2048 key + CSR, authenticated by the agent token; the new pair is written beside the old one, verified, swapped in, and used for new TLS handshakes without a restart |
| Commands | queued from the heartbeat, run one at a time | result goes to `POST /agent/commands/:id/result` (spooled if the server is offline) |

If the server cannot be reached, USB events, software events and command
results are spooled (`spool.jsonl`, up to 5000 entries) and sent later. A
report is never spooled; the next scheduled report replaces it. On HTTP 401,
meaning the token was revoked or the device retired, the agent logs one error
and checks in only every 15 minutes.

## Per-OS data sources

| Data | Windows | Linux | macOS |
|---|---|---|---|
| Serial / vendor / model | WMI `Win32_BIOS`, `Win32_ComputerSystem` | `/sys/class/dmi/id/*` (fallback `/etc/machine-id`) | `system_profiler SPHardwareDataType -json` |
| Device type | `Win32_SystemEnclosure.ChassisTypes`, `PCSystemType`, `Win32_Battery`, server SKU | DMI `chassis_type`, `systemd-detect-virt`, battery, GUI presence | model identifier (MacBook, Mac Pro, VirtualMac …) |
| CPU / RAM / disk | `Win32_Processor`, `TotalPhysicalMemory`, `Win32_DiskDrive` (non-USB) | `/proc/cpuinfo`, `/proc/meminfo`, `/sys/block/*/size` (fallback `statfs /`) | `sysctl machdep.cpu.brand_string hw.memsize`, `statfs /` |
| OS | `Win32_OperatingSystem` + `CurrentVersion` (DisplayVersion, build.UBR) | `/etc/os-release`, kernel release | `sw_vers`, `kern.osproductversion`, `kern.osversion` |
| IP / MACs | `net.Interfaces` (physical, globally administered MACs) plus the route-selected source IP | same | same |
| Logged-in user / domain | `Win32_ComputerSystem.UserName`, WTS console session | `loginctl` (graphical session), `who`; `realm list` | owner of `/dev/console`; `dsconfigad -show` |
| Antivirus | `root\SecurityCenter2 AntiVirusProduct` (decoded `productState`); Defender `MSFT_MpComputerStatus` for signature time (and on servers) | ClamAV (`clamd`, signature age from `/var/lib/clamav`), Defender, Sophos, ESET, … (processes, units and paths) | third-party AV/EDR processes; otherwise XProtect (bundle date) + Gatekeeper `spctl --status` |
| EDR | services: CSFalconService, SentinelAgent, Sense (onboarded only), CylanceSvc, CbDefense, Sophos, cyserver (Cortex XDR), Elastic, Trellix, ESET, Huntress, Cisco AMP … | falcon-sensor, sentinelone, mdatp, cbagentd, traps, sophos-spl, elastic-endpoint … | falcond, SentinelAgent, wdavdaemon, CbOsxSensorService, JamfProtect … |
| Firewall | `MSFT_NetFirewallProfile` (`root\StandardCimv2`), fallback FirewallPolicy registry + GPO | ufw → firewalld → nftables → iptables | `socketfilterfw --getglobalstate` |
| Disk encryption | `Win32_EncryptableVolume` (admin) or the shell property `System.Volume.BitLockerProtection` (any user) | `lsblk -J`: is `/` under a `crypt` device (LUKS) | `fdesetup status` (FileVault) |
| Secure Boot / TPM | `SecureBoot\State\UEFISecureBootEnabled`; `Win32_Tpm` (admin) or the TPM PnP device | `mokutil --sb-state` / efivars; `/sys/class/tpm/tpm0` | Apple Silicon/T2 + SIP (`csrutil status`); Secure Enclave counts as TPM |
| Screen lock | `InactivityTimeoutSecs` + each logged-on user's screen saver (policy key, then user key) | GNOME `idle-delay` / `lock-enabled` via gsettings/dconf as the session user | `defaults -currentHost read com.apple.screensaver idleTime`, `sysadminctl -screenLock status` |
| Auto update | `Policies\...\WindowsUpdate\AU` (NoAutoUpdate / AUOptions) and wuauserv start type | unattended-upgrades (`20auto-upgrades`) / dnf-automatic timers | `com.apple.SoftwareUpdate` AutomaticCheckEnabled / CriticalUpdateInstall |
| USB storage enabled | `USBSTOR\Start != 4`, RemovableStorageDevices policies | `usb_storage` not blacklisted in modprobe.d, no agent block rule | the agent block marker |
| Software | Uninstall keys (HKLM 64-bit, HKLM 32-bit, loaded HKU hives); skips SystemComponent/updates | `dpkg-query` or `rpm -qa`, plus `snap list`, `flatpak list` | `system_profiler SPApplicationsDataType -json` |
| Patches | installed: `Win32_QuickFixEngineering`; missing: Windows Update Agent COM (`IsInstalled=0 and Type='Software'`), KB, MsrcSeverity, CVEs | `apt list --upgradable` (security pocket → SECURITY/IMPORTANT) or `dnf updateinfo list --updates [--with-cve]`, zypper | `softwareupdate --list` |

## Enforcement mechanisms

| Policy | Windows | Linux | macOS |
|---|---|---|---|
| `usb.blockStorage` (no whitelist) | `USBSTOR\Start=4`; already-attached devices disabled with `pnputil /disable-device` | udev rule `/etc/udev/rules.d/99-sem-usb.rules` sets `authorized=0` on mass-storage interfaces (class 08), then `udevadm control --reload-rules && udevadm trigger`; attached devices are deauthorised at once | the device is unmounted and ejected (`diskutil unmountDisk force` + `eject`) and ejected again if it is remounted |
| USB whitelist / temporary approval (`expiresAt`) | USBSTOR stays on; each non-whitelisted storage device is disabled with `pnputil /disable-device` when it appears, and whitelisted ones are re-enabled | allow rules (`ATTRS{idVendor}/{idProduct}/{serial}` → `GOTO`) come before the deny rule; expired entries are dropped and the rules are rebuilt when an approval expires | whitelisted devices are left mounted |
| `usb.readOnly` / read-only whitelist entries | `StorageDevicePolicies\WriteProtect=1` | `blockdev --setro` via udev `RUN+=` | remounted with `diskutil mount readOnly` |
| Screen lock | `InactivityTimeoutSecs`, plus `ScreenSaveActive` / `ScreenSaverIsSecure` / `ScreenSaveTimeOut` policy values in each loaded user hive | dconf system database `/etc/dconf/db/local.d/00-sem-screenlock` with a locks file, then `dconf update` | needs an MDM profile (`com.apple.screensaver`); the result is reported as skipped |
| Auto update | `NoAutoUpdate=0`, `AUOptions=4`, wuauserv not disabled | install and enable unattended-upgrades, or enable `dnf-automatic-install.timer` | `defaults write /Library/Preferences/com.apple.SoftwareUpdate …` + `softwareupdate --schedule on` |
| Firewall | `netsh advfirewall set allprofiles state on` | `ufw limit 22/tcp` then `ufw --force enable`, or `systemctl enable --now firewalld` | `socketfilterfw --setglobalstate on` |
| Blacklisted software | `QuietUninstallString`, else `msiexec /x {GUID} /qn /norestart` for MSI packages; an EXE uninstaller with no silent switch is **not** run | `apt-get remove -y` / `dnf remove -y` / `snap remove` / `flatpak uninstall` | the `.app` bundle directly under `/Applications` is deleted (never Apple/system apps, never moved to the Trash) |

Every action reads the current state first and changes only what the policy
requires. Each action is logged with the setting and whether it changed.
OS-critical packages are never uninstalled (kernel, libc, systemd, package
managers, sudo, sshd, the agent itself).

### Remote commands

Only these `CommandType` values are accepted. The server cannot send shell
commands. Commands past `expiresAt` are rejected. Command ids are remembered
so a command is never run twice.

| Command | Windows | Linux | macOS |
|---|---|---|---|
| `UNINSTALL_SOFTWARE {name, version?}` | as above | as above | as above |
| `INSTALL_PATCHES {patchIds?, severity?, reboot}` | WUA COM search, download, install (KB / update id / severity filter) | `apt-get install --only-upgrade <pkgs>` / `unattended-upgrade` / `apt-get upgrade`; `dnf update --advisory=… / --security --sec-severity=…` | `softwareupdate --install <labels> / --all [--restart]` |
| `APPLY_POLICY {version}` | fetches `GET /agent/policy` and enforces it | same | same |
| `COLLECT_INVENTORY` | forces a patch rescan and sends a report now | same | same |
| `LOCK_SCREEN` | WTS session enumeration → `CreateProcessAsUser(rundll32 user32.dll,LockWorkStation)` on each active session; fallback: one-shot scheduled task for BUILTIN\Users | `loginctl lock-sessions` | `pmset displaysleepnow` (locks when a password is required after sleep) |
| `RESTART {delaySec}` | `shutdown /r /t N` (at least 30 s so the result can be posted) | `shutdown -r +M` | `shutdown -r +M` |
| `ENABLE_ENCRYPTION` | `manage-bde -protectors -add C: -TPM`, `-RecoveryPassword`, `-on -UsedSpaceOnly`; the recovery password is returned in `data.recoveryPassword` for server-side escrow (redacted from output/logs) and backed up to AD DS when joined | unsupported (LUKS must be set up at install time) | returns instructions (FileVault needs Secure Token user credentials or an MDM FileVault payload) |
| `REFRESH_USB_RULES` | re-fetches the policy (new temporary approvals) and rebuilds the USB rules | same | same |

Patch ids and package names from the server are checked against a strict
character allow-list before they are passed as arguments. They are never run
through a shell.

## Workforce activity tracking

Enabled per department by a **Workforce policy** on the server (`docs/WORKFORCE.md`).
The service runs as SYSTEM/root and cannot see the interactive desktop, so tracking
runs in a small **per-user helper** started at every graphical logon.

```
Chrome/Edge extension ──native messaging──► sem-agent (native host) ──► per-user file (hostname only)
                                                                              │
sem-agent user-helper (user session) ── samples 1/s ─────────────────────────┘
        │  newline-delimited JSON over \\.\pipe\sem-agent  |  /var/run/sem-agent.sock
        ▼
sem-agent service (SYSTEM/root) ── POST /agent/activity (spooled offline), POST /agent/screenshots
```

| Collected | Never collected |
|---|---|
| Foreground app name (e.g. `chrome`, `Code`, `OUTLOOK`) | What is typed, key codes, clipboard |
| Whether keyboard/mouse input happened in each second (a count) | Mouse positions, individual keystrokes |
| Idle / locked state, lock-unlock events | Full URLs, paths, query strings, page content |
| Active tab **hostname** (with the extension) | Window titles — unless the policy enables `captureWindowTitles` (default off) |
| Screenshots — only if the policy enables them (default off), only while active in work hours, blurred on the device when `blur` is on (default) | Anything outside work hours or after clock-out (unless `trackOutsideWorkHours`) |

* **Transparency:** once per tracked day the helper shows a notification (Windows balloon,
  macOS Notification Center, Linux `notify-send`) with the policy's notice text; employees
  see their own data under **Workforce › My Day** in the console.
* **Identity:** the service accepts helper connections only from signed-in users (pipe
  ACL / socket peer credentials on Linux and macOS) and ignores system accounts. The
  helper never sees the agent token; the service owns the server connection and spool.
* **Segments:** 1 s samples are merged into segments that split on app, website, title or
  active/idle change (max 5 min, noise under 2 s dropped) and are sent every 60 s.
* **Screenshots:** Windows captures via GDI (all monitors); macOS uses `screencapture`
  (needs the *Screen Recording* permission for `sem-agent`); Linux uses `grim` (Wayland),
  `gnome-screenshot` or ImageMagick `import`. Images are downscaled to 1600 px, blurred
  on-device (3-pass box blur, radius 12 px) when required, JPEG q60. The service refuses to
  upload an un-blurred image when the policy requires blur.
* **macOS:** app names need no permission; window titles (only if enabled) need
  *Accessibility*. **Linux:** X11 needs `xprop` + `xprintidle`; on Wayland the foreground
  app is unknown and idle comes from logind.
* **Browser extension:** see `packaging/browser-extension/README.md` (deploy with
  `ExtensionInstallForcelist`, pass its ID to the installer with `--extension-id`).
* **Debug:** `sem-agent collect --section activity` prints 10 one-second samples
  (app, idle seconds, input yes/no — never titles). Helper log: the user's cache dir
  (`%LOCALAPPDATA%\SecureEndpoint\agent.log`, `~/Library/Caches/SecureEndpoint`, `~/.cache/SecureEndpoint`).

## Required privileges

The agent service runs as **LocalSystem** on Windows and as **root** on Linux
and macOS. `enroll`, `install`, `uninstall`, `start`, `stop` and `reset-usb`
need an elevated prompt or sudo. `collect --json`, `usb` and `version` also
work without privileges. Without them, some fields are UNKNOWN: on Windows,
BitLocker falls back to the shell property and TPM to PnP detection; on
Linux, the DMI serial falls back to machine-id and nft/iptables are not read.

## Install / uninstall

The console generates these commands (`GET /enrollment/install-command`):

```powershell
# Windows (elevated PowerShell)
irm https://SERVER/downloads/install.ps1 | iex; Install-SemAgent -Server https://SERVER -Token sem_enr_xxx
# uninstall
irm https://SERVER/downloads/uninstall.ps1 | iex; Uninstall-SemAgent [-Purge]
```

```bash
# Linux
curl -fsSL https://SERVER/downloads/install.sh | sudo bash -s -- --server https://SERVER --token sem_enr_xxx
curl -fsSL https://SERVER/downloads/uninstall.sh | sudo bash -s -- [--purge]
# macOS
curl -fsSL https://SERVER/downloads/install-macos.sh | sudo bash -s -- --server https://SERVER --token sem_enr_xxx
curl -fsSL https://SERVER/downloads/uninstall-macos.sh | sudo bash -s -- [--purge]
```

The installers pick the architecture (amd64/arm64) and download the binary
from `SERVER/downloads/`. They check its SHA-256 against `checksums.txt`,
install it, run `sem-agent enroll`, register the service and start it. Extra
options: `--insecure-skip-verify` / `-InsecureSkipVerify` (lab use only) and
`--ca-file` / `-CaFile` (private PKI).

Other packaging:
* `packaging/linux/nfpm.yaml`: builds a .deb/.rpm; enroll after the package is installed.
* `packaging/windows/sem-agent.wxs`: WiX v3 MSI template. Silent install: `msiexec /i sem-agent.msi /qn SEM_SERVER=… SEM_TOKEN=…`.
* `packaging/macos/build-pkg.sh`: pkgbuild/productbuild template (universal binary via `lipo`, signing and notarization hooks).
* `packaging/macos/sem-usb-restrictions.mobileconfig`: sample profile with external-storage `mount-controls`, screen saver/password and a Full Disk Access PPPC entry.

## CLI

```
sem-agent enroll --server https://sem.example.com --token sem_enr_xxx [--insecure-skip-verify] [--ca-file ca.pem] [--force] [--gzip]
sem-agent run                   # foreground (Ctrl+C to stop); the service runs the same command
sem-agent install|uninstall|start|stop|restart
sem-agent status                # service state, enrollment, cert expiry, policy, spool size, connectivity test
sem-agent collect --json [--skip-patches] [--skip-software] [--section hardware|security|software|patches] [-v]
sem-agent usb                   # connected USB devices + policy decision (diagnostics)
sem-agent reset-usb             # undo USB enforcement (used by the uninstallers)
sem-agent renew-cert            # renew the device certificate now (normally automatic, 30 days before expiry)
sem-agent version
```

Set `SEM_AGENT_LOG_LEVEL=debug` to get more detailed logs. Set
`SEM_AGENT_DATA_DIR=<dir>` to keep all files in one directory, which is useful
for testing without admin rights.

## File locations

| | Windows | Linux | macOS |
|---|---|---|---|
| Binary | `C:\Program Files\SecureEndpoint\sem-agent.exe` | `/usr/local/bin/sem-agent` | `/usr/local/bin/sem-agent` |
| Config (`agent.json`), key, certs | `C:\ProgramData\SecureEndpoint\` | `/etc/sem-agent/` | `/Library/Application Support/SecureEndpoint/` |
| State (spool, software snapshot, USB state, command ids) | `C:\ProgramData\SecureEndpoint\state\` | `/var/lib/sem-agent/` | `/Library/Application Support/SecureEndpoint/state/` |
| Logs (`agent.log`, JSON, rotated) | `C:\ProgramData\SecureEndpoint\logs\` | `/var/log/sem-agent/` | `/Library/Logs/SecureEndpoint/` |
| Service | Windows service `SecureEndpointAgent` | systemd `sem-agent.service` | launchd `com.secureendpoint.agent` |
| USB rules | registry (USBSTOR, StorageDevicePolicies) | `/etc/udev/rules.d/99-sem-usb.rules` | – |

## Security model

* **Transport:** HTTPS with TLS 1.2 or later. Trust comes from the system roots, plus the CA from `--ca-file` and the CA returned at enrollment. Once enrolled, the agent presents its device certificate, so Nginx can require mTLS on `/api/v1/agent/`. `--insecure-skip-verify` is for labs only and is stored in the config.
* **Identity:** at enrollment the agent generates an RSA-2048 key on the device; the private key never leaves the device. The CSR's CN is the serial number. Certificates (1 year) renew automatically 30 days before expiry with a fresh key; the server revokes the previous certificate. Each request carries the agent token (`sem_agt_…`, stored hashed on the server) as a Bearer token along with `X-Device-Id`.
* **Secrets at rest:**
  * Windows: the token is encrypted with DPAPI (machine scope, app-specific entropy). The config directory has a protected DACL that allows only SYSTEM and Administrators, and the key file gets the same DACL.
  * Linux/macOS: config, key and state files are mode 0600 and the directories 0700, all owned by root.
* **Command safety:** fixed command whitelist, expiry enforcement, de-duplication and argument allow-listing. There is no generic "run script" capability.
* **Self-protection (basic):** the service restarts on failure (SCM recovery actions, `Restart=always`, launchd `KeepAlive`). The binary directory is read-only for users. The systemd unit is hardened (`ProtectHome`, `ProtectKernelModules`, `PrivateTmp`, `RestrictAddressFamilies`, …).
* **Tamper resistance:** a local administrator or root can still stop or remove the agent. Stronger protection comes from outside the agent:
  * Windows: WDAC/AppLocker, or restricting service control through GPO.
  * macOS: an MDM profile with `PayloadRemovalDisallowed` plus a System Extension.
  * Linux: immutable attributes and auditd rules.
  * All platforms: the server's `AGENT_OFFLINE` rule flags devices that stop checking in.

## Troubleshooting

| Symptom | Check |
|---|---|
| `enrollment failed: HTTP 401/403` | the token has expired, been revoked, reached its max uses or is for another platform; create a new one in the console |
| `x509: certificate signed by unknown authority` | use `--ca-file` with the server CA (or install it in the OS trust store) |
| heartbeat 401 in logs | the device was retired or its token revoked; run `sem-agent enroll --force …` again |
| many fields `UNKNOWN` | run elevated or as root; check `sem-agent collect --json -v` for failing probes |
| Windows patches missing | the Windows Update service must be running; the WUA search can take minutes (timeout 5 min, cached 4 h) |
| USB not blocked on Windows | `pnputil /disable-device` needs Windows 10 2004 or later; check `sem-agent usb` and `HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR\Start` |
| USB not blocked on Linux | `cat /etc/udev/rules.d/99-sem-usb.rules`, `udevadm test`; the kernel must expose `authorized` on the interface (≥ 4.4) |
| service will not start | Windows: `sc qc SecureEndpointAgent`, Event Viewer; Linux: `journalctl -u sem-agent`; macOS: `launchctl print system/com.secureendpoint.agent` |
| logs | `agent.log` in the log directory (JSON lines; rotated at 10 MB, 5 backups, 30 days) |

## Build

```bash
make test            # unit tests
make lint            # gofmt + go vet (linux, windows, darwin)
make build-all       # 6 binaries in ./bin (CGO_ENABLED=0, -trimpath, -s -w, -X main.version)
make dist            # dist/downloads: binaries, install scripts, checksums.txt
docker build -t sem-agent-dist .   # multi-stage: vet+test+cross-compile → busybox image with /downloads
docker run --rm -v downloads:/out sem-agent-dist   # copy /downloads/* into the Nginx volume and exit
```

On Windows without Go, run `.\scripts\build.ps1 [-SkipTests] [-Image]`, which runs the build in `golang:1.23` through Docker.

## Known limitations

* **macOS USB:** blocking happens in user space (unmount and eject), so a device can mount for up to 5 s. Hard blocking needs the MDM profile. Screen lock and FileVault also need MDM.
* **Windows USB whitelist mode:** a non-whitelisted device is disabled about 2 s after it arrives. With no whitelist, USBSTOR is disabled and no USB storage device can mount at all. `DenyRemovableDevices` is deliberately not used, because it would also block new keyboards, mice and headsets.
* **Windows screen-lock state:** the value comes from the policy and screen-saver settings. Power-plan "lock on display off" is not evaluated.
* **Linux patches:** the list comes from the package cache, which the agent does not refresh during collection; `INSTALL_PATCHES` runs `apt-get update` first. CVE ids are available for dnf only.
* **EXE uninstallers without `QuietUninstallString`:** these are not run silently, and the command fails with an explanation.
