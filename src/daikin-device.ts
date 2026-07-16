import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import {
  USER_AGENT,
  ENDPOINT,
  MIN_REQUEST_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  RATE_LIMIT_MS,
  COMMAND_QUERY_WITH_MD,
  CLIMATE_OPERATE_ON,
  CLIMATE_OPERATE_OFF,
  CLIMATE_OPERATE_SETTING,
  CLIMATE_MODE_COOLING,
  TARGET_TEMP_PN_BY_MODE,
  FAN_SPEED_PN_BY_MODE,
  FAN_SPEED_PN_DEFAULT,
  FAN_SPEED_TABLE,
  MODE_BY_CODE,
  CODE_BY_MODE,
  MODE_LABELS,
  type ModeKey,
  type FanSpeedKey,
} from './const';

// Shared across all devices so we never hammer the LAN with concurrent writes.
const http = rateLimit(axios.create(), {
  maxRequests: 1,
  perMilliseconds: RATE_LIMIT_MS,
});

export interface DeviceStatus {
  online: boolean;
  id: string;
  configName: string;
  ip: string;
  deviceName: string | null;
  mac: string | null;
  ssid: string | null;
  model: string | null;
  firmware: string | null;
  region: string | null;
  power: boolean | null;
  mode: ModeKey | null;
  modeCode: string | null;
  modeLabel: string | null;
  targetTemp: number | null;
  targetTempRange: [number, number] | null;
  coolingTempRange: [number, number] | null;
  heatingTempRange: [number, number] | null;
  indoorTemp: number | null;
  indoorHumidity: number | null;
  outdoorTemp: number | null;
  fanSpeed: FanSpeedKey | null;
  fanSpeedCode: string | null;
  fanSpeedLabel: string | null;
  fanSpeedNumber: number | null;
  motionDetection: boolean | null;
  lastUpdated: number | null;
  error: string | null;
}

type PnNode = {
  pn?: string;
  pv?: string | number;
  pch?: PnNode[];
  md?: { mi?: string; mx?: string };
};

type MultireqResponse = {
  responses?: Array<{
    fr?: string;
    pc?: { pn?: string; pch?: PnNode[]; pv?: string | number };
  }>;
};

export class DaikinDevice {
  private response: MultireqResponse = {};
  private lastUpdateTimestamp = 0;
  private inflightQuery: Promise<MultireqResponse | undefined> | null = null;
  private lastError: string | null = null;

  constructor(
    public readonly id: string,
    public readonly configName: string,
    public readonly ip: string,
  ) {}

  // ── Transport ──────────────────────────────────────────────

