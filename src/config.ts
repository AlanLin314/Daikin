import fs from 'fs';
import path from 'path';

export interface DeviceConfig {
  id: string;
  name: string;
  ip: string;
}

export interface AppConfig {
  port: number;
  host: string;
  pollIntervalMs: number;
  devices: DeviceConfig[];
}

const DEFAULTS: AppConfig = {
  port: 3080,
  host: '0.0.0.0',
  pollIntervalMs: 8000,
  devices: [],
};

function resolveConfigPath(): string | null {
  const fromEnv = process.env.CONFIG_PATH;
  const candidates = [
    fromEnv,
    path.resolve(process.cwd(), 'config.json'),
    path.resolve(__dirname, '..', 'config.json'),
    '/app/config.json',
    '/data/config.json',
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function normalizeDevices(
  devices: Array<Partial<DeviceConfig>>,
): DeviceConfig[] {
  return devices.map((d, i) => ({
    id: d.id || `device-${i + 1}`,
    name: d.name || d.ip || `裝置 ${i + 1}`,
    ip: d.ip || '',
  }));
}

/** Allow Docker/env-only setup without a config file. */
function devicesFromEnv(): DeviceConfig[] | null {
  const multi = process.env.DAIKIN_DEVICES;
  if (multi) {
    try {
      const parsed = JSON.parse(multi) as Array<Partial<DeviceConfig>>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizeDevices(parsed);
      }
    } catch {
      throw new Error('環境變數 DAIKIN_DEVICES 不是合法 JSON 陣列。');
    }
  }

  const ip = process.env.DAIKIN_IP;
  if (ip) {
    return normalizeDevices([
      {
        id: process.env.DAIKIN_ID || 'ac-1',
        name: process.env.DAIKIN_NAME || '冷氣',
        ip,
      },
    ]);
  }

  return null;
}

export function loadConfig(): AppConfig {
  const configPath = resolveConfigPath();
  let raw: Partial<AppConfig> = {};

  if (configPath) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AppConfig>;
  }

  const envDevices = devicesFromEnv();
  const devices = envDevices ?? normalizeDevices(raw.devices ?? []);

  if (devices.length === 0) {
    throw new Error(
      '尚未設定冷氣裝置。請掛載 config.json，或設定環境變數 DAIKIN_IP / DAIKIN_DEVICES。',
    );
  }

  for (const d of devices) {
    if (!d.ip) {
      throw new Error(`裝置「${d.id}」缺少 ip。`);
    }
  }

  return {
    port: Number(process.env.PORT) || raw.port || DEFAULTS.port,
    host: process.env.HOST || raw.host || DEFAULTS.host,
    pollIntervalMs:
      Number(process.env.POLL_INTERVAL_MS) ||
      raw.pollIntervalMs ||
      DEFAULTS.pollIntervalMs,
    devices,
  };
}
