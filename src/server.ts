import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { loadConfig } from './config';
import { DaikinDevice } from './daikin-device';
import {
  CODE_BY_MODE,
  FAN_SPEED_TABLE,
  MODE_LABELS,
  type FanSpeedKey,
  type ModeKey,
} from './const';

const config = loadConfig();
const devices = new Map<string, DaikinDevice>();

for (const d of config.devices) {
  devices.set(d.id, new DaikinDevice(d.id, d.name, d.ip));
}

const app = express();
app.use(express.json());

// Static UI
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

function getDevice(id: string): DaikinDevice | undefined {
  return devices.get(id);
}

function badRequest(res: Response, message: string) {
  return res.status(400).json({ ok: false, error: message });
}

function notFound(res: Response, message: string) {
  return res.status(404).json({ ok: false, error: message });
}

async function withDevice(
  req: Request,
  res: Response,
  fn: (device: DaikinDevice) => Promise<void>,
) {
  const device = getDevice(req.params.id);
  if (!device) {
    notFound(res, `Device not found: ${req.params.id}`);
    return;
  }
  try {
    await fn(device);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(502).json({ ok: false, error: message });
  }
}

// ── Routes ─────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    deviceCount: devices.size,
    uptimeSec: Math.floor(process.uptime()),
  });
});

app.get('/api/meta', (_req, res) => {
  res.json({
    ok: true,
    modes: Object.entries(MODE_LABELS).map(([key, label]) => ({
      key,
      label,
      code: CODE_BY_MODE[key as ModeKey],
    })),
    fanSpeeds: FAN_SPEED_TABLE.map((e) => ({
      key: e.key,
      label: e.name,
      number: e.number,
      code: e.code,
    })),
  });
});

app.get('/api/devices', async (_req, res) => {
  const list = [];
  for (const device of devices.values()) {
    const status = await device.fetchStatus(false);
    list.push(status);
  }
  res.json({ ok: true, devices: list });
});

app.get('/api/devices/:id/status', async (req, res) => {
  await withDevice(req, res, async (device) => {
    const force = req.query.force === '1' || req.query.force === 'true';
    const status = await device.fetchStatus(force);
    res.json({ ok: true, device: status });
  });
});

app.post('/api/devices/:id/power', async (req, res) => {
  await withDevice(req, res, async (device) => {
    if (typeof req.body?.on !== 'boolean') {
      badRequest(res, 'Body must be { on: boolean }');
      return;
    }
    // Ensure we have current state tree before write (mode keys etc.).
    await device.fetchStatus(true);
    const ok = await device.setPowerStatus(req.body.on);
    const status = device.buildStatus(ok || !!device.getMacAddress());
    res.json({ ok, device: status, error: ok ? null : status.error ?? 'Power command failed' });
  });
});

app.post('/api/devices/:id/mode', async (req, res) => {
  await withDevice(req, res, async (device) => {
    const mode = req.body?.mode as ModeKey;
    if (!mode || !(mode in CODE_BY_MODE)) {
      badRequest(
        res,
        `Body must be { mode: one of ${Object.keys(CODE_BY_MODE).join(', ')} }`,
      );
      return;
    }
    await device.fetchStatus(true);
    const ok = await device.setOperationMode(mode);
    const status = await device.fetchStatus(true);
    res.json({ ok, device: status, error: ok ? null : status.error ?? 'Mode command failed' });
  });
});

app.post('/api/devices/:id/temperature', async (req, res) => {
  await withDevice(req, res, async (device) => {
    const celsius = Number(req.body?.celsius);
    if (!Number.isFinite(celsius)) {
      badRequest(res, 'Body must be { celsius: number }');
      return;
    }
    await device.fetchStatus(true);
    const ok = await device.setTargetTemperature(celsius);
    const status = await device.fetchStatus(true);
    res.json({
      ok,
      device: status,
      error: ok ? null : status.error ?? 'Temperature command failed (mode may not support target temp)',
    });
  });
});

app.post('/api/devices/:id/fan', async (req, res) => {
  await withDevice(req, res, async (device) => {
    const speed = String(req.body?.speed) as FanSpeedKey;
    const valid = FAN_SPEED_TABLE.some((e) => e.key === speed);
    if (!valid) {
      badRequest(
        res,
        `Body must be { speed: one of ${FAN_SPEED_TABLE.map((e) => e.key).join(', ')} }`,
      );
      return;
    }
    await device.fetchStatus(true);
    const ok = await device.setFanSpeed(speed);
    const status = await device.fetchStatus(true);
    res.json({ ok, device: status, error: ok ? null : status.error ?? 'Fan command failed' });
  });
});

app.post('/api/devices/:id/motion', async (req, res) => {
  await withDevice(req, res, async (device) => {
    if (typeof req.body?.enabled !== 'boolean') {
      badRequest(res, 'Body must be { enabled: boolean }');
      return;
    }
    await device.fetchStatus(true);
    const ok = await device.setMotionDetection(req.body.enabled);
    const status = await device.fetchStatus(true);
    res.json({
      ok,
      device: status,
      error: ok ? null : status.error ?? 'Motion detection command failed',
    });
  });
});

app.post('/api/devices/:id/show-ssid', async (req, res) => {
  await withDevice(req, res, async (device) => {
    if (typeof req.body?.show !== 'boolean') {
      badRequest(res, 'Body must be { show: boolean }');
      return;
    }
    const ok = await device.setShowSSID(req.body.show);
    const status = await device.fetchStatus(true);
    res.json({
      ok,
      device: status,
      error: ok ? null : status.error ?? 'Show SSID command failed',
    });
  });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(config.port, config.host, () => {
  console.log(`大金冷氣控制台已啟動：http://${config.host}:${config.port}`);
  console.log(
    `裝置：${config.devices.map((d) => `${d.name}(${d.ip})`).join('、')}`,
  );
  console.log('僅內網使用 — 請用同一 Wi‑Fi 的手機開啟此主機 IP。');
});
