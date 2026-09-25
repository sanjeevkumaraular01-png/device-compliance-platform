# SecureEndpoint Activity — Chrome / Edge extension

Reports the **hostname only** of the active tab (for example `github.com`) to the
local SecureEndpoint agent, so the Workforce module can classify website time as
productive / neutral / unproductive. It never reads or sends full URLs, paths,
query strings, page titles, page content, form data or keystrokes. The agent ignores
the value outside tracked work hours and after the employee clocks out.

Without the extension the agent still tracks apps and active/idle time; browser time
is then reported as the browser app (e.g. "chrome") without a website.

## How it connects

`background.js` → native messaging host `com.secureendpoint.agent` (the agent
executable, registered by `sem-agent install` / `sem-agent integration install`) →
per-user file read by `sem-agent user-helper` → local IPC → agent service →
`POST /api/v1/agent/activity`.

## Deploy (IT administrators)

1. **Get a stable extension ID.** Pack the folder once with your organization's key:
   `chrome --pack-extension=<path>\browser-extension` (keep the generated `.pem` safe;
   reuse it for every update) — or publish it as a private/unlisted item in the
   Chrome Web Store / Edge Add-ons. Note the 32-character extension ID.
2. **Allow the ID on endpoints** when installing the agent:
   - Windows: `Install-SemAgent -Server … -Token … -ExtensionId <id>`
   - Linux/macOS: `install.sh --server … --token … --extension-id <id>`
   - Existing installs: `sem-agent integration install --extension-id <id>` (admin/root).
3. **Force-install** the extension with browser policy:
   - Chrome: `ExtensionInstallForcelist` = `<id>;<update_url>` (GPO: *Computer
     Configuration › Administrative Templates › Google › Google Chrome › Extensions*;
     registry `HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist`).
   - Edge: same policy under `HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist`.
   - macOS: configuration profile with the same keys (`com.google.Chrome` / `com.microsoft.Edge`).
   - Linux: `/etc/opt/chrome/policies/managed/sem.json` → `{"ExtensionInstallForcelist": ["<id>;<update_url>"]}`.
   Use `https://clients2.google.com/service/update2/crx` as `update_url` for Web Store items,
   or your own update manifest URL for a self-hosted `.crx`.

The toolbar icon's tooltip tells employees what is shared.
