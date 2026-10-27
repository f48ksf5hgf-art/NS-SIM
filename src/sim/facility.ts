import { SIM_CONSTANTS } from './difficulty';
import type { Rng } from './rng';
import {
  HQ,
  type DifficultyParams,
  type Facility,
  type FloorDef,
  type GuardDef,
  type ZoneDef,
  type ZoneUse,
} from './types';

export const USE_LABELS: Record<ZoneUse, string> = {
  lobby: 'エントランス',
  retail: '物販エリア',
  food: 'フードコート',
  office: 'テナント事務所',
  cinema: 'シネマ',
  storage: '倉庫・バックヤード',
  parking: '駐車場',
  clinic: 'クリニック',
};

const CAPACITY: Record<ZoneUse, [number, number]> = {
  lobby: [60, 140],
  retail: [80, 200],
  food: [100, 240],
  office: [20, 70],
  cinema: [120, 240],
  storage: [2, 10],
  parking: [15, 45],
  clinic: [10, 35],
};

const FACILITY_NAMES = [
  'NSタウンプラザ（架空）',
  'NSリバーサイドモール（架空）',
  'NSステーションビル（架空）',
  'NSシティスクエア（架空）',
  'NSベイサイドセンター（架空）',
];

const GUARD_NAMES = ['田中', '佐藤', '鈴木', '高橋', '伊藤', '渡辺', '山本', '中村'];

function floorLabel(floor: number): string {
  return floor < 0 ? `B${-floor}F` : `${floor}F`;
}

function zoneIdPrefix(floor: number): string {
  return floor < 0 ? `B${-floor}` : String(floor);
}

function usesForFloor(rng: Rng, floor: number, top: number, count: number): ZoneUse[] {
  if (floor < 0) return Array.from({ length: count }, (_, i) => (i === count - 1 && count > 1 ? 'storage' : 'parking'));
  const pool: ZoneUse[] =
    floor === 1
      ? ['retail', 'food', 'clinic']
      : floor === top
        ? ['cinema', 'food', 'office', 'storage']
        : ['retail', 'food', 'office', 'storage', 'clinic'];
  return Array.from({ length: count }, (_, i) => (floor === 1 && i === 0 ? 'lobby' : rng.pick(pool)));
}

/** 移動経路グラフ上の最短秒数（Dijkstra）。出発準備の秒数を加える */
export function computeTravel(nodes: string[], links: Facility['links']): Facility['travel'] {
  const adj = new Map<string, { to: string; s: number }[]>(nodes.map((n) => [n, []]));
  for (const l of links) {
    adj.get(l.from)!.push({ to: l.to, s: l.seconds });
    adj.get(l.to)!.push({ to: l.from, s: l.seconds });
  }
  const travel: Facility['travel'] = {};
  for (const src of nodes) {
    const dist = new Map<string, number>([[src, 0]]);
    const done = new Set<string>();
    while (true) {
      let cur: string | null = null;
      for (const [n, d] of dist) if (!done.has(n) && (cur === null || d < dist.get(cur)!)) cur = n;
      if (cur === null) break;
      done.add(cur);
      for (const e of adj.get(cur)!) {
        const nd = dist.get(cur)! + e.s;
        if (nd < (dist.get(e.to) ?? Infinity)) dist.set(e.to, nd);
      }
    }
    travel[src] = Object.fromEntries(
      nodes.map((n) => [n, n === src ? 0 : dist.has(n) ? dist.get(n)! + SIM_CONSTANTS.departSeconds : null]),
    );
  }
  return travel;
}

