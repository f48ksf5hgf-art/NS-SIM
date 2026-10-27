import { EVACUATION_RATE, SCENARIO, WORK_SECONDS, createInitialState } from './scenario';
import type {
  GameAction,
  GameState,
  Guard,
  GuardActionType,
  LocationId,
  LogCategory,
  SimEventBody,
  ZoneId,
} from './types';

export const ACTION_LABELS: Record<GuardActionType, string> = {
  investigate: '現場確認',
  extinguish: '初期消火',
  evacuate: '避難誘導',
  return: '防災センターへ帰隊',
  standby: '待機（指示解除）',
};

/** 区域の指定が必要な指示 */
export const ACTIONS_WITH_TARGET: GuardActionType[] = ['investigate', 'extinguish', 'evacuate'];

const HQ_FLOOR = 1;

export function locationName(state: GameState, loc: LocationId): string {
  if (loc === 'HQ') return '防災センター';
  const z = state.zones[loc];
  return `${z.floorLabel} ${z.name}`;
}

function floorOf(state: GameState, loc: LocationId): number {
  return loc === 'HQ' ? HQ_FLOOR : state.zones[loc].floor;
}

/** 移動時間（秒）: 同一地点 0 秒、同一階 30 秒、階をまたぐごとに +40 秒 */
export function travelSeconds(state: GameState, from: LocationId, to: LocationId): number {
  if (from === to) return 0;
  return 30 + Math.abs(floorOf(state, from) - floorOf(state, to)) * 40;
}

