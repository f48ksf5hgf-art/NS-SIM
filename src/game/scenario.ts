import type { GameState, Guard, Zone, ZoneId } from './types';

/** シナリオ定数 */
export const SCENARIO = {
  title: '商業施設 自動火災報知設備 発報',
  facilityName: 'NSショッピングプラザ（架空）',
  startClock: 14 * 3600 + 32 * 60,
  fireZone: 'D' as ZoneId,
  smokeSpreadZone: 'C' as ZoneId,
  initialIntensity: 15,
  /** 1秒あたりの火勢上昇 */
  growthPerSecond: 0.15,
  /** この火勢を超えると隣接区域へ煙が流入 */
  smokeSpreadThreshold: 45,
  /** この火勢を超えると初期消火は失敗 */
  extinguishLimit: 50,
  /** 火勢拡大の警告 */
  dangerThreshold: 80,
  fireDeptResponseSeconds: 300,
  fireDeptExtinguishSeconds: 60,
} as const;

/** 作業に要する秒数 */
export const WORK_SECONDS = {
  investigate: 20,
  extinguish: 40,
} as const;

/** 1秒あたりの避難人数 */
export const EVACUATION_RATE = {
  announcement: 3,
  guide: 6,
} as const;

type ZoneSeed = Pick<Zone, 'id' | 'name' | 'floorLabel' | 'floor' | 'description' | 'occupants'>;

const zoneSeeds: ZoneSeed[] = [
  {
    id: 'A',
    name: '正面エントランス',
    floorLabel: '1F',
    floor: 1,
    description: '正面出入口・総合案内',
    occupants: 120,
  },
  {
    id: 'B',
    name: 'フードコート',
    floorLabel: '1F',
    floor: 1,
    description: '飲食店舗・客席約300席',
    occupants: 210,
  },
  {
    id: 'C',
    name: '物販エリア',
    floorLabel: '2F',
    floor: 2,
    description: 'アパレル・雑貨店舗',
    occupants: 160,
  },
  {
    id: 'D',
    name: '倉庫・バックヤード',
    floorLabel: '2F',
    floor: 2,
    description: '店舗在庫・段ボール集積場',
    occupants: 8,
  },
  {
    id: 'E',
    name: 'シネマ',
    floorLabel: '3F',
    floor: 3,
    description: 'スクリーン4室・上映中',
    occupants: 240,
  },
  {
    id: 'F',
    name: '駐車場',
    floorLabel: 'B1F',
    floor: -1,
    description: '駐車台数180台',
    occupants: 35,
  },
];

const zones: Zone[] = zoneSeeds.map((z) => ({
  ...z,
  initialOccupants: z.occupants,
  alarm: false,
  smoke: false,
  confirmed: false,
  evacuated: false,
}));

const guards: Guard[] = [
  { id: 'g1', name: '田中', role: '隊長', callSign: '警備1', location: 'HQ', task: null },
  { id: 'g2', name: '佐藤', role: '隊員', callSign: '警備2', location: 'A', task: null },
  { id: 'g3', name: '鈴木', role: '隊員', callSign: '警備3', location: 'F', task: null },
];

export function createInitialState(): GameState {
  const zoneMap = Object.fromEntries(zones.map((z) => [z.id, { ...z }])) as Record<ZoneId, Zone>;
  return {
    scenarioTitle: SCENARIO.title,
    startClock: SCENARIO.startClock,
    time: 0,
    started: false,
    running: false,
    speed: 1,
    zones: zoneMap,
    zoneOrder: zones.map((z) => z.id),
    guards: guards.map((g) => ({ ...g })),
    fire: {
      zoneId: SCENARIO.fireZone,
      intensity: SCENARIO.initialIntensity,
      active: true,
      extinguishedBy: null,
      discoveredAt: null,
      smokeSpreadAt: null,
    },
    announcedAt: null,
    called119At: null,
    fireDeptArrivedAt: null,
    smokeExposure: 0,
    log: [],
    nextLogId: 1,
    outcome: null,
  };
}
