/**
 * v0.3 ランダム生成シナリオの進行エンジン。複数の事件（火災・地震・傷病者）を同時に扱う。
 * 乱数は使わず、シナリオ定義（ScenarioSpec）と操作だけで状態が決まる。
 */
import type { LogCategory } from '../game/types';
import { SIM_CONSTANTS as K } from './difficulty';
import {
  HQ,
  type CasualtyIncident,
  type EarthquakeIncident,
  type FireIncident,
  type Incident,
  type ScenarioSpec,
  type SimAction,
  type SimActionType,
  type SimEventBodyV2,
  type SimGuard,
  type SimState,
  type ZoneState,
} from './types';

export const SIM_ACTION_LABELS: Record<SimActionType, string> = {
  investigate: '現場確認',
  extinguish: '初期消火',
  evacuate: '避難誘導',
  first_aid: '救護',
  return: '防災センターへ帰隊',
  standby: '待機（指示解除）',
};

/** 区域の指定が必要な指示 */
export const SIM_ACTIONS_WITH_TARGET: SimActionType[] = ['investigate', 'extinguish', 'evacuate', 'first_aid'];

export function createSimState(spec: ScenarioSpec): SimState {
  const zones: Record<string, ZoneState> = Object.fromEntries(
    spec.facility.zoneOrder.map((id) => [
      id,
      {
        occupants: spec.facility.zones[id].capacity,
        alarm: false,
        smoke: false,
        smokeConfirmed: false,
        evacuated: false,
        inspected: false,
        damage: null,
      },
    ]),
  );
  const incidents: Incident[] = spec.incidents.map((p): Incident => {
    const base = { id: p.id, startAt: p.startAt, status: 'pending' as const };
    if (p.kind === 'fire') {
      return {
        ...base,
        kind: 'fire',
        zoneId: p.zoneId,
        genuine: p.genuine,
        intensity: p.genuine ? spec.params.fireInitial : 0,
        confirmed: false,
        extinguishedBy: null,
        smokeSpreadAt: null,
        dangerNotified: false,
      };
    }
    if (p.kind === 'casualty') {
      return {
        ...base,
        kind: 'casualty',
        zoneId: p.zoneId,
        reportedZoneId: p.reportedZoneId,
        vitality: 100,
        confirmed: false,
        misreportFound: false,
        handedOver: false,
      };
    }
    return { ...base, kind: 'earthquake', shakingUntil: 0, damage: p.damage };
  });
  return {
    spec,
    scenarioTitle: spec.title,
    startClock: spec.startClock,
    time: 0,
    started: false,
    running: false,
    speed: 1,
    zones,
    guards: spec.guards.map((g) => ({ ...g, task: null })),
    incidents,
    calls: { fire: null, ambulance: null },
    announcements: { evacuate: null, shelter: null },
    fireDeptArrivedAt: null,
    ambulanceArrivedAt: null,
    smokeExposure: 0,
    log: [],
    nextLogId: 1,
    events: [],
    nextEventId: 1,
    outcome: null,
  };
}

// ---------------------------------------------------------------------------
// 表示・計算ヘルパー

export function simLocationName(state: SimState, loc: string): string {
  if (loc === HQ) return '防災センター';
  const z = state.spec.facility.zones[loc];
  return `${z.floorLabel} ${z.name}`;
}

export function simZoneLabel(state: SimState, id: string): string {
  const z = state.spec.facility.zones[id];
  return `${id}区域（${z.floorLabel} ${z.name}）`;
}

export function simTravelSeconds(state: SimState, from: string, to: string): number {
  return state.spec.facility.travel[from]?.[to] ?? Infinity;
}

export function isShaking(state: SimState): boolean {
  return state.incidents.some((q) => q.kind === 'earthquake' && q.status === 'active' && state.time < q.shakingUntil);
}

function addLog(state: SimState, category: LogCategory, message: string): number {
  const id = state.nextLogId++;
  state.log.push({ id, time: state.time, category, message });
  return id;
}

function record(state: SimState, body: SimEventBodyV2, logId: number | null = null): void {
  state.events.push({ ...body, id: state.nextEventId++, time: state.time, logId });
}

function setIdle(state: SimState, guard: SimGuard, logId: number | null = null): void {
  guard.task = null;
  record(state, { type: 'guard_idle', guardId: guard.id, location: guard.location }, logId);
}