export function formatClock(totalSeconds: number): string {
  const s = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function addLog(state: GameState, category: LogCategory, message: string): number {
  const id = state.nextLogId++;
  state.log.push({ id, time: state.time, category, message });
  return id;
}

/** 評価用イベントを記録する（logId は同時に出力した時系列ログ） */
function record(state: GameState, body: SimEventBody, logId: number | null = null): void {
  state.events.push({ ...body, id: state.nextEventId++, time: state.time, logId });
}

/** 警備員の任務を解除し、待機状態になったことを記録する */
function setIdle(state: GameState, guard: Guard, logId: number | null = null): void {
  guard.task = null;
  record(state, { type: 'guard_idle', guardId: guard.id, location: guard.location }, logId);
}

function zoneLabel(state: GameState, id: ZoneId): string {
  const z = state.zones[id];
  return `${id}区域（${z.floorLabel} ${z.name}）`;
}

function isGuiding(state: GameState, zoneId: ZoneId): boolean {
  return state.guards.some(
    (g) => g.task?.type === 'evacuate' && g.task.phase === 'working' && g.task.target === zoneId,
  );
}

function isExtinguishing(state: GameState): boolean {
  return state.guards.some(
    (g) =>
      g.task?.type === 'extinguish' &&
      g.task.phase === 'working' &&
      g.task.target === state.fire.zoneId,
  );
}

function discoverFire(state: GameState, guard: Guard): void {
  const zone = state.zones[state.fire.zoneId];
  if (zone.confirmed) return;
  zone.confirmed = true;
  state.fire.discoveredAt = state.time;
  const logId = addLog(
    state,
    'danger',
    `${guard.callSign}「${zoneLabel(state, zone.id)}にて火災を確認。段ボール集積場所から出火、火勢${Math.round(state.fire.intensity)}%」`,
  );
  record(
    state,
    { type: 'fire_confirmed', guardId: guard.id, zoneId: zone.id, intensity: Math.round(state.fire.intensity) },
    logId,
  );
}

function workSecondsFor(type: GuardActionType): number | null {
  switch (type) {
    case 'investigate':
      return WORK_SECONDS.investigate;
    case 'extinguish':
      return WORK_SECONDS.extinguish;
    case 'evacuate':
      return null;
    default:
      return 0;
  }
}

function beginWork(state: GameState, guard: Guard): void {
  const task = guard.task;
  if (!task) return;
  const work = workSecondsFor(task.type);
  if (work === 0) {
    const logId = addLog(state, 'report', `${guard.callSign}「${locationName(state, task.target)}に到着、待機します」`);
    setIdle(state, guard, logId);
    return;
  }
  task.phase = 'working';
  task.remaining = work;
  if (task.target !== 'HQ') {
    const zone = state.zones[task.target];
    if (task.type === 'evacuate') {
      addLog(state, 'report', `${guard.callSign}「${zoneLabel(state, zone.id)}に到着、避難誘導を開始」`);
    } else if (task.type === 'extinguish') {
      if (state.fire.active && state.fire.zoneId === zone.id) {
        discoverFire(state, guard);
        addLog(state, 'report', `${guard.callSign}「消火器による初期消火を開始」`);
      } else {
        const logId = addLog(state, 'report', `${guard.callSign}「${zoneLabel(state, zone.id)}に火源なし」`);
        record(state, { type: 'zone_clear', guardId: guard.id, zoneId: zone.id }, logId);
        setIdle(state, guard, logId);
      }
    } else {
      addLog(state, 'report', `${guard.callSign}「${zoneLabel(state, zone.id)}に到着、確認中」`);
    }
  }
}

function completeWork(state: GameState, guard: Guard): void {
  const task = guard.task;
  if (!task || task.target === 'HQ') return;
  const zone = state.zones[task.target];
  if (task.type === 'investigate') {
    if (state.fire.active && state.fire.zoneId === zone.id) {
      discoverFire(state, guard);
    } else if (zone.smoke) {
      zone.confirmed = true;
      const logId = addLog(
        state,
        'danger',
        `${guard.callSign}「${zoneLabel(state, zone.id)}に煙が流入。火元は隣接区域の可能性」`,
      );
      record(state, { type: 'smoke_confirmed', guardId: guard.id, zoneId: zone.id }, logId);
    } else if (!state.fire.active && state.fire.zoneId === zone.id) {
      addLog(state, 'report', `${guard.callSign}「${zoneLabel(state, zone.id)}、鎮火を確認」`);
    } else {
      const logId = addLog(state, 'report', `${guard.callSign}「${zoneLabel(state, zone.id)}、異常なし」`);
      record(state, { type: 'zone_clear', guardId: guard.id, zoneId: zone.id }, logId);
    }
  } else if (task.type === 'extinguish') {
    if (state.fire.active && state.fire.zoneId === zone.id) {
      if (state.fire.intensity < SCENARIO.extinguishLimit) {
        state.fire.active = false;
        state.fire.intensity = 0;
        state.fire.extinguishedBy = 'guard';
        const logId = addLog(state, 'success', `${guard.callSign}「初期消火に成功。鎮火を確認」`);
        record(state, { type: 'extinguish_succeeded', guardId: guard.id }, logId);
      } else {
        const logId = addLog(state, 'danger', `${guard.callSign}「火勢が強く初期消火不能。区域外へ退避します」`);
        record(
          state,
          { type: 'extinguish_failed', guardId: guard.id, intensity: Math.round(state.fire.intensity) },
          logId,
        );
      }
    }
  }
  setIdle(state, guard);
}

function stepGuards(state: GameState): void {
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

function stepFire(state: GameState): void {
  const fire = state.fire;
  if (!fire.active) return;
  const before = fire.intensity;
  if (!isExtinguishing(state)) {
    fire.intensity = Math.min(100, fire.intensity + SCENARIO.growthPerSecond);
  }
  if (fire.smokeSpreadAt === null && fire.intensity >= SCENARIO.smokeSpreadThreshold) {
    fire.smokeSpreadAt = state.time;
    const spread = state.zones[SCENARIO.smokeSpreadZone];
    spread.smoke = true;
    spread.alarm = true;
    state.zones[fire.zoneId].smoke = true;
    const logId = addLog(state, 'alarm', `受信盤：${zoneLabel(state, spread.id)} 煙感知器 発報（第2報）`);
    record(state, { type: 'alarm', zoneId: spread.id, stage: 2 }, logId);
  }
  if (before < SCENARIO.dangerThreshold && fire.intensity >= SCENARIO.dangerThreshold) {
    const logId = addLog(state, 'danger', '防火シャッター付近まで煙が拡大。火勢が増しています');
    record(state, { type: 'fire_danger', intensity: Math.round(fire.intensity) }, logId);
  }
  if (fire.intensity >= 100) {
    state.outcome = 'failed';
    state.running = false;
    const logId = addLog(state, 'danger', '延焼拡大。警備員による対応の限界を超えました（状況終了）');
    recordEnd(state, logId);
  }
}

function stepEvacuation(state: GameState): void {
  for (const id of state.zoneOrder) {
    const zone = state.zones[id];
    if (zone.occupants <= 0) continue;
    if (zone.smoke) state.smokeExposure += zone.occupants;
    let rate = 0;
    if (state.announcedAt !== null) rate += EVACUATION_RATE.announcement;
    if (isGuiding(state, id)) rate += EVACUATION_RATE.guide;
    if (rate === 0) continue;
    zone.occupants = Math.max(0, zone.occupants - rate);
    if (zone.occupants === 0) {
      zone.evacuated = true;
      const logId = addLog(state, 'success', `${zoneLabel(state, id)} 避難完了`);
      record(state, { type: 'zone_evacuated', zoneId: id }, logId);
      for (const g of state.guards) {
        if (g.task?.type === 'evacuate' && g.task.target === id && g.task.phase === 'working') {
          const reportId = addLog(state, 'report', `${g.callSign}「${zoneLabel(state, id)}の避難誘導完了」`);
          setIdle(state, g, reportId);
        }
      }
    }
  }
}

function stepFireDepartment(state: GameState): void {
  if (state.called119At === null) return;
  const arriveAt = state.called119At + SCENARIO.fireDeptResponseSeconds;
  if (state.fireDeptArrivedAt === null && state.time >= arriveAt) {
    state.fireDeptArrivedAt = state.time;
    const logId = addLog(
      state,
      'system',
      state.fire.active ? '消防隊 現着。消火活動を開始' : '消防隊 現着。鎮火状況の確認を開始',
    );
    record(state, { type: 'fire_dept_arrived' }, logId);
  }
  if (
    state.fireDeptArrivedAt !== null &&
    state.fire.active &&
    state.time >= state.fireDeptArrivedAt + SCENARIO.fireDeptExtinguishSeconds
  ) {
    state.fire.active = false;
    state.fire.intensity = 0;
    state.fire.extinguishedBy = 'fire_department';
    const logId = addLog(state, 'success', '消防隊により鎮火');
    record(state, { type: 'fire_dept_extinguished' }, logId);
  }
}

function checkResolved(state: GameState): void {
  if (state.outcome === null && !state.fire.active) {
    state.outcome = 'resolved';
    state.running = false;
    const logId = addLog(state, 'system', '状況終了：火災は鎮火しました');
    recordEnd(state, logId);
  }
}

function recordEnd(state: GameState, logId: number): void {
  record(
    state,
    {
      type: 'scenario_ended',
      outcome: state.outcome!,
      extinguishedBy: state.fire.extinguishedBy,
      smokeExposure: state.smokeExposure,
      zones: state.zoneOrder.map((id) => {
        const z = state.zones[id];
        return { id, occupants: z.occupants, initialOccupants: z.initialOccupants, smoke: z.smoke };
      }),
    },
    logId,
  );
}

function stepOnce(state: GameState): void {
  state.time += 1;
  stepGuards(state);
  stepFire(state);
  stepEvacuation(state);
  stepFireDepartment(state);
  checkResolved(state);
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

export function assignTask(
  state: GameState,
  guardId: string,
  action: GuardActionType,
  target?: ZoneId,
): GameState {
  const guard = state.guards.find((g) => g.id === guardId);
  if (!guard || state.outcome) return state;
  if (ACTIONS_WITH_TARGET.includes(action) && !target) return state;
  const next = clone(state);
  const g = next.guards.find((x) => x.id === guardId)!;

  const replaced = g.task?.type ?? null;

  if (action === 'standby') {
    g.task = null;
    const logId = addLog(next, 'command', `指令→${g.callSign}：その場で待機`);
    record(
      next,
      { type: 'command', guardId: g.id, action, target: null, travelSeconds: 0, replaced },
      logId,
    );
    setIdle(next, g, logId);
    return next;
  }

  const dest: LocationId = action === 'return' ? 'HQ' : target!;
  const travel = travelSeconds(next, g.location, dest);
  g.task = { type: action, target: dest, phase: 'moving', remaining: travel };
  const logId = addLog(
    next,
    'command',
    `指令→${g.callSign}：${locationName(next, dest)}へ${ACTION_LABELS[action]}（移動 約${travel}秒）`,
  );
  record(next, { type: 'command', guardId: g.id, action, target: dest, travelSeconds: travel, replaced }, logId);
  if (travel === 0) beginWork(next, g);
  return next;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START': {
      if (state.started) return state;
      const next = clone(state);
      next.started = true;
      next.running = true;
      next.zones[next.fire.zoneId].alarm = true;
      const startLogId = addLog(next, 'system', `状況開始：${state.scenarioTitle}`);
      record(next, { type: 'scenario_started', scenarioId: SCENARIO.id }, startLogId);
      const alarmLogId = addLog(
        next,
        'alarm',
        `受信盤：${zoneLabel(next, next.fire.zoneId)} 自動火災報知設備 発報（第1報）`,
      );
      record(next, { type: 'alarm', zoneId: next.fire.zoneId, stage: 1 }, alarmLogId);
      return next;
    }
    case 'PAUSE':
      return state.running ? { ...state, running: false } : state;
    case 'RESUME':
      return state.started && !state.outcome && !state.running ? { ...state, running: true } : state;
    case 'SET_SPEED':
      return { ...state, speed: action.speed };
    case 'TICK': {
      if (!state.started || !state.running || state.outcome) return state;
      const next = clone(state);
      const seconds = action.seconds ?? 1;
      for (let i = 0; i < seconds && !next.outcome; i++) stepOnce(next);
      return next;
    }
    case 'ASSIGN':
      if (!state.started) return state;
      return assignTask(state, action.guardId, action.action, action.target);
    case 'CALL_119': {
      if (!state.started || state.outcome || state.called119At !== null) return state;
      const next = clone(state);
      next.called119At = next.time;
      const logId = addLog(next, 'command', '指令：119番通報を実施（消防隊到着予定 約5分）');
      record(next, { type: 'call_119' }, logId);
      return next;
    }
    case 'ANNOUNCE': {
      if (!state.started || state.outcome || state.announcedAt !== null) return state;
      const next = clone(state);
      next.announcedAt = next.time;
      const logId = addLog(next, 'command', '指令：非常放送により全館避難を指示');
      record(next, { type: 'announcement' }, logId);
      return next;
    }
    case 'RESET':
      return createInitialState();
    default:
      return state;
  }
}
