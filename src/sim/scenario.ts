import { DIFFICULTIES, SIM_CONSTANTS } from './difficulty';
import { generateFacility, generateGuards, validateFacility, type FacilityIssue } from './facility';
import { createRng, type Rng } from './rng';
import type { Difficulty, Facility, IncidentKind, IncidentPlan, ScenarioSpec } from './types';

export const GENERATED_SCENARIO_ID = 'generated';

const FIRE_USES = new Set(['storage', 'food', 'retail', 'office', 'cinema']);

function planKinds(rng: Rng, difficulty: Difficulty): IncidentKind[] {
  switch (difficulty) {
    case 'easy':
      return [rng.pick(['fire', 'casualty'] as const)];
    case 'normal': {
      const first = rng.pick(['fire', 'casualty', 'earthquake'] as const);
      if (!rng.chance(0.5)) return [first];
      return [first, rng.pick((['fire', 'casualty'] as const).filter((k) => k !== first))];
    }
    case 'hard': {
      const kinds: IncidentKind[] = ['fire', 'casualty'];
      return rng.chance(0.5) ? rng.shuffle([...kinds, 'earthquake']) : rng.shuffle(kinds);
    }
    case 'expert': {
      // 傷病者（取り違えあり）は必ず含め、火災・地震を組み合わせる
      const kinds: IncidentKind[] = ['casualty', rng.pick(['fire', 'earthquake'] as const)];
      if (rng.chance(0.5)) kinds.push(kinds[1] === 'fire' ? 'earthquake' : 'fire');
      return rng.shuffle(kinds);
    }
  }
}

function startTimes(rng: Rng, difficulty: Difficulty, count: number): number[] {
  // Expert は通常勤務から始まり、最初の事件の時刻も非公開
  let t = difficulty === 'expert' ? rng.int(30, 90) : 0;
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    times.push(t);
    t += difficulty === 'hard' || difficulty === 'expert' ? rng.int(30, 150) : rng.int(60, 150);
  }
  return times;
}

function planIncidents(rng: Rng, difficulty: Difficulty, facility: Facility): IncidentPlan[] {
  const kinds = planKinds(rng, difficulty);
  const times = startTimes(rng, difficulty, kinds.length);
  const zones = facility.zoneOrder.map((id) => facility.zones[id]);
  const plans: IncidentPlan[] = [];
  kinds.forEach((kind, i) => {
    const id = `${kind}-${i + 1}`;
    if (kind === 'fire') {
      const zone = rng.pick(zones.filter((z) => FIRE_USES.has(z.use)));
      plans.push({ id, kind, zoneId: zone.id, startAt: times[i], genuine: true });
    } else if (kind === 'casualty') {
      const zone = rng.pick(zones.filter((z) => z.use !== 'storage' && z.capacity > 0));
      // Expert：通報者が区域を取り違える（同じ階の別区域を伝える）
      const sameFloor = facility.floors.find((f) => f.floor === zone.floor)!.zoneIds.filter((z) => z !== zone.id);
      const reportedZoneId = difficulty === 'expert' ? rng.pick(sameFloor) : zone.id;
      plans.push({ id, kind, zoneId: zone.id, reportedZoneId, startAt: times[i] });
    } else {
      const damage = Object.fromEntries(
        facility.zoneOrder.map((z) => [z, rng.chance(0.25) ? ('debris' as const) : ('none' as const)]),
      );
      plans.push({ id, kind, startAt: times[i], damage });
    }
  });
  if (difficulty === 'expert') {
    // 感知器の誤作動（非火災報）：本物の火災とは別区域
    const fireZone = plans.find((p) => p.kind === 'fire')?.zoneId;
    const zone = rng.pick(zones.filter((z) => z.id !== fireZone));
    plans.push({ id: 'fire-false', kind: 'fire', zoneId: zone.id, startAt: rng.int(20, 200), genuine: false });
  }
  return plans.sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
}

/** 検証用の判定関数（クリア可能性など）を受け取り、不合格なら派生シードで再生成する */
export type ScenarioVerifier = (spec: ScenarioSpec) => boolean;

export const MAX_GENERATION_ATTEMPTS = 20;

/** 同じ難易度・シードからは常に同じシナリオを生成する */
export function generateScenario(difficulty: Difficulty, seed: number, verify?: ScenarioVerifier): ScenarioSpec {
  const params = DIFFICULTIES[difficulty];
  let last: ScenarioSpec | null = null;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const rng = createRng((seed + Math.imul(attempt, 0x9e3779b1)) >>> 0);
    const facility = generateFacility(rng, params);
    const guards = generateGuards(rng, facility, params.guards);
    const incidents = planIncidents(rng, difficulty, facility);
    const spec: ScenarioSpec = {
      scenarioId: GENERATED_SCENARIO_ID,
      difficulty,
      seed,
      attempt,
      title: `${params.label}：${facility.name}`,
      facility,
      guards,
      incidents,
      params,
      startClock: SIM_CONSTANTS.startClock,
      timeLimit: SIM_CONSTANTS.timeLimit,
    };
    last = spec;
    if (validateScenario(spec).length === 0 && (!verify || verify(spec))) return spec;
  }
  throw new Error(
    `シナリオを生成できませんでした（${difficulty} / seed ${seed}）: ${JSON.stringify(validateScenario(last!))}`,
  );
}

/** 施設・隊員・事件の発生区域の整合性を検証する */
export function validateScenario(spec: ScenarioSpec): FacilityIssue[] {
  const issues = validateFacility(spec.facility, spec.guards);
  const { zones, floors } = spec.facility;
  for (const p of spec.incidents) {
    if (p.startAt < 0 || p.startAt >= spec.timeLimit) issues.push({ code: 'start_time', detail: `${p.id} の発生時刻` });
    if (p.kind === 'fire') {
      if (!zones[p.zoneId]) issues.push({ code: 'incident_zone', detail: `${p.id} の区域 ${p.zoneId} がない` });
    } else if (p.kind === 'casualty') {
      if (!zones[p.zoneId] || !zones[p.reportedZoneId]) {
        issues.push({ code: 'incident_zone', detail: `${p.id} の区域がない` });
      } else if (zones[p.zoneId].floor !== zones[p.reportedZoneId].floor) {
        issues.push({ code: 'misreport_floor', detail: `${p.id} の取り違え先が別の階` });
      }
    } else if (Object.keys(p.damage).sort().join() !== [...spec.facility.zoneOrder].sort().join()) {
      issues.push({ code: 'quake_zones', detail: `${p.id} の被害区域が施設と一致しない` });
    }
  }
  if (spec.incidents.filter((p) => p.kind === 'earthquake').length > 1) {
    issues.push({ code: 'multiple_quakes', detail: '地震は1回まで' });
  }
  if (spec.incidents.filter((p) => p.kind === 'fire' && p.genuine).length > 1) {
    issues.push({ code: 'multiple_fires', detail: '火災は1件まで' });
  }
  if (!floors.length) issues.push({ code: 'no_floors', detail: '階がない' });
  return issues;
}