const fires = (s: SimState) => s.incidents.filter((i): i is FireIncident => i.kind === 'fire');
const casualties = (s: SimState) => s.incidents.filter((i): i is CasualtyIncident => i.kind === 'casualty');
const quakes = (s: SimState) => s.incidents.filter((i): i is EarthquakeIncident => i.kind === 'earthquake');

function resolveIncident(state: SimState, inc: Incident, logId: number | null): void {
  inc.status = 'resolved';
  record(state, { type: 'incident_resolved', incidentId: inc.id, kind: inc.kind }, logId);
}

function failIncident(state: SimState, inc: Incident, reason: string, logId: number | null): void {
  inc.status = 'failed';
  record(state, { type: 'incident_failed', incidentId: inc.id, kind: inc.kind, reason }, logId);
}

/** 火災から煙が流入する区域（同じ階の隣接区域と、階段でつながる上階の区域） */
export function smokeTargets(spec: ScenarioSpec, zoneId: string): string[] {
  const out = new Set<string>();
  for (const l of spec.facility.links) {
    if (l.from === zoneId && l.to !== HQ) out.add(l.to);
    if (l.to === zoneId && l.from !== HQ) out.add(l.from);
  }
  const floor = spec.facility.zones[zoneId].floor;
  return [...out].filter((z) => spec.facility.zones[z].floor >= floor);
}

// ---------------------------------------------------------------------------
// 事件の発生

function activateDue(state: SimState): void {
  for (const inc of state.incidents) {
    if (inc.status !== 'pending' || inc.startAt > state.time) continue;
    inc.status = 'active';
    if (inc.kind === 'fire') {
      record(state, {
        type: 'incident_started',
        incidentId: inc.id,
        kind: 'fire',
        zoneId: inc.zoneId,
        genuine: inc.genuine,
      });
      state.zones[inc.zoneId].alarm = true;
      const logId = addLog(state, 'alarm', `受信盤：${simZoneLabel(state, inc.zoneId)} 自動火災報知設備 発報`);
      record(
        state,
        { type: 'incident_reported', incidentId: inc.id, kind: 'fire', source: 'detector', reportedZoneId: inc.zoneId },
        logId,
      );
    } else if (inc.kind === 'casualty') {
      record(state, {
        type: 'incident_started',
        incidentId: inc.id,
        kind: 'casualty',
        zoneId: inc.zoneId,
        genuine: true,
      });
      const logId = addLog(
        state,
        'alarm',
        `内線：「${simZoneLabel(state, inc.reportedZoneId)}でお客様が倒れている」との通報（テナント従業員より）`,
      );
      record(
        state,
        {
          type: 'incident_reported',
          incidentId: inc.id,
          kind: 'casualty',
          source: 'phone',
          reportedZoneId: inc.reportedZoneId,
        },
        logId,
      );
    } else {
      inc.shakingUntil = state.time + K.shakeSeconds;
      record(state, { type: 'incident_started', incidentId: inc.id, kind: 'earthquake', zoneId: null, genuine: true });
      const logId = addLog(state, 'danger', '地震発生。強い揺れが継続中（各隊員はその場で身の安全を確保）');
      record(
        state,
        { type: 'incident_reported', incidentId: inc.id, kind: 'earthquake', source: 'quake', reportedZoneId: null },
        logId,
      );
      record(state, { type: 'shaking_started', incidentId: inc.id }, logId);
    }
  }
}

// ---------------------------------------------------------------------------
// 警備員

function confirmFalseAlarm(state: SimState, inc: FireIncident, by: SimGuard | 'fire_department'): void {
  inc.confirmed = true;
  state.zones[inc.zoneId].alarm = false;
  const who = by === 'fire_department' ? '消防隊' : by.callSign;
  const logId = addLog(
    state,
    'report',
    `${who}「${simZoneLabel(state, inc.zoneId)}に火災なし。感知器の誤作動（非火災報）を確認」`,
  );
  record(
    state,
    {
      type: 'false_alarm_confirmed',
      incidentId: inc.id,
      by: by === 'fire_department' ? by : by.id,
      zoneId: inc.zoneId,
    },
    logId,
  );
  resolveIncident(state, inc, logId);
}