  private async post(data: string): Promise<{ status: number; data: unknown }> {
    const res = await http.request({
      method: 'post',
      url: `http://${this.ip}${ENDPOINT}`,
      headers: {
        Accept: 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      data,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return { status: res.status, data: res.data };
  }

  async queryDevice(force = false): Promise<MultireqResponse | undefined> {
    if (!force) {
      if (Date.now() - this.lastUpdateTimestamp < MIN_REQUEST_INTERVAL_MS) {
        return this.response;
      }
      if (this.inflightQuery) {
        return this.inflightQuery;
      }
    }

    const request = this.doQuery();
    if (!force) {
      this.inflightQuery = request;
    }

    try {
      return await request;
    } finally {
      if (this.inflightQuery === request) {
        this.inflightQuery = null;
      }
    }
  }

  private async doQuery(): Promise<MultireqResponse | undefined> {
    try {
      const response = await this.post(COMMAND_QUERY_WITH_MD);
      this.lastUpdateTimestamp = Date.now();

      if (response.status === 200) {
        this.response = response.data as MultireqResponse;
        this.lastError = null;
        return this.response;
      }

      this.lastError = `Invalid status ${response.status}`;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    return undefined;
  }

  async fetchStatus(force = false): Promise<DeviceStatus> {
    const data = await this.queryDevice(force);
    if (!data) {
      return this.buildStatus(false);
    }
    // MAC is required to consider the unit online / speaking dsiot.
    if (!this.getMacAddress()) {
      this.lastError = this.lastError ?? 'No MAC address in response (not a dsiot unit?)';
      return this.buildStatus(false);
    }
    return this.buildStatus(true);
  }

  // ── Tree helpers ───────────────────────────────────────────

  /**
   * Walk the nested dsiot response tree (same algorithm as the Homebridge plugin).
   * Find response by `fr`, then walk `pn` segments; return the leaf with `pv`
   * (temperature leaves may also carry `md` min/max).
   */
  extractObject(
    responsesData: MultireqResponse,
    fr: string,
    path: string,
  ): PnNode | undefined {
    try {
      if (!responsesData?.responses) {
        return undefined;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let currentObject: any = responsesData.responses;

      for (const response of currentObject) {
        if (response.fr === fr) {
          currentObject = response.pc?.pch;
        }
      }

      const pathKeys = path.split('/').filter(Boolean);

      for (const key of pathKeys) {
        try {
          for (const el of currentObject as PnNode[]) {
            if (el.pn === key && el.pch) {
              currentObject = el.pch;
              break;
            }
            if (el.pn === key && Object.prototype.hasOwnProperty.call(el, 'pv')) {
              return el;
            }
          }
        } catch {
          /* continue */
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  extractValue(
    responsesData: MultireqResponse,
    fr: string,
    path: string,
  ): string | number | undefined {
    const el = this.extractObject(responsesData, fr, path);
    return el?.pv;
  }

  private pushObject(
    jsonData: Array<{ pn: string; pch?: PnNode[]; pv?: string }>,
    pn: string,
    obj: PnNode,
  ): void {
    for (const current of jsonData) {
      if (current.pn === pn && current.pch) {
        current.pch.push(obj);
        return;
      }
    }
  }

  private async sendCommand(
    command: Array<{ pn: string; pch?: PnNode[]; pv?: string }>,
  ): Promise<boolean> {
    const param = {
      requests: [
        {
          op: 3,
          to: '/dsiot/edge/adr_0100.dgc_status',
          pc: {
            pn: 'dgc_status',
            pch: [{ pn: 'e_1002', pch: command }],
          },
        },
      ],
    };

    try {
      const response = await this.post(JSON.stringify(param));
      await this.fetchStatus(true);
      return response.status === 200;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  // ── Getters ────────────────────────────────────────────────

  getMacAddress(): string | null {
    const v = this.extractValue(this.response, '/dsiot/edge.adp_i', 'mac');
    return v != null ? String(v) : null;
  }

  getSSID(): string | null {
    const v = this.extractValue(this.response, '/dsiot/edge.adp_i', 'ssid');
    return v != null ? String(v) : null;
  }

  getDeviceName(): string | null {
    const v = this.extractValue(this.response, '/dsiot/edge.adp_d', 'name');
    return v != null ? String(v) : null;
  }

  getDeviceReg(): string | null {
    const v = this.extractValue(this.response, '/dsiot/edge.adp_i', 'reg');
    return v != null ? String(v) : null;
  }

  getDeviceType(): string | null {
    const type = this.extractValue(this.response, '/dsiot/edge.dev_i', 'type');
    const enlv = this.extractValue(this.response, '/dsiot/edge.adp_i', 'enlv');
    if (type == null && enlv == null) return null;
    return `${type ?? ''}${enlv ?? ''}`;
  }

  getFirmwareVersion(): string | null {
    const v = this.extractValue(this.response, '/dsiot/edge.adp_i', 'ver');
    return v != null ? String(v) : null;
  }

  getPowerStatus(): boolean | null {
    const v = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      'e_1002/e_A002/p_01',
    );
    if (v == null) return null;
    return String(v) === '01';
  }

  getIndoorTemperature(): number | null {
    const v = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      'e_1002/e_A00B/p_01',
    );
    if (v == null) return null;
    const n = parseInt(String(v), 16);
    return Number.isFinite(n) ? n : null;
  }

  getIndoorHumidity(): number | null {
    const v = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      'e_1002/e_A00B/p_02',
    );
    if (v == null) return null;
    const n = parseInt(String(v), 16);
    return Number.isFinite(n) ? n : null;
  }

  /** Outdoor unit: little-endian signed int16 of (temp * 2). */
  getOutdoorTemperature(): number | null {
    const raw = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0200.dgc_status',
      'e_1003/e_A00D/p_01',
    );
    if (typeof raw !== 'string' || raw.length !== 4) {
      return null;
    }
    const lo = parseInt(raw.substring(0, 2), 16);
    const hi = parseInt(raw.substring(2, 4), 16);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    let val = (hi << 8) | lo;
    if (val & 0x8000) {
      val -= 0x10000;
    }
    return val / 2;
  }

  getOperationModeCode(): string | null {
    const v = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      'e_1002/e_3001/p_01',
    );
    return v != null ? String(v) : null;
  }

  getOperationMode(): ModeKey | null {
    const code = this.getOperationModeCode();
    if (!code) return null;
    return MODE_BY_CODE[code] ?? null;
  }

  getTargetTemperatureWithMode(modeCode: string): number | null {
    const pn = TARGET_TEMP_PN_BY_MODE[modeCode];
    if (!pn) return null;
    const v = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      `e_1002/e_3001/${pn}`,
    );
    if (v == null) return null;
    const n = parseInt(String(v), 16) / 2.0;
    return Number.isFinite(n) ? n : null;
  }

  getTargetTemperature(): number | null {
    const mode = this.getOperationModeCode();
    if (!mode) return null;
    return this.getTargetTemperatureWithMode(mode);
  }

  private getTempRangeForPn(pn: string): [number, number] | null {
    const md = this.extractObject(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      `e_1002/e_3001/${pn}`,
    );
    if (!md?.md?.mi || !md?.md?.mx) return null;
    const min = parseInt(md.md.mi, 16) / 2.0;
    const max = parseInt(md.md.mx, 16) / 2.0;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return [min, max];
  }

  getTargetTemperatureRange(): [number, number] | null {
    const mode = this.getOperationModeCode();
    if (!mode) return null;
    const pn = TARGET_TEMP_PN_BY_MODE[mode];
    if (!pn) return null;
    return this.getTempRangeForPn(pn);
  }

  getCoolingThresholdTemperatureRange(): [number, number] | null {
    return this.getTempRangeForPn('p_02');
  }

  getHeatingThresholdTemperatureRange(): [number, number] | null {
    return this.getTempRangeForPn('p_03');
  }

  getFanSpeedCode(): string | null {
    const mode = this.getOperationModeCode();
    if (!mode) return null;
    const pn = FAN_SPEED_PN_BY_MODE[mode] ?? FAN_SPEED_PN_DEFAULT;
    const v = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      `e_1002/e_3001/${pn}`,
    );
    return v != null ? String(v) : null;
  }

  getFanSpeedEntry() {
    const code = this.getFanSpeedCode();
    if (!code) return null;
    return FAN_SPEED_TABLE.find((e) => e.code === code) ?? null;
  }

  getMotionDetection(): boolean | null {
    const v = this.extractValue(
      this.response,
      '/dsiot/edge/adr_0100.dgc_status',
      'e_1002/e_3003/p_27',
    );
    if (v == null) return null;
    return String(v) === '01';
  }

  // ── Setters ────────────────────────────────────────────────

  async setPowerStatus(power: boolean): Promise<boolean> {
    const operate = power ? CLIMATE_OPERATE_ON : CLIMATE_OPERATE_OFF;
    const command = [
      { pn: 'e_3003', pch: [{ pn: 'p_2D', pv: operate }] },
      { pn: 'e_A002', pch: [{ pn: 'p_01', pv: power ? '01' : '00' }] },
    ];
    return this.sendCommand(command);
  }

  async setOperationMode(mode: ModeKey): Promise<boolean> {
    const code = CODE_BY_MODE[mode];
    if (!code) return false;
    const command = [
      { pn: 'e_3003', pch: [{ pn: 'p_2D', pv: CLIMATE_OPERATE_SETTING }] },
      { pn: 'e_3001', pch: [{ pn: 'p_01', pv: code }] },
    ];
    return this.sendCommand(command);
  }

  async setTargetTemperature(temperature: number): Promise<boolean> {
    const mode = this.getOperationModeCode();
    if (!mode) return false;
    const pn = TARGET_TEMP_PN_BY_MODE[mode];
    if (!pn) return false;

    const pv = (temperature * 2).toString(16);
    const command: Array<{ pn: string; pch?: PnNode[]; pv?: string }> = [
      { pn: 'e_3003', pch: [{ pn: 'p_2D', pv: CLIMATE_OPERATE_SETTING }] },
      { pn: 'e_3001', pch: [{ pn: pn, pv }] },
    ];

    if (mode === CLIMATE_MODE_COOLING) {
      this.pushObject(command, 'e_3001', { pn: 'p_0B', pv: '0A' });
      this.pushObject(command, 'e_3001', { pn: 'p_0C', pv: '01' });
    }

    return this.sendCommand(command);
  }

  async setFanSpeed(speed: FanSpeedKey): Promise<boolean> {
    const entry = FAN_SPEED_TABLE.find((e) => e.key === speed);
    if (!entry) return false;

    const mode = this.getOperationModeCode();
    if (!mode) return false;
    const pn = FAN_SPEED_PN_BY_MODE[mode] ?? FAN_SPEED_PN_DEFAULT;

    const command = [
      { pn: 'e_3003', pch: [{ pn: 'p_2D', pv: CLIMATE_OPERATE_SETTING }] },
      { pn: 'e_3001', pch: [{ pn: pn, pv: entry.code }] },
    ];
    return this.sendCommand(command);
  }

  async setMotionDetection(enable: boolean): Promise<boolean> {
    const command = [
      {
        pn: 'e_3003',
        pch: [{ pn: 'p_27', pv: enable ? '01' : '00' }],
      },
    ];
    return this.sendCommand(command);
  }

  /** Hide/show Wi‑Fi SSID broadcast on the unit adapter (plugin feature). */
  async setShowSSID(show: boolean): Promise<boolean> {
    const command = {
      requests: [
        {
          op: 3,
          to: '/dsiot/edge.adp_d',
          pc: {
            pn: 'adp_d',
            pch: [{ pn: 'disp_ssid', pv: show ? 0 : 1 }],
          },
        },
      ],
    };

    try {
      const response = await this.post(JSON.stringify(command));
      await this.fetchStatus(true);
      return response.status === 200;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  // ── Status DTO ─────────────────────────────────────────────

  buildStatus(online: boolean): DeviceStatus {
    const mode = this.getOperationMode();
    const modeCode = this.getOperationModeCode();
    const fan = this.getFanSpeedEntry();

    return {
      online,
      id: this.id,
      configName: this.configName,
      ip: this.ip,
      deviceName: this.getDeviceName(),
      mac: this.getMacAddress(),
      ssid: this.getSSID(),
      model: this.getDeviceType(),
      firmware: this.getFirmwareVersion(),
      region: this.getDeviceReg(),
      power: online ? this.getPowerStatus() : null,
      mode: online ? mode : null,
      modeCode: online ? modeCode : null,
      modeLabel: online && mode ? MODE_LABELS[mode] : null,
      targetTemp: online ? this.getTargetTemperature() : null,
      targetTempRange: online ? this.getTargetTemperatureRange() : null,
      coolingTempRange: online
        ? this.getCoolingThresholdTemperatureRange()
        : null,
      heatingTempRange: online
        ? this.getHeatingThresholdTemperatureRange()
        : null,
      indoorTemp: online ? this.getIndoorTemperature() : null,
      indoorHumidity: online ? this.getIndoorHumidity() : null,
      outdoorTemp: online ? this.getOutdoorTemperature() : null,
      fanSpeed: online ? (fan?.key ?? null) : null,
      fanSpeedCode: online ? (fan?.code ?? this.getFanSpeedCode()) : null,
      fanSpeedLabel: online ? (fan?.name ?? null) : null,
      fanSpeedNumber: online ? (fan?.number ?? null) : null,
      motionDetection: online ? this.getMotionDetection() : null,
      lastUpdated: this.lastUpdateTimestamp || null,
      error: online ? null : this.lastError,
    };
  }
}
