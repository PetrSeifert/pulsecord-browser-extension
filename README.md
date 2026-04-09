# drpc-browser-extension

This folder is the standalone Chromium extension side of `drpc`. It is scaffolded inside the main repo for coordinated development today, and can be moved to its own remote repository or converted into a git submodule later.

## What it does

- Detects the active browser tab
- Extracts richer metadata from supported anime/video sites
- Falls back to generic URL/title detection on unsupported sites
- Sends normalized browser activity snapshots to the native host `com.drpc.browser_host`

## Supported browsers

- Google Chrome
- Microsoft Edge
- Brave
- Opera

## Supported site adapters in this scaffold

- Crunchyroll
- HIDIVE

## Local development

1. Build the native host in the main repo:

```powershell
cmake --build ..\build --config Debug --target drpc_native_host
```

2. Load this directory as an unpacked extension in your Chromium browser.
3. Note the extension ID shown on the extensions page.
4. Register the native host from the main repo:

```powershell
..\..\scripts\Register-NativeHost.ps1 `
  -HostPath ..\..\build\drpc_native_host.exe `
  -ExtensionIds <your-extension-id> `
  -Browsers chrome,edge
```

5. Start the tray app from the main repo and begin playback on a supported site.

## Tests

```powershell
npm test
```

## Troubleshooting

- Reload the unpacked extension after changing files in this folder.
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