function discoverFire(state: SimState, inc: FireIncident, guard: SimGuard): void {
  if (inc.confirmed) return;
  inc.confirmed = true;
  const intensity = Math.round(inc.intensity);
  const logId = addLog(
    state,
    'danger',
    `${guard.callSign}「${simZoneLabel(state, inc.zoneId)}にて火災を確認、火勢${intensity}%」`,
  );
  record(
    state,
    { type: 'fire_confirmed', incidentId: inc.id, guardId: guard.id, zoneId: inc.zoneId, intensity },
    logId,
  );
}

/** 到着時に傷病者・取り違えの情報を得る */
function checkCasualtyOnArrival(state: SimState, guard: SimGuard, zoneId: string): void {
  for (const c of casualties(state)) {
    if (c.status !== 'active') continue;
    if (!c.confirmed && c.zoneId === zoneId) {
      c.confirmed = true;
      const vitality = Math.round(c.vitality);
      const logId = addLog(
        state,
        'danger',
        `${guard.callSign}「${simZoneLabel(state, zoneId)}で傷病者を確認。呼びかけに反応が弱い（容体${vitality}%）」`,
      );
      record(state, { type: 'casualty_confirmed', incidentId: c.id, guardId: guard.id, zoneId, vitality }, logId);
    } else if (!c.confirmed && !c.misreportFound && c.reportedZoneId === zoneId && c.zoneId !== zoneId) {
      c.misreportFound = true;
      const logId = addLog(
        state,
        'report',
        `${guard.callSign}「${simZoneLabel(state, zoneId)}に該当者なし。店員より『${simZoneLabel(state, c.zoneId)}で人が倒れている』との情報」`,
      );
      record(
        state,
        {
          type: 'misreport_found',
          incidentId: c.id,
          guardId: guard.id,
          reportedZoneId: zoneId,
          actualZoneId: c.zoneId,
        },
        logId,
      );
    }
  }
}

function beginWork(state: SimState, guard: SimGuard): void {
  const task = guard.task!;
  if (task.target === HQ || task.type === 'return') {
    const logId = addLog(
      state,
      'report',
      `${guard.callSign}「${simLocationName(state, task.target)}に到着、待機します」`,
    );
    record(state, { type: 'guard_arrived', guardId: guard.id, location: task.target, action: task.type }, logId);
    setIdle(state, guard, logId);
    return;
  }
  const zoneId = task.target;
  record(state, { type: 'guard_arrived', guardId: guard.id, location: zoneId, action: task.type });
  checkCasualtyOnArrival(state, guard, zoneId);
  const fire = fires(state).find((f) => f.status === 'active' && f.zoneId === zoneId);

  switch (task.type) {
    case 'investigate':
      task.phase = 'working';
      task.remaining = K.investigateSeconds;
      addLog(state, 'report', `${guard.callSign}「${simZoneLabel(state, zoneId)}に到着、確認中」`);
      return;
    case 'extinguish':
      if (fire?.genuine) {
        discoverFire(state, fire, guard);
        task.phase = 'working';
        task.remaining = K.extinguishSeconds;
        addLog(state, 'report', `${guard.callSign}「消火器による初期消火を開始」`);
      } else if (fire && !fire.confirmed) {
        confirmFalseAlarm(state, fire, guard);
        setIdle(state, guard);
      } else {
        const logId = addLog(state, 'report', `${guard.callSign}「${simZoneLabel(state, zoneId)}に火源なし」`);
        record(state, { type: 'zone_clear', guardId: guard.id, zoneId }, logId);
        setIdle(state, guard, logId);
      }
      return;
    case 'evacuate':
      task.phase = 'working';
      task.remaining = null;
      addLog(state, 'report', `${guard.callSign}「${simZoneLabel(state, zoneId)}に到着、避難誘導を開始」`);
      return;
    case 'first_aid': {
      const c = casualties(state).find((x) => x.status === 'active' && x.zoneId === zoneId);
      if (c) {
        task.phase = 'working';
        task.remaining = null;
        const logId = addLog(state, 'report', `${guard.callSign}「救護を開始（AED準備・回復体位）」`);
        record(state, { type: 'first_aid_started', incidentId: c.id, guardId: guard.id }, logId);
      } else {
        const logId = addLog(
          state,
          'report',
          `${guard.callSign}「${simZoneLabel(state, zoneId)}に傷病者なし、待機します」`,
        );
        setIdle(state, guard, logId);
      }
      return;
    }
    default:
      setIdle(state, guard);
  }
}

