# drpc-browser-extension

This repository contains the Chromium extension side of `drpc`.

When developed inside the `pulsecord` workspace, this repo lives at `external/drpc-browser-extension`. Some setup steps below call back into the parent `pulsecord` repo because the native host and tray app live there.

## What it does

- Detects the active browser tab
- Loads bundled website definitions and injects only on declared site match patterns
- Lets each site definition decide which pages should publish activity and how the Discord card is built
- Keeps the last matched site activity sticky when the active tab is unmatched
- Sends normalized browser activity snapshots to the native host `com.drpc.browser_host`

## Supported browsers

- Google Chrome
- Microsoft Edge
- Brave
- Opera

## Bundled site definitions

- Crunchyroll
- HIDIVE
- 9anime

## Local development

Commands in this section specify which directory they should be run from.

1. From the `drpc-browser-extension` repo root, install the extension toolchain and compile the TypeScript sources:

```powershell
npm install
npm run build
```

2. From the `pulsecord` repo root, build the native host:

```powershell
cmake --build .\build --config Debug --target drpc_native_host
```

3. In Chrome, Edge, Brave, or Opera, load the `drpc-browser-extension` repo root as an unpacked extension.

If you are working from the `pulsecord` monorepo checkout, the folder to load is `external/drpc-browser-extension`.

4. Note the extension ID shown on the extensions page.
5. From the `pulsecord` repo root, register the native host:

```powershell
.\scripts\Register-NativeHost.ps1 `
  -HostPath .\build\Debug\drpc_native_host.exe `
  -ExtensionIds <your-extension-id> `
  -Browsers chrome,edge
```

6. From the `pulsecord` repo root, start the tray app and begin playback on a supported site.

## Tests

```powershell
npm test
```

## Troubleshooting

- Re-run `npm run build` and reload the unpacked extension after changing TypeScript files in this folder.
- Click the extension action once to force an immediate active-tab scan.
- Check extension status with:

```js
chrome.storage.local.get("drpcStatus", console.log)
```

from the extension service worker console.
- `chrome://` pages, the Chrome Web Store, and other browser-owned pages cannot be inspected. The extension now reports these as unsupported browser pages instead of looking disconnected.
- Native host diagnostics are written to:

```text
%LOCALAPPDATA%\drpc\logs\native-host.log
```