export function generateFacility(rng: Rng, params: DifficultyParams): Facility {
  const floorCount = rng.int(params.floors[0], params.floors[1]);
  const hasBasement = floorCount >= 4 && rng.chance(0.5);
  const floorNumbers = hasBasement
    ? [-1, ...Array.from({ length: floorCount - 1 }, (_, i) => i + 1)]
    : Array.from({ length: floorCount }, (_, i) => i + 1);
  const top = floorNumbers[floorNumbers.length - 1];

  // 各階2区域以上（同一階の隣接・誤通報の取り違え先を確保）で、残りを無作為に配分
  const totalZones = Math.max(rng.int(params.zones[0], params.zones[1]), floorCount * 2);
  const perFloor = floorNumbers.map(() => 2);
  for (let rest = totalZones - floorCount * 2; rest > 0; rest--) perFloor[rng.int(0, floorCount - 1)]++;

  const zones: Record<string, ZoneDef> = {};
  const floors: FloorDef[] = [];
  const links: Facility['links'] = [];
  floorNumbers.forEach((floor, fi) => {
    const uses = usesForFloor(rng, floor, top, perFloor[fi]);
    const used = new Map<ZoneUse, number>();
    const ids: string[] = [];
    uses.forEach((use, i) => {
      const id = `${zoneIdPrefix(floor)}${String.fromCharCode(65 + i)}`;
      const n = (used.get(use) ?? 0) + 1;
      used.set(use, n);
      const [lo, hi] = CAPACITY[use];
      zones[id] = {
        id,
        name: n > 1 ? `${USE_LABELS[use]}${n}` : USE_LABELS[use],
        use,
        floor,
        floorLabel: floorLabel(floor),
        capacity: rng.int(lo, hi),
        stair: i === 0,
      };
      if (i > 0) links.push({ from: ids[i - 1], to: id, seconds: SIM_CONSTANTS.corridorSeconds });
      ids.push(id);
    });
    floors.push({ floor, label: floorLabel(floor), zoneIds: ids });
  });
  // 階段：各階の階段室側区域を上下に接続
  for (let i = 1; i < floors.length; i++) {
    const gap = floors[i].floor - floors[i - 1].floor;
    links.push({ from: floors[i - 1].zoneIds[0], to: floors[i].zoneIds[0], seconds: SIM_CONSTANTS.stairSeconds * gap });
  }
  // 防災センターは1階の階段室側区域に隣接
  const hqFloor = 1;
  links.push({
    from: HQ,
    to: floors.find((f) => f.floor === hqFloor)!.zoneIds[0],
    seconds: SIM_CONSTANTS.corridorSeconds,
  });

  const zoneOrder = floors.flatMap((f) => f.zoneIds);
  return {
    name: rng.pick(FACILITY_NAMES),
    floors,
    zones,
    zoneOrder,
    hqFloor,
    links,
    travel: computeTravel([HQ, ...zoneOrder], links),
  };
}

export function generateGuards(rng: Rng, facility: Facility, count: number): GuardDef[] {
  const guards: GuardDef[] = [{ id: 'g1', name: GUARD_NAMES[0], callSign: '警備1', role: '隊長', location: HQ }];
  // 隊員はできるだけ別の階に巡回配置する
  const floorOrder = rng.shuffle(facility.floors);
  for (let i = 1; i < count; i++) {
    const floor = floorOrder[(i - 1) % floorOrder.length];
    guards.push({
      id: `g${i + 1}`,
      name: GUARD_NAMES[i % GUARD_NAMES.length],
      callSign: `警備${i + 1}`,
      role: '隊員',
      location: rng.pick(floor.zoneIds),
    });
  }
  return guards;
}

export interface FacilityIssue {
  code: string;
  detail: string;
}

/** 施設・隊員配置の整合性を検証する（問題がなければ空配列） */
export function validateFacility(facility: Facility, guards: GuardDef[]): FacilityIssue[] {
  const issues: FacilityIssue[] = [];
  const nodes = [HQ, ...facility.zoneOrder];
  for (const a of nodes) {
    for (const b of nodes) {
      if (facility.travel[a]?.[b] == null) issues.push({ code: 'unreachable', detail: `${a}→${b} に移動経路がない` });
    }
  }
  for (const f of facility.floors) {
    if (f.zoneIds.length === 0) issues.push({ code: 'empty_floor', detail: `${f.label} に区域がない` });
    if (!facility.zones[f.zoneIds[0]]?.stair) issues.push({ code: 'no_stair', detail: `${f.label} に階段室がない` });
  }
  if (!facility.floors.some((f) => f.floor === facility.hqFloor)) {
    issues.push({ code: 'no_hq_floor', detail: '防災センターの階がない' });
  }
  const ids = new Set<string>();
  for (const g of guards) {
    if (ids.has(g.id)) issues.push({ code: 'duplicate_guard', detail: `${g.id} が重複` });
    ids.add(g.id);
    if (g.location !== HQ && !facility.zones[g.location]) {
      issues.push({ code: 'guard_location', detail: `${g.callSign} の配置 ${g.location} が施設内にない` });
    }
  }
  if (!guards.some((g) => g.location === HQ))
    issues.push({ code: 'no_hq_guard', detail: '防災センターに隊員がいない' });
  return issues;
}