function completeWork(state: SimState, guard: SimGuard): void {
  const task = guard.task!;
  const zoneId = task.target;
  const zone = state.zones[zoneId];
  if (task.type === 'investigate') {
    let found = false;
    const fire = fires(state).find((f) => f.status === 'active' && f.zoneId === zoneId);
    if (fire?.genuine) {
      discoverFire(state, fire, guard);
      found = true;
    } else if (fire && !fire.confirmed) {
      confirmFalseAlarm(state, fire, guard);
      found = true;
    } else if (zone.smoke && !zone.smokeConfirmed) {
      zone.smokeConfirmed = true;
      const logId = addLog(
        state,
        'danger',
        `${guard.callSign}「${simZoneLabel(state, zoneId)}に煙が流入。火元は近くの区域の可能性」`,
      );
      record(state, { type: 'smoke_confirmed', guardId: guard.id, zoneId }, logId);
      found = true;
    }
    const quake = quakes(state).find((q) => q.status === 'active' && state.time >= q.shakingUntil);
    if (quake && !zone.inspected) {
      zone.inspected = true;
      zone.damage = quake.damage[zoneId];
      const logId = addLog(
        state,
        zone.damage === 'debris' ? 'danger' : 'report',
        zone.damage === 'debris'
          ? `${guard.callSign}「${simZoneLabel(state, zoneId)}、天井材・商品の落下あり。立入規制を実施」`
          : `${guard.callSign}「${simZoneLabel(state, zoneId)}、地震による被害なし」`,
      );
      record(
        state,
        { type: 'zone_inspected', incidentId: quake.id, guardId: guard.id, zoneId, damage: zone.damage },
        logId,
      );
      found = true;
    }
    if (!found && !casualties(state).some((c) => c.status === 'active' && c.confirmed && c.zoneId === zoneId)) {
      const logId = addLog(state, 'report', `${guard.callSign}「${simZoneLabel(state, zoneId)}、異常なし」`);
      record(state, { type: 'zone_clear', guardId: guard.id, zoneId }, logId);
    }
  } else if (task.type === 'extinguish') {
    const fire = fires(state).find((f) => f.status === 'active' && f.genuine && f.zoneId === zoneId);
    if (fire) {
      if (fire.intensity < K.extinguishLimit) {
        fire.intensity = 0;
        fire.extinguishedBy = 'guard';
        const logId = addLog(state, 'success', `${guard.callSign}「初期消火に成功。鎮火を確認」`);
        record(state, { type: 'extinguish_succeeded', incidentId: fire.id, guardId: guard.id }, logId);
        resolveIncident(state, fire, logId);
      } else {
        const intensity = Math.round(fire.intensity);
        const logId = addLog(state, 'danger', `${guard.callSign}「火勢が強く初期消火不能。区域外へ退避します」`);
        record(state, { type: 'extinguish_failed', incidentId: fire.id, guardId: guard.id, intensity }, logId);
      }
    }
  }
  setIdle(state, guard);
}

function stepGuards(state: SimState): void {
  // 揺れている間は全隊員がその場で身の安全を確保し、移動・作業は進まない
  if (isShaking(state)) return;
  for (const guard of state.guards) {
    const task = guard.task;
    if (!task) continue;
    if (task.phase === 'moving') {
      task.remaining = (task.remaining ?? 0) - 1;
      if (task.remaining <= 0) {
        guard.location = task.target;
        beginWork(state, guard);
      }
    } else if (task.remaining !== null) {
      task.remaining -= 1;
      if (task.remaining <= 0) completeWork(state, guard);
    }
  }
}

// ---------------------------------------------------------------------------
// 事件の進行

function isExtinguishing(state: SimState, fire: FireIncident): boolean {
  return state.guards.some(
    (g) => g.task?.type === 'extinguish' && g.task.phase === 'working' && g.task.target === fire.zoneId,
  );
}

