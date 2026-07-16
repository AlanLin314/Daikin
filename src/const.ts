export const ENDPOINT = '/dsiot/multireq';
export const USER_AGENT =
  'DaikinMobileController/1.0.0 CFNetwork/1410.0.3 Darwin/22.6.0';

/** Skip re-query if last update was within this window. */
export const MIN_REQUEST_INTERVAL_MS = 2000;

/** Abort hung device requests. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Shared HTTP client: max 1 request per this many ms. */
export const RATE_LIMIT_MS = 500;

export const CLIMATE_MODE_FAN = '0000';
export const CLIMATE_MODE_HEATING = '0100';
export const CLIMATE_MODE_COOLING = '0200';
export const CLIMATE_MODE_AUTO = '0300';
export const CLIMATE_MODE_DEHUMIDIFY = '0500';
export const CLIMATE_MODE_HUMIDIFY = '0800';

export const CLIMATE_FAN_SPEED_AUTO = '0A00';
export const CLIMATE_FAN_SPEED_SILENT = '0B00';
export const CLIMATE_FAN_SPEED_1 = '0300';
export const CLIMATE_FAN_SPEED_2 = '0400';
export const CLIMATE_FAN_SPEED_3 = '0500';
export const CLIMATE_FAN_SPEED_4 = '0600';
export const CLIMATE_FAN_SPEED_5 = '0700';

export const CLIMATE_OPERATE_ON = '00';
export const CLIMATE_OPERATE_OFF = '01';
export const CLIMATE_OPERATE_SETTING = '02';

/** Human-readable mode keys used by the API / UI. */
export type ModeKey =
  | 'fan'
  | 'heat'
  | 'cool'
  | 'auto'
  | 'dry'
  | 'humidify';

export type FanSpeedKey =
  | 'auto'
  | 'silent'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5';

export const MODE_BY_CODE: Record<string, ModeKey> = {
  [CLIMATE_MODE_FAN]: 'fan',
  [CLIMATE_MODE_HEATING]: 'heat',
  [CLIMATE_MODE_COOLING]: 'cool',
  [CLIMATE_MODE_AUTO]: 'auto',
  [CLIMATE_MODE_DEHUMIDIFY]: 'dry',
  [CLIMATE_MODE_HUMIDIFY]: 'humidify',
};

export const CODE_BY_MODE: Record<ModeKey, string> = {
  fan: CLIMATE_MODE_FAN,
  heat: CLIMATE_MODE_HEATING,
  cool: CLIMATE_MODE_COOLING,
  auto: CLIMATE_MODE_AUTO,
  dry: CLIMATE_MODE_DEHUMIDIFY,
  humidify: CLIMATE_MODE_HUMIDIFY,
};

export const MODE_LABELS: Record<ModeKey, string> = {
  fan: '送風',
  heat: '暖氣',
  cool: '冷氣',
  auto: '自動',
  dry: '除濕',
  humidify: '加濕',
};

export const FAN_SPEED_TABLE: {
  code: string;
  key: FanSpeedKey;
  number: number;
  name: string;
}[] = [
  { code: CLIMATE_FAN_SPEED_AUTO, key: 'auto', number: 0, name: '自動' },
  { code: CLIMATE_FAN_SPEED_SILENT, key: 'silent', number: 1, name: '靜音' },
  { code: CLIMATE_FAN_SPEED_1, key: '1', number: 2, name: '1' },
  { code: CLIMATE_FAN_SPEED_2, key: '2', number: 3, name: '2' },
  { code: CLIMATE_FAN_SPEED_3, key: '3', number: 4, name: '3' },
  { code: CLIMATE_FAN_SPEED_4, key: '4', number: 5, name: '4' },
  { code: CLIMATE_FAN_SPEED_5, key: '5', number: 6, name: '5' },
];

/** Target temperature lives under a mode-dependent `pn` inside e_1002/e_3001. */
export const TARGET_TEMP_PN_BY_MODE: Record<string, string> = {
  [CLIMATE_MODE_HEATING]: 'p_03',
  [CLIMATE_MODE_COOLING]: 'p_02',
  [CLIMATE_MODE_AUTO]: 'p_1D',
};

/** Fan speed lives under a mode-dependent `pn` inside e_1002/e_3001. */
export const FAN_SPEED_PN_BY_MODE: Record<string, string> = {
  [CLIMATE_MODE_FAN]: 'p_28',
  [CLIMATE_MODE_DEHUMIDIFY]: 'p_27',
  [CLIMATE_MODE_AUTO]: 'p_26',
  [CLIMATE_MODE_HEATING]: 'p_0A',
  [CLIMATE_MODE_COOLING]: 'p_09',
};
export const FAN_SPEED_PN_DEFAULT = 'p_09';

export const COMMAND_QUERY_WITH_MD = JSON.stringify({
  requests: [
    { op: 2, to: '/dsiot/edge.adp_i?filter=pv' },
    { op: 2, to: '/dsiot/edge.adp_d?filter=pv' },
    { op: 2, to: '/dsiot/edge.adp_f?filter=pv' },
    { op: 2, to: '/dsiot/edge.dev_i?filter=pv' },
    { op: 2, to: '/dsiot/edge/adr_0100.dgc_status' },
    { op: 2, to: '/dsiot/edge/adr_0200.dgc_status' },
  ],
});
