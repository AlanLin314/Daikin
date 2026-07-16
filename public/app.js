(() => {
  const POLL_MS = 8000;

  const MODE_PRIMARY = ['cool', 'heat', 'auto'];
  const MODE_SECONDARY = ['dry', 'fan', 'humidify'];
  const MODE_META = {
    cool: { label: '冷氣', icon: 'cool', hint: '涼爽送風' },
    heat: { label: '暖氣', icon: 'heat', hint: '溫暖送風' },
    auto: { label: '自動', icon: 'auto', hint: '智慧調節' },
    dry: { label: '除濕', icon: 'dry', hint: '降低濕度' },
    fan: { label: '送風', icon: 'fan', hint: '僅循環風' },
    humidify: { label: '加濕', icon: 'humidify', hint: '增加濕度' },
  };

  function modeIconSvg(kind) {
    const common =
      'viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    switch (kind) {
      case 'cool':
        return `<svg ${common}><path d="M12 3v18M6.5 6.5l11 11M17.5 6.5l-11 11M3 12h18"/></svg>`;
      case 'heat':
        return `<svg ${common}><path d="M12 14a3 3 0 0 0 3-3c0-2-3-5.5-3-5.5S9 9 9 11a3 3 0 0 0 3 3z"/><path d="M8.5 15.5c-1.2 1-2 2.3-2 3.7A5.5 5.5 0 0 0 12 24"/><path d="M15.5 15.5c1.2 1 2 2.3 2 3.7A5.5 5.5 0 0 1 12 24"/></svg>`;
      case 'auto':
        return `<svg ${common}><path d="M12 3a9 9 0 1 0 9 9"/><path d="M21 3v6h-6"/><path d="M12 8v4l2.5 1.5"/></svg>`;
      case 'dry':
        return `<svg ${common}><path d="M12 3s5 5.2 5 9a5 5 0 0 1-10 0c0-3.8 5-9 5-9z"/></svg>`;
      case 'fan':
        return `<svg ${common}><circle cx="12" cy="12" r="2"/><path d="M12 4c2.5 0 4 1.8 4 3.5S14 10 12 10"/><path d="M12 20c-2.5 0-4-1.8-4-3.5S10 14 12 14"/><path d="M4.8 9.2c1.3-2.2 3.5-2.8 5-1.8S11 11 9.5 12.2"/><path d="M19.2 14.8c-1.3 2.2-3.5 2.8-5 1.8S13 13 14.5 11.8"/></svg>`;
      case 'humidify':
        return `<svg ${common}><path d="M8 14a4 4 0 0 0 8 0c0-3-4-7-4-7s-4 4-4 7z"/><path d="M7 19h10"/></svg>`;
      default:
        return '';
    }
  }

  /** Slider positions 0–5 map to manual fan speeds (auto is a separate button). */
  const FAN_SLIDER_KEYS = ['silent', '1', '2', '3', '4', '5'];
  const FAN_LABELS = {
    auto: '自動',
    silent: '靜音',
    '1': '1 段',
    '2': '2 段',
    '3': '3 段',
    '4': '4 段',
    '5': '5 段',
  };

  /** @type {Array<any>} */
  let devices = [];
  let currentId = null;
  let busy = false;
  let pollTimer = null;
  let pendingTemp = null;
  let tempTimer = null;
  /** True while user is typing in the temperature field. */
  let tempEditing = false;
  /** Remember last manual slider level (0–5) while auto is on. */
  let lastManualFanIndex = 2;
  let fanDragging = false;
  let fanCommitTimer = null;

  const el = {
    app: document.getElementById('app'),
    subtitle: document.getElementById('subtitle'),
    toast: document.getElementById('toast'),
    errorBanner: document.getElementById('error-banner'),
    deviceTabs: document.getElementById('device-tabs'),
    panel: document.getElementById('panel'),
    empty: document.getElementById('empty'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnPower: document.getElementById('btn-power'),
    powerLabel: document.getElementById('power-label'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    deviceTitle: document.getElementById('device-title'),
    deviceMeta: document.getElementById('device-meta'),
    indoorTemp: document.getElementById('indoor-temp'),
    indoorHumidity: document.getElementById('indoor-humidity'),
    outdoorTemp: document.getElementById('outdoor-temp'),
    targetTempInput: document.getElementById('target-temp-input'),
    tempRange: document.getElementById('temp-range'),
    tempHint: document.getElementById('temp-hint'),
    btnTempDown: document.getElementById('btn-temp-down'),
    btnTempUp: document.getElementById('btn-temp-up'),
    modePrimary: document.getElementById('mode-primary'),
    modeSecondary: document.getElementById('mode-secondary'),
    modeCurrent: document.getElementById('mode-current'),
    btnFanAuto: document.getElementById('btn-fan-auto'),
    fanSlider: document.getElementById('fan-slider'),
    fanCurrent: document.getElementById('fan-current'),
    toggleMotion: document.getElementById('toggle-motion'),
    btnSsidShow: document.getElementById('btn-ssid-show'),
    btnSsidHide: document.getElementById('btn-ssid-hide'),
    infoIp: document.getElementById('info-ip'),
    infoMac: document.getElementById('info-mac'),
    infoSsid: document.getElementById('info-ssid'),
    infoModel: document.getElementById('info-model'),
    infoFw: document.getElementById('info-fw'),
    infoRegion: document.getElementById('info-region'),
    infoUpdated: document.getElementById('info-updated'),
  };

  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle('error', isError);
    el.toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.add('hidden'), 2800);
  }

  function setBusy(on) {
    busy = on;
    el.panel.classList.toggle('busy', on);
    el.btnRefresh.classList.toggle('spinning', on);
  }

  function fmt(n, digits = 0) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('zh-TW', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  function modeLabel(key) {
    return MODE_META[key]?.label || key || '—';
  }

  function fanLabel(key) {
    return FAN_LABELS[key] || key || '—';
  }

  function fanKeyToSliderIndex(key) {
    if (!key || key === 'auto') return lastManualFanIndex;
    const idx = FAN_SLIDER_KEYS.indexOf(key);
    return idx >= 0 ? idx : lastManualFanIndex;
  }

  function setFanSliderVisual(index) {
    const clamped = Math.max(0, Math.min(5, Number(index) || 0));
    el.fanSlider.value = String(clamped);
    const pct = (clamped / 5) * 100;
    el.fanSlider.parentElement.style.setProperty('--fan-pct', `${pct}%`);
  }

  function currentDevice() {
    return devices.find((d) => d.id === currentId) || null;
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderTabs() {
    if (devices.length <= 1) {
      el.deviceTabs.classList.add('hidden');
      el.deviceTabs.innerHTML = '';
      return;
    }
    el.deviceTabs.classList.remove('hidden');
    el.deviceTabs.innerHTML = devices
      .map(
        (d) =>
          `<button type="button" class="device-tab ${d.id === currentId ? 'active' : ''}" data-id="${escapeHtml(
            d.id,
          )}">${escapeHtml(d.configName || d.deviceName || d.id)}</button>`,
      )
      .join('');
  }

  function buildModeButtons(container, keys, active, variant) {
    if (!container) return;
    container.innerHTML = keys
      .map((key) => {
        const meta = MODE_META[key];
        const isActive = active === key;
        return `<button type="button" class="mode-btn mode-btn--${variant} mode-btn--${key} ${
          isActive ? 'active' : ''
        }" data-mode="${key}" aria-pressed="${isActive ? 'true' : 'false'}">
        <span class="mode-icon">${modeIconSvg(meta.icon)}</span>
        <span class="mode-text">
          <span class="mode-name">${meta.label}</span>
          <span class="mode-hint">${meta.hint}</span>
        </span>
      </button>`;
      })
      .join('');
  }

  function buildModeGrid(active) {
    buildModeButtons(el.modePrimary, MODE_PRIMARY, active, 'primary');
    buildModeButtons(el.modeSecondary, MODE_SECONDARY, active, 'secondary');
    if (el.modeCurrent) {
      el.modeCurrent.textContent = active ? modeLabel(active) : '—';
    }
  }

  function updateFanControls(device) {
    const online = !!(device && device.online);
    const isAuto = device?.fanSpeed === 'auto';
    const sliderIndex = fanKeyToSliderIndex(device?.fanSpeed);

    if (device?.fanSpeed && device.fanSpeed !== 'auto') {
      lastManualFanIndex = sliderIndex;
    }

    el.btnFanAuto.classList.toggle('active', isAuto);
    el.btnFanAuto.setAttribute('aria-pressed', isAuto ? 'true' : 'false');
    el.btnFanAuto.disabled = !online;

    // Keep slider usable so user can drag out of auto; only disable when offline.
    el.fanSlider.disabled = !online;

    if (!fanDragging) {
      setFanSliderVisual(isAuto ? lastManualFanIndex : sliderIndex);
    }

    el.fanCurrent.textContent = fanLabel(device?.fanSpeed);
  }

  function supportsTargetTemp(device) {
    return device && (device.mode === 'cool' || device.mode === 'heat' || device.mode === 'auto');
  }

  function getTempBounds(device) {
    if (device?.targetTempRange) {
      return {
        min: device.targetTempRange[0],
        max: device.targetTempRange[1],
      };
    }
    return { min: 10, max: 32 };
  }

  /** Snap to 0.5 °C steps used by the unit. */
  function snapTemp(value) {
    return Math.round(Number(value) * 2) / 2;
  }

  function clampTemp(value, device) {
    const { min, max } = getTempBounds(device);
    let v = snapTemp(value);
    if (!Number.isFinite(v)) return null;
    v = Math.max(min, Math.min(max, v));
    return v;
  }

  function setTempInputDisplay(value, device) {
    if (tempEditing) return;
    if (value == null || Number.isNaN(value)) {
      el.targetTempInput.value = '';
      el.targetTempInput.placeholder = '—';
    } else {
      el.targetTempInput.value = fmt(value, 1);
    }
    if (device) {
      const { min, max } = getTempBounds(device);
      el.targetTempInput.min = String(min);
      el.targetTempInput.max = String(max);
    }
  }

  function commitTypedTemp() {
    const d = currentDevice();
    if (!d || !supportsTargetTemp(d) || !d.online) {
      tempEditing = false;
      setTempInputDisplay(d?.targetTemp, d);
      return;
    }

    const raw = el.targetTempInput.value.trim();
    if (raw === '') {
      tempEditing = false;
      setTempInputDisplay(
        pendingTemp != null ? pendingTemp : d.targetTemp,
        d,
      );
      return;
    }

    const next = clampTemp(raw, d);
    if (next == null) {
      showToast('請輸入有效溫度', true);
      tempEditing = false;
      setTempInputDisplay(
        pendingTemp != null ? pendingTemp : d.targetTemp,
        d,
      );
      return;
    }

    const current =
      pendingTemp != null ? pendingTemp : d.targetTemp;
    tempEditing = false;
    pendingTemp = next;
    setTempInputDisplay(next, d);

    if (current != null && Math.abs(current - next) < 0.01) {
      pendingTemp = null;
      return;
    }

    clearTimeout(tempTimer);
    command(`/api/devices/${encodeURIComponent(d.id)}/temperature`, {
      celsius: next,
    });
  }

  function setThemeMode(device) {
    if (!device || !device.online || !device.power) {
      el.app.dataset.mode = 'off';
      return;
    }
    el.app.dataset.mode = device.mode || 'off';
  }

  function renderDevice() {
    const d = currentDevice();
    if (!d) {
      el.panel.classList.add('hidden');
      el.empty.classList.remove('hidden');
      el.empty.innerHTML =
        '<p>沒有裝置</p><p>請在 <code>config.json</code> 設定 devices 的 IP。</p>';
      el.app.dataset.mode = 'off';
      return;
    }

    el.empty.classList.add('hidden');
    el.panel.classList.remove('hidden');
    setThemeMode(d);

    if (d.error) {
      el.errorBanner.textContent = d.online
        ? d.error
        : `裝置離線或無法連線（${d.ip}）：${d.error}`;
      el.errorBanner.classList.remove('hidden');
    } else {
      el.errorBanner.classList.add('hidden');
    }

    const title = d.deviceName || d.configName || d.id;
    el.deviceTitle.textContent = title;

    const modeText = modeLabel(d.mode);
    const fanText = fanLabel(d.fanSpeed);
    el.deviceMeta.textContent = d.online
      ? `${modeText} · ${fanText} · ${d.ip}`
      : `離線 · ${d.ip}`;

    const on = !!d.power;
    el.btnPower.classList.toggle('on', on && d.online);
    el.btnPower.setAttribute('aria-pressed', on && d.online ? 'true' : 'false');
    el.powerLabel.textContent = !d.online ? '離線' : on ? '運轉中' : '已關機';

    el.statusDot.classList.toggle('online', !!d.online && on);
    el.statusDot.classList.toggle('offline', !d.online);
    el.statusText.textContent = !d.online ? '離線' : on ? '運轉中' : '待機';

    el.indoorTemp.textContent = fmt(d.indoorTemp, 0);
    el.indoorHumidity.textContent = fmt(d.indoorHumidity, 0);
    el.outdoorTemp.textContent =
      d.outdoorTemp == null ? '—' : fmt(d.outdoorTemp, 1);

    const displayTemp = pendingTemp != null ? pendingTemp : d.targetTemp;
    setTempInputDisplay(displayTemp, d);

    if (d.targetTempRange) {
      el.tempRange.textContent = `${d.targetTempRange[0]}–${d.targetTempRange[1]} °C`;
    } else if (d.coolingTempRange || d.heatingTempRange) {
      const parts = [];
      if (d.coolingTempRange) {
        parts.push(`冷 ${d.coolingTempRange[0]}–${d.coolingTempRange[1]}`);
      }
      if (d.heatingTempRange) {
        parts.push(`暖 ${d.heatingTempRange[0]}–${d.heatingTempRange[1]}`);
      }
      el.tempRange.textContent = parts.join(' · ');
    } else {
      el.tempRange.textContent = '';
    }

    const tempOk = supportsTargetTemp(d) && d.online;
    el.btnTempDown.disabled = !tempOk;
    el.btnTempUp.disabled = !tempOk;
    el.targetTempInput.disabled = !tempOk;
    el.tempHint.style.display = tempOk ? 'none' : 'block';

    buildModeGrid(d.mode);
    updateFanControls(d);

    el.toggleMotion.checked = !!d.motionDetection;
    el.toggleMotion.disabled = !d.online;

    el.infoIp.textContent = d.ip || '—';
    el.infoMac.textContent = d.mac || '—';
    el.infoSsid.textContent = d.ssid || '—';
    el.infoModel.textContent = d.model || '—';
    el.infoFw.textContent = d.firmware || '—';
    el.infoRegion.textContent = d.region || '—';
    el.infoUpdated.textContent = fmtTime(d.lastUpdated);

    el.subtitle.textContent = d.online
      ? `內網 · 最後更新 ${fmtTime(d.lastUpdated)}`
      : '內網 · 裝置未回應';
  }

  async function loadDevices(force = false) {
    const data = await api('/api/devices');
    devices = data.devices || [];
    if (!currentId || !devices.some((d) => d.id === currentId)) {
      currentId = devices[0]?.id || null;
    }
    if (force && currentId) {
      const one = await api(
        `/api/devices/${encodeURIComponent(currentId)}/status?force=1`,
      );
      const idx = devices.findIndex((d) => d.id === currentId);
      if (idx >= 0) devices[idx] = one.device;
    }
    renderTabs();
    renderDevice();
  }

  async function command(path, body) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (data.device) {
        const idx = devices.findIndex((d) => d.id === data.device.id);
        if (idx >= 0) devices[idx] = data.device;
        else devices.push(data.device);
      }
      pendingTemp = null;
      renderTabs();
      renderDevice();
      if (!data.ok) {
        showToast(data.error || '指令失敗', true);
      }
    } catch (e) {
      showToast(e.message || String(e), true);
      try {
        await loadDevices(true);
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  function scheduleTempCommit(next) {
    tempEditing = false;
    pendingTemp = next;
    const d = currentDevice();
    setTempInputDisplay(next, d);
    clearTimeout(tempTimer);
    tempTimer = setTimeout(async () => {
      const device = currentDevice();
      if (!device || pendingTemp == null) return;
      await command(`/api/devices/${encodeURIComponent(device.id)}/temperature`, {
        celsius: pendingTemp,
      });
    }, 450);
  }

  // Events
  el.btnRefresh.addEventListener('click', async () => {
    try {
      setBusy(true);
      await loadDevices(true);
      showToast('已重新整理');
    } catch (e) {
      showToast(e.message || String(e), true);
    } finally {
      setBusy(false);
    }
  });

  el.deviceTabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-id]');
    if (!btn) return;
    currentId = btn.getAttribute('data-id');
    pendingTemp = null;
    renderTabs();
    renderDevice();
    loadDevices(true).catch(() => {});
  });

  el.btnPower.addEventListener('click', () => {
    const d = currentDevice();
    if (!d || !d.online) {
      showToast('裝置離線，無法操作', true);
      return;
    }
    command(`/api/devices/${encodeURIComponent(d.id)}/power`, {
      on: !d.power,
    });
  });

  el.btnTempDown.addEventListener('click', () => {
    const d = currentDevice();
    if (!d || !supportsTargetTemp(d)) return;
    const base = pendingTemp != null ? pendingTemp : d.targetTemp;
    if (base == null) return;
    const next = clampTemp(base - 0.5, d);
    if (next == null) return;
    scheduleTempCommit(next);
  });

  el.btnTempUp.addEventListener('click', () => {
    const d = currentDevice();
    if (!d || !supportsTargetTemp(d)) return;
    const base = pendingTemp != null ? pendingTemp : d.targetTemp;
    if (base == null) return;
    const next = clampTemp(base + 0.5, d);
    if (next == null) return;
    scheduleTempCommit(next);
  });

  el.targetTempInput.addEventListener('focus', () => {
    tempEditing = true;
    el.targetTempInput.select();
  });

  el.targetTempInput.addEventListener('blur', () => {
    commitTypedTemp();
  });

  el.targetTempInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      el.targetTempInput.blur();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      tempEditing = false;
      const d = currentDevice();
      setTempInputDisplay(
        pendingTemp != null ? pendingTemp : d?.targetTemp,
        d,
      );
      el.targetTempInput.blur();
    }
  });

  function onModeClick(ev) {
    const btn = ev.target.closest('[data-mode]');
    if (!btn) return;
    const d = currentDevice();
    if (!d) return;
    command(`/api/devices/${encodeURIComponent(d.id)}/mode`, {
      mode: btn.getAttribute('data-mode'),
    });
  }

  el.modePrimary.addEventListener('click', onModeClick);
  el.modeSecondary.addEventListener('click', onModeClick);

  el.btnFanAuto.addEventListener('click', () => {
    const d = currentDevice();
    if (!d || !d.online) return;
    // Toggle: if already auto, restore last manual level; otherwise switch to auto.
    if (d.fanSpeed === 'auto') {
      const key = FAN_SLIDER_KEYS[lastManualFanIndex] || '3';
      command(`/api/devices/${encodeURIComponent(d.id)}/fan`, { speed: key });
    } else {
      command(`/api/devices/${encodeURIComponent(d.id)}/fan`, { speed: 'auto' });
    }
  });

  function commitFanSlider() {
    const d = currentDevice();
    if (!d || !d.online) return;
    const index = Number(el.fanSlider.value);
    const key = FAN_SLIDER_KEYS[index];
    if (!key) return;
    lastManualFanIndex = index;
    setFanSliderVisual(index);
    el.fanCurrent.textContent = fanLabel(key);
    command(`/api/devices/${encodeURIComponent(d.id)}/fan`, { speed: key });
  }

  el.fanSlider.addEventListener('pointerdown', () => {
    fanDragging = true;
  });

  el.fanSlider.addEventListener('input', () => {
    fanDragging = true;
    const index = Number(el.fanSlider.value);
    setFanSliderVisual(index);
    el.fanCurrent.textContent = fanLabel(FAN_SLIDER_KEYS[index]);
    el.btnFanAuto.classList.remove('active');
    el.btnFanAuto.setAttribute('aria-pressed', 'false');
  });

  el.fanSlider.addEventListener('change', () => {
    fanDragging = false;
    clearTimeout(fanCommitTimer);
    commitFanSlider();
  });

  // Fallback if pointer ends without change on some mobile browsers
  el.fanSlider.addEventListener('pointerup', () => {
    if (!fanDragging) return;
    clearTimeout(fanCommitTimer);
    fanCommitTimer = setTimeout(() => {
      fanDragging = false;
    }, 50);
  });

  el.toggleMotion.addEventListener('change', () => {
    const d = currentDevice();
    if (!d) return;
    command(`/api/devices/${encodeURIComponent(d.id)}/motion`, {
      enabled: el.toggleMotion.checked,
    });
  });

  el.btnSsidShow.addEventListener('click', () => {
    const d = currentDevice();
    if (!d) return;
    command(`/api/devices/${encodeURIComponent(d.id)}/show-ssid`, { show: true });
  });

  el.btnSsidHide.addEventListener('click', () => {
    const d = currentDevice();
    if (!d) return;
    command(`/api/devices/${encodeURIComponent(d.id)}/show-ssid`, { show: false });
  });

  function startPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (busy || document.hidden) return;
      loadDevices(false).catch(() => {});
    }, POLL_MS);
  }

  async function init() {
    buildModeGrid(null);
    setFanSliderVisual(lastManualFanIndex);
    try {
      await loadDevices(true);
      startPoll();
    } catch (e) {
      el.empty.classList.remove('hidden');
      el.panel.classList.add('hidden');
      el.empty.innerHTML = `
        <p><strong>無法連線到控制服務</strong></p>
        <p>${escapeHtml(e.message || e)}</p>
        <p>請確認已執行 <code>npm run dev</code>，並在 config.json 填入冷氣 IP。</p>
      `;
      el.subtitle.textContent = '連線失敗';
    }
  }

  init();
})();