function stepFires(state: SimState): void {
  for (const fire of fires(state)) {
    if (fire.status !== 'active' || !fire.genuine) continue;
    const before = fire.intensity;
    if (!isExtinguishing(state, fire)) fire.intensity = Math.min(100, fire.intensity + state.spec.params.fireGrowth);
    if (fire.smokeSpreadAt === null && fire.intensity >= K.smokeSpreadThreshold) {
      fire.smokeSpreadAt = state.time;
      const targets = smokeTargets(state.spec, fire.zoneId);
      state.zones[fire.zoneId].smoke = true;
      for (const z of targets) {
        state.zones[z].smoke = true;
        state.zones[z].alarm = true;
      }
      const logId = addLog(
        state,
        'alarm',
        `受信盤：${targets.map((z) => `${z}区域`).join('・')} 煙感知器 発報（第2報）`,
      );
      record(state, { type: 'smoke_spread', incidentId: fire.id, zoneIds: targets }, logId);
    }
    if (before < K.dangerThreshold && fire.intensity >= K.dangerThreshold && !fire.dangerNotified) {
      fire.dangerNotified = true;
      const logId = addLog(state, 'danger', `${fire.zoneId}区域付近まで煙が拡大。火勢が増しています`);
      record(state, { type: 'fire_danger', incidentId: fire.id, intensity: Math.round(fire.intensity) }, logId);
    }
    if (fire.intensity >= 100) {
      const logId = addLog(state, 'danger', '延焼拡大。警備員による対応の限界を超えました（状況終了）');
      failIncident(state, fire, '延焼拡大', logId);
      endScenario(state, 'failed', logId);
      return;
    }
  }
}

function isGuiding(state: SimState, zoneId: string): boolean {
  return state.guards.some(
    (g) => g.task?.type === 'evacuate' && g.task.phase === 'working' && g.task.target === zoneId,
  );
}

function stepEvacuation(state: SimState): void {
  const shaking = isShaking(state);
  for (const id of state.spec.facility.zoneOrder) {
    const zone = state.zones[id];
    if (zone.occupants <= 0) continue;
    if (zone.smoke) state.smokeExposure += zone.occupants;
    if (shaking) continue;
    let rate = 0;
    if (state.announcements.evacuate !== null) rate += K.evacuationAnnouncementRate;
    if (isGuiding(state, id)) rate += K.evacuationGuideRate;
    if (rate === 0) continue;
    zone.occupants = Math.max(0, zone.occupants - rate);
    if (zone.occupants === 0) {
      zone.evacuated = true;
      const logId = addLog(state, 'success', `${simZoneLabel(state, id)} 避難完了`);
      record(state, { type: 'zone_evacuated', zoneId: id }, logId);
      for (const g of state.guards) {
        if (g.task?.type === 'evacuate' && g.task.phase === 'working' && g.task.target === id) {
          const reportId = addLog(state, 'report', `${g.callSign}「${simZoneLabel(state, id)}の避難誘導完了」`);
          setIdle(state, g, reportId);
        }
      }
    }
  }
}

function aidGuards(state: SimState, c: CasualtyIncident): SimGuard[] {
  return state.guards.filter(
    (g) => g.task?.type === 'first_aid' && g.task.phase === 'working' && g.task.target === c.zoneId,
  );
}

function stepCasualties(state: SimState): void {
  if (
    state.calls.ambulance !== null &&
    state.ambulanceArrivedAt === null &&
    state.time >= state.calls.ambulance + K.ambulanceResponse
  ) {
    state.ambulanceArrivedAt = state.time;
    const logId = addLog(state, 'system', '救急隊 現着');
    record(state, { type: 'ambulance_arrived' }, logId);
  }
  for (const c of casualties(state)) {
    if (c.status !== 'active') continue;
    const aiding = aidGuards(state, c);
    c.vitality -= aiding.length > 0 ? K.casualtyDeclineWithAid : state.spec.params.casualtyDecline;
    if (c.vitality <= 0) {
      c.vitality = 0;
      const logId = addLog(state, 'danger', `${c.zoneId}区域の傷病者の容体が急変`);
      record(state, { type: 'casualty_deteriorated', incidentId: c.id }, logId);
      failIncident(state, c, '容体急変', logId);
      for (const g of aiding) setIdle(state, g);
      continue;
    }
    if (state.ambulanceArrivedAt === null) continue;
    const withGuard = state.guards.some(
      (g) =>
        g.location === c.zoneId && (g.task === null || (g.task.type === 'first_aid' && g.task.phase === 'working')),
    );
    const searchDone = state.time >= Math.max(state.ambulanceArrivedAt, c.startAt) + K.ambulanceSearch;
    if (withGuard || searchDone) {
      c.handedOver = true;
      const logId = addLog(
        state,
        'success',
        withGuard
          ? `${c.zoneId}区域の傷病者を救急隊へ引継ぎ`
          : `救急隊が${c.zoneId}区域の傷病者を発見し搬送（隊員の案内なし）`,
      );
      record(state, { type: 'casualty_handed_over', incidentId: c.id, withGuard }, logId);
      resolveIncident(state, c, logId);
      for (const g of aiding) setIdle(state, g);
    }
  }
}

