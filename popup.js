(function () {
  "use strict";

  const STORAGE_KEY = "drpcSiteConfig";
  const STATUS_KEY = "drpcStatus";

  const SITE_META = {
    crunchyroll: { name: "Crunchyroll", icon: "C" },
    hidive:      { name: "HIDIVE",      icon: "H" },
    "9anime":    { name: "9anime",      icon: "9" }
  };

  const DEFAULT_CONFIG = {
    crunchyroll: { enabled: true, settings: {}, activityOverrides: {} },
    hidive:      { enabled: true, settings: {}, activityOverrides: {} },
    "9anime":    { enabled: true, settings: {}, activityOverrides: {} }
  };

  // ── DOM refs ──

  const statusDot   = document.getElementById("statusDot");
  const statusLabel  = document.getElementById("statusLabel");
  const statusDetail = document.getElementById("statusDetail");
  const sitesList    = document.getElementById("sitesList");
  const resetBtn     = document.getElementById("resetBtn");

  let currentConfig = null;
  let saveTimer     = null;
  let toastEl       = null;

  // ── Init ──

  loadStatus();
  loadConfig();
  resetBtn.addEventListener("click", resetConfig);

  // ── Status ──

  function loadStatus() {
    chrome.storage.local.get(STATUS_KEY, (result) => {
      const data = result[STATUS_KEY];
      if (!data) {
        setStatus("wait", "Waiting for data…");
        return;
      }
      const message = data.details?.message || "";
      setStatus(data.status, message);
    });
  }

  function setStatus(status, message) {
    statusDot.className = "status-dot " + status;

    const labels = { ok: "Connected", wait: "Waiting", error: "Error" };
    statusLabel.textContent = labels[status] || status;

    if (message) {
      statusDetail.textContent = message;
      statusDetail.classList.add("visible");
    } else {
      statusDetail.classList.remove("visible");
    }
  }

  // ── Config ──

  function loadConfig() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      currentConfig = mergeDefaults(result[STORAGE_KEY] || {});
      renderSites();
    });
  }

  function mergeDefaults(saved) {
    const merged = {};
    for (const id of Object.keys(DEFAULT_CONFIG)) {
      const def = DEFAULT_CONFIG[id];
      const src = saved[id] || {};
      merged[id] = {
        enabled: src.enabled !== undefined ? src.enabled : def.enabled,
        settings: Object.assign({}, def.settings, src.settings || {}),
        activityOverrides: Object.assign({}, def.activityOverrides, src.activityOverrides || {})
      };
    }
    return merged;
  }

  function saveConfig() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: currentConfig }, () => {
        showToast("Saved");
      });
    }, 300);
  }

  function resetConfig() {
    currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    chrome.storage.local.set({ [STORAGE_KEY]: currentConfig }, () => {
      renderSites();
      showToast("Reset to defaults");
    });
  }

  // ── Render ──

  function renderSites() {
    sitesList.innerHTML = "";

    for (const [siteId, meta] of Object.entries(SITE_META)) {
      const cfg = currentConfig[siteId];
      if (!cfg) continue;

      const card = document.createElement("div");
      card.className = "site-card" + (cfg.enabled ? "" : " disabled");
      card.innerHTML = buildSiteHTML(siteId, meta, cfg);
      sitesList.appendChild(card);

      bindSiteEvents(card, siteId);
    }
  }

  function buildSiteHTML(siteId, meta, cfg) {
    const ov = cfg.activityOverrides || {};
    const btn1 = (ov.buttons && ov.buttons[0]) || {};
    const btn2 = (ov.buttons && ov.buttons[1]) || {};
    const displayType = ov.statusDisplayType || "";
    const showElapsed = ov.showElapsedTime === true;

    return `
      <div class="site-header">
        <div class="site-info">
          <div class="site-icon ${siteId}">${meta.icon}</div>
          <span class="site-name">${meta.name}</span>
        </div>
        <div class="site-controls">
          <label class="toggle" title="${cfg.enabled ? "Disable" : "Enable"} ${meta.name}">
            <input type="checkbox" data-action="toggle-site" data-site="${siteId}" ${cfg.enabled ? "checked" : ""}>
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
      </div>
      <button class="expand-btn" data-action="expand" data-site="${siteId}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18l6-6-6-6"/>
        </svg>
        Activity overrides
      </button>
      <div class="site-overrides" data-panel="${siteId}">
        <div class="overrides-inner">
          <div class="override-group">
            <div class="override-row">
              <span class="override-label">Name</span>
              <input class="override-input" type="text" data-field="name" data-site="${siteId}" placeholder="Override name…" value="${esc(ov.name || "")}">
            </div>
            <div class="override-row">
              <span class="override-label">Details</span>
              <input class="override-input" type="text" data-field="details" data-site="${siteId}" placeholder="Override details…" value="${esc(ov.details || "")}">
            </div>
            <div class="override-row">
              <span class="override-label">State</span>
              <input class="override-input" type="text" data-field="state" data-site="${siteId}" placeholder="Override state…" value="${esc(ov.state || "")}">
            </div>
          </div>

          <div class="override-group">
            <div class="override-group-label">Display</div>
            <div class="override-row">
              <span class="override-label">Show as</span>
              <div class="radio-group">
                <span class="radio-pill">
                  <input type="radio" name="displayType-${siteId}" id="dt-${siteId}-none" data-field="statusDisplayType" data-site="${siteId}" value="" ${displayType === "" ? "checked" : ""}>
                  <label for="dt-${siteId}-none">Auto</label>
                </span>
                <span class="radio-pill">
                  <input type="radio" name="displayType-${siteId}" id="dt-${siteId}-name" data-field="statusDisplayType" data-site="${siteId}" value="name" ${displayType === "name" ? "checked" : ""}>
                  <label for="dt-${siteId}-name">Name</label>
                </span>
                <span class="radio-pill">
                  <input type="radio" name="displayType-${siteId}" id="dt-${siteId}-details" data-field="statusDisplayType" data-site="${siteId}" value="details" ${displayType === "details" ? "checked" : ""}>
                  <label for="dt-${siteId}-details">Details</label>
                </span>
                <span class="radio-pill">
                  <input type="radio" name="displayType-${siteId}" id="dt-${siteId}-state" data-field="statusDisplayType" data-site="${siteId}" value="state" ${displayType === "state" ? "checked" : ""}>
                  <label for="dt-${siteId}-state">State</label>
                </span>
              </div>
            </div>
            <div class="override-toggle-row">
              <span class="override-toggle-label">Show elapsed time</span>
              <label class="toggle sm">
                <input type="checkbox" data-field="showElapsedTime" data-site="${siteId}" ${showElapsed ? "checked" : ""}>
                <span class="toggle-track"></span>
                <span class="toggle-thumb"></span>
              </label>
            </div>
          </div>

          <div class="override-group">
            <div class="override-group-label">Buttons</div>
            <div class="button-pair">
              <input class="override-input" type="text" data-field="btn1-label" data-site="${siteId}" placeholder="Label" value="${esc(btn1.label || "")}">
              <input class="override-input" type="text" data-field="btn1-url" data-site="${siteId}" placeholder="URL" value="${esc(btn1.url || "")}">
            </div>
            <div class="button-pair">
              <input class="override-input" type="text" data-field="btn2-label" data-site="${siteId}" placeholder="Label" value="${esc(btn2.label || "")}">
              <input class="override-input" type="text" data-field="btn2-url" data-site="${siteId}" placeholder="URL" value="${esc(btn2.url || "")}">
            </div>
          </div>

          <button class="clear-overrides-btn" data-action="clear-overrides" data-site="${siteId}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            Clear all overrides
          </button>
        </div>
      </div>
    `;
  }

  function bindSiteEvents(card, siteId) {
    // Toggle site enabled
    const toggle = card.querySelector('[data-action="toggle-site"]');
    toggle.addEventListener("change", () => {
      currentConfig[siteId].enabled = toggle.checked;
      card.classList.toggle("disabled", !toggle.checked);
      saveConfig();
    });

    // Expand/collapse
    const expandBtn = card.querySelector('[data-action="expand"]');
    const panel = card.querySelector('[data-panel="' + siteId + '"]');
    expandBtn.addEventListener("click", () => {
      const isOpen = panel.classList.toggle("open");
      expandBtn.classList.toggle("open", isOpen);
    });

    // Text inputs
    card.querySelectorAll('.override-input[data-field]').forEach((input) => {
      input.addEventListener("input", () => {
        updateOverrideField(siteId, input.dataset.field, input.value);
      });
    });

    // Radio buttons
    card.querySelectorAll('input[type="radio"][data-field]').forEach((radio) => {
      radio.addEventListener("change", () => {
        updateOverrideField(siteId, radio.dataset.field, radio.value);
      });
    });

    // Checkbox (showElapsedTime)
    const elapsedToggle = card.querySelector('[data-field="showElapsedTime"]');
    if (elapsedToggle) {
      elapsedToggle.addEventListener("change", () => {
        updateOverrideField(siteId, "showElapsedTime", elapsedToggle.checked);
      });
    }

    // Clear overrides
    const clearBtn = card.querySelector('[data-action="clear-overrides"]');
    clearBtn.addEventListener("click", () => {
      currentConfig[siteId].activityOverrides = {};
      // Re-render just this card's overrides
      const inputs = card.querySelectorAll(".override-input");
      inputs.forEach((inp) => { inp.value = ""; });
      const radios = card.querySelectorAll('input[type="radio"]');
      radios.forEach((r) => { r.checked = r.value === ""; });
      if (elapsedToggle) elapsedToggle.checked = false;
      saveConfig();
    });
  }

  function updateOverrideField(siteId, field, value) {
    const ov = currentConfig[siteId].activityOverrides;

    if (field.startsWith("btn")) {
      // Button fields: btn1-label, btn1-url, btn2-label, btn2-url
      if (!ov.buttons) ov.buttons = [{}, {}];
      while (ov.buttons.length < 2) ov.buttons.push({});

      const idx = field.charAt(3) === "1" ? 0 : 1;
      const prop = field.endsWith("-label") ? "label" : "url";
      ov.buttons[idx][prop] = value || undefined;

      // Clean up empty buttons
      cleanButtons(ov);
    } else if (field === "showElapsedTime") {
      if (value) {
        ov.showElapsedTime = true;
      } else {
        delete ov.showElapsedTime;
      }
    } else if (field === "statusDisplayType") {
      if (value) {
        ov.statusDisplayType = value;
      } else {
        delete ov.statusDisplayType;
      }
    } else {
      // Text fields: name, details, state
      if (value) {
        ov[field] = value;
      } else {
        delete ov[field];
      }
    }

    saveConfig();
  }

  function cleanButtons(ov) {
    if (!ov.buttons) return;
    // Remove trailing empty button objects
    for (let i = ov.buttons.length - 1; i >= 0; i--) {
      const b = ov.buttons[i];
      if (!b.label && !b.url) {
        ov.buttons.splice(i, 1);
      } else {
        break;
      }
    }
    if (ov.buttons.length === 0) {
      delete ov.buttons;
    }
  }

  // ── Toast ──

  function showToast(message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }

    toastEl.textContent = message;
    toastEl.classList.add("show");

    setTimeout(() => {
      toastEl.classList.remove("show");
    }, 1400);
  }

  // ── Helpers ──

  function esc(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }

  // ── Listen for status changes while popup is open ──

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STATUS_KEY]) {
      const data = changes[STATUS_KEY].newValue;
      if (data) {
        setStatus(data.status, data.details?.message || "");
      }
    }
  });
})();