function stepFireDepartment(state: SimState): void {
  if (state.calls.fire === null) return;
  if (state.fireDeptArrivedAt === null && state.time >= state.calls.fire + K.fireDeptResponse) {
    state.fireDeptArrivedAt = state.time;
    const logId = addLog(state, 'system', '消防隊 現着。状況確認を開始');
    record(state, { type: 'fire_dept_arrived' }, logId);
    for (const f of fires(state)) {
      if (f.status === 'active' && !f.genuine && !f.confirmed) confirmFalseAlarm(state, f, 'fire_department');
    }
  }
  if (state.fireDeptArrivedAt === null) return;
  for (const f of fires(state)) {
    if (f.status !== 'active') continue;
    if (!f.genuine) {
      if (!f.confirmed) confirmFalseAlarm(state, f, 'fire_department');
      continue;
    }
    if (state.time >= Math.max(state.fireDeptArrivedAt, f.startAt) + K.fireDeptExtinguish) {
      f.intensity = 0;
      f.extinguishedBy = 'fire_department';
      const logId = addLog(state, 'success', '消防隊により鎮火');
      record(state, { type: 'fire_dept_extinguished', incidentId: f.id }, logId);
      resolveIncident(state, f, logId);
    }
  }
}

function stepEarthquakes(state: SimState): void {
  for (const q of quakes(state)) {
    if (q.status !== 'active') continue;
    if (state.time === q.shakingUntil) {
      const logId = addLog(state, 'alarm', '揺れが収まりました。全区域の安全確認が必要です');
      record(state, { type: 'shaking_ended', incidentId: q.id }, logId);
    }
    if (state.time >= q.shakingUntil && state.spec.facility.zoneOrder.every((z) => state.zones[z].inspected)) {
      const logId = addLog(state, 'success', '全区域の安全確認が完了');
      resolveIncident(state, q, logId);
    }
  }
}

function endScenario(state: SimState, outcome: 'resolved' | 'failed' | 'timeout', logId: number): void {
  state.outcome = outcome;
  state.running = false;
  record(
    state,
    {
      type: 'scenario_ended',
      outcome,
      smokeExposure: state.smokeExposure,
      zones: state.spec.facility.zoneOrder.map((id) => ({
        id,
        occupants: state.zones[id].occupants,
        capacity: state.spec.facility.zones[id].capacity,
        smoke: state.zones[id].smoke,
      })),
      incidents: state.incidents.map((i) => ({
        id: i.id,
        kind: i.kind,
        status: i.status,
        genuine: i.kind !== 'fire' || i.genuine,
      })),
    },
    logId,
  );
}

function checkEnd(state: SimState): void {
  if (state.outcome) return;
  const allStarted = state.incidents.every((i) => i.status !== 'pending');
  const anyActive = state.incidents.some((i) => i.status === 'active');
  if (allStarted && !anyActive) {
    const ok = state.incidents.every((i) => i.status === 'resolved');
    const logId = addLog(
      state,
      'system',
      ok ? '状況終了：すべての事案が収束しました' : '状況終了：収束しなかった事案があります',
    );
    endScenario(state, ok ? 'resolved' : 'failed', logId);
  } else if (state.time >= state.spec.timeLimit) {
    const logId = addLog(state, 'system', '状況終了：訓練時間の上限に達しました');
    endScenario(state, 'timeout', logId);
  }
}

/** 1秒進める（状態を直接更新する） */
export function stepSim(state: SimState): void {
  state.time += 1;
  activateDue(state);
  stepGuards(state);
  stepFires(state);
  if (state.outcome) return;
  stepEvacuation(state);
  stepCasualties(state);
  stepFireDepartment(state);
  stepEarthquakes(state);
  checkEnd(state);
}

// ---------------------------------------------------------------------------
// 操作

function assign(state: SimState, guardId: string, action: SimActionType, target?: string): boolean {
  const g = state.guards.find((x) => x.id === guardId);
  if (!g || state.outcome || !state.started) return false;
  if (SIM_ACTIONS_WITH_TARGET.includes(action) && (!target || !state.spec.facility.zones[target])) return false;
  const replaced = g.task?.type ?? null;
  const duringShaking = isShaking(state);
  if (action === 'standby') {
    g.task = null;
    const logId = addLog(state, 'command', `指令→${g.callSign}：その場で待機`);
    record(state, { type: 'command', guardId, action, target: null, travelSeconds: 0, replaced, duringShaking }, logId);
    setIdle(state, g, logId);
    return true;
  }
  const dest = action === 'return' ? HQ : target!;
  const travel = simTravelSeconds(state, g.location, dest);
  g.task = { type: action, target: dest, phase: 'moving', remaining: travel };
  const logId = addLog(
    state,
    'command',
    `指令→${g.callSign}：${simLocationName(state, dest)}へ${SIM_ACTION_LABELS[action]}（移動 約${travel}秒）${duringShaking ? '※揺れの最中' : ''}`,
  );
  record(
    state,
    { type: 'command', guardId, action, target: dest, travelSeconds: travel, replaced, duringShaking },
    logId,
  );
  if (travel === 0 && !duringShaking) {
    g.location = dest;
    beginWork(state, g);
  }
  return true;
}

/** 操作を適用する（状態を直接更新し、変化があれば true） */
export function applySimAction(state: SimState, action: SimAction): boolean {
  switch (action.type) {
    case 'START': {
      if (state.started) return false;
      state.started = true;
      state.running = true;
      const logId = addLog(state, 'system', `状況開始：${state.scenarioTitle}`);
      record(
        state,
        {
          type: 'scenario_started',
          scenarioId: state.spec.scenarioId,
          difficulty: state.spec.difficulty,
          seed: state.spec.seed,
        },
        logId,
      );
      if (!state.spec.params.revealIncidents) addLog(state, 'system', '通常勤務中。各隊員は巡回・待機しています');
      activateDue(state);
      return true;
    }
    case 'PAUSE':
      if (!state.running) return false;
      state.running = false;
      return true;
    case 'RESUME':
      if (!state.started || state.outcome || state.running) return false;
      state.running = true;
      return true;
    case 'SET_SPEED':
      state.speed = action.speed;
      return true;
    case 'TICK': {
      if (!state.started || !state.running || state.outcome) return false;
      const seconds = action.seconds ?? 1;
      for (let i = 0; i < seconds && !state.outcome; i++) stepSim(state);
      return true;
    }
    case 'ASSIGN':
      return assign(state, action.guardId, action.action, action.target);
    case 'CALL_119': {
      if (!state.started || state.outcome || state.calls[action.service] !== null) return false;
      state.calls[action.service] = state.time;
      const logId = addLog(
        state,
        'command',
        action.service === 'fire'
          ? '指令：119番通報（火災）を実施（消防隊到着予定 約5分）'
          : '指令：119番通報（救急）を実施（救急隊到着予定 約4分）',
      );
      record(state, { type: 'call_119', service: action.service }, logId);
      return true;
    }
    case 'ANNOUNCE': {
      if (!state.started || state.outcome || state.announcements[action.mode] !== null) return false;
      state.announcements[action.mode] = state.time;
      const logId = addLog(
        state,
        'command',
        action.mode === 'evacuate'
          ? '指令：非常放送により全館避難を指示'
          : '指令：館内放送「その場で身の安全を確保してください」',
      );
      record(state, { type: 'announcement', mode: action.mode }, logId);
      return true;
    }
    case 'RESET':
      return false;
  }
}

function cloneState(state: SimState): SimState {
  const { spec, ...rest } = state;
  return { ...structuredClone(rest), spec };
}

/** React 用の reducer。シナリオ定義は共有し、それ以外を複製して更新する */
export function simReducer(state: SimState, action: SimAction): SimState {
  if (action.type === 'RESET') return createSimState(state.spec);
  if (action.type === 'SET_SPEED') return { ...state, speed: action.speed };
  if (action.type === 'PAUSE' || action.type === 'RESUME') {
    const next = { ...state };
    return applySimAction(next, action) ? next : state;
  }
  const next = cloneState(state);
  return applySimAction(next, action) ? next : state;
}
