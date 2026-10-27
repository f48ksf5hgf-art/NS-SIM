import { describe, expect, it } from 'vitest';
import { evaluateGeneratedRun } from '../evaluation/generated/evaluate';
import { createScenario, runReferencePlay } from './bot';
import { DIFFICULTY_ORDER, SIM_CONSTANTS as K } from './difficulty';
import { createSimState, simReducer } from './engine';
import { generateScenario } from './scenario';
import { buildBoard, deriveTasks, type Task } from './tasks';
import { HQ, type IncidentPlan, type ScenarioSpec, type SimAction, type SimEventV2, type SimState } from './types';

const tick = (seconds = 1): SimAction => ({ type: 'TICK', seconds });

function run(spec: ScenarioSpec, ...actions: SimAction[]): SimState {
  return actions.reduce(simReducer, simReducer(createSimState(spec), { type: 'START' }));
}

/** 記録された指示を同じ時刻に再生し、毎秒の状態を検査する */
function replayEachSecond(spec: ScenarioSpec, events: SimEventV2[], check: (s: SimState) => void): SimState {
  const actions = new Map<number, SimAction[]>();
  for (const e of events) {
    let a: SimAction | null = null;
    if (e.type === 'command')
      a = { type: 'ASSIGN', guardId: e.guardId, action: e.action, target: e.target ?? undefined };
    else if (e.type === 'call_119') a = { type: 'CALL_119', service: e.service };
    else if (e.type === 'announcement') a = { type: 'ANNOUNCE', mode: e.mode };
    if (a) actions.set(e.time, [...(actions.get(e.time) ?? []), a]);
  }
  let s = simReducer(createSimState(spec), { type: 'START' });
  while (!s.outcome) {
    for (const a of actions.get(s.time) ?? []) s = simReducer(s, a);
    check(s);
    s = simReducer(s, tick());
  }
  check(s);
  return s;
}

const base = generateScenario('hard', 2024);
const floor = base.facility.floors.find((f) => f.zoneIds.length >= 3) ?? base.facility.floors[0];
const [zA, zB, zC] = [floor.zoneIds[0], floor.zoneIds[1], floor.zoneIds[2] ?? floor.zoneIds[0]];
const specWith = (incidents: IncidentPlan[], difficulty: 'hard' | 'expert' = 'hard'): ScenarioSpec => ({
  ...generateScenario(difficulty, 2024),
  incidents,
});
const byId = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)!;

describe('タスクの生成と自動更新（複数事案の同時発生）', () => {
  const spec = specWith([
    { id: 'fire-1', kind: 'fire', zoneId: zA, startAt: 0, genuine: true },
    { id: 'casualty-2', kind: 'casualty', zoneId: zB, reportedZoneId: zB, startAt: 0 },
  ]);
  const g1 = base.guards[0];
  const g2 = base.guards[1];

  it('同時に発生した事案ごとにタスクができ、未着手から始まる', () => {
    const tasks = deriveTasks(run(spec));
    expect(tasks.map((t) => t.id).sort()).toEqual(['casualty-2', 'fire-1']);
    expect(tasks.every((t) => t.status === 'todo' && t.assignees.length === 0)).toBe(true);
    expect(byId(tasks, 'fire-1')).toMatchObject({ title: '火災発報（未確認）', place: `${zA}区域`, confirmed: false });
  });

  it('隊員への指示で対応中、119番で待機、報告で内容、収束で完了に更新される', () => {
    let s = run(spec, { type: 'ASSIGN', guardId: g1.id, action: 'investigate', target: zA });
    expect(byId(deriveTasks(s), 'fire-1')).toMatchObject({ status: 'active', assignees: [g1.callSign] });
    s = simReducer(s, { type: 'CALL_119', service: 'ambulance' });
    expect(byId(deriveTasks(s), 'casualty-2')).toMatchObject({ status: 'waiting', statusNote: '救急隊の到着待ち' });
    s = simReducer(s, { type: 'ASSIGN', guardId: g2.id, action: 'first_aid', target: zB });
    s = simReducer(s, tick(base.facility.travel[g2.location][zB]! + 1));
    expect(byId(deriveTasks(s), 'casualty-2')).toMatchObject({
      title: '傷病者（確認済）',
      status: 'active',
      urgency: 100,
    });
    s = simReducer(s, tick(K.ambulanceResponse));
    expect(byId(deriveTasks(s), 'casualty-2')).toMatchObject({ status: 'done', statusNote: '引継ぎ済' });
  });

  it('第2報で煙感知の区域タスクが追加される', () => {
    const s = run(
      spec,
      tick(Math.ceil((K.smokeSpreadThreshold - spec.params.fireInitial) / spec.params.fireGrowth) + 1),
    );
    const spread = s.events.find((e) => e.type === 'smoke_spread');
    expect(spread).toBeDefined();
    if (spread?.type === 'smoke_spread') {
      for (const z of spread.zoneIds)
        expect(byId(deriveTasks(s), `smoke:${z}`)).toMatchObject({ kind: 'smoke', zoneId: z });
    }
  });

  it('地震：揺れの間は待機、収束後は安全確認（未確認区域）、全区域確認で完了', () => {
    const damage = Object.fromEntries(base.facility.zoneOrder.map((z) => [z, 'none' as const]));
    const quake = specWith([{ id: 'earthquake-1', kind: 'earthquake', startAt: 0, damage }]);
    let s = run(quake);
    expect(byId(deriveTasks(s), 'earthquake-1')).toMatchObject({ status: 'waiting', zoneId: null });
    s = simReducer(s, tick(K.shakeSeconds));
    const t = byId(deriveTasks(s), 'earthquake-1');
    expect(t).toMatchObject({ status: 'todo', title: '地震後の安全確認' });
    expect(base.facility.zoneOrder).toContain(t.zoneId);
    s = simReducer(s, { type: 'ASSIGN', guardId: g1.id, action: 'investigate', target: t.zoneId! });
    expect(byId(deriveTasks(s), 'earthquake-1').status).toBe('active');
  });
});

describe('並び順・プレイヤーの優先度・手動完了', () => {
  const spec = specWith([
    { id: 'fire-1', kind: 'fire', zoneId: zA, startAt: 0, genuine: true },
    { id: 'casualty-2', kind: 'casualty', zoneId: zB, reportedZoneId: zB, startAt: 5 },
  ]);
  const s = run(spec, tick(10));
  const tasks = deriveTasks(s);

  it('推奨順は人命に関わる情報が上（傷病者通報 > 未確認の発報）', () => {
    expect(buildBoard(tasks, {}).map((t) => t.id)).toEqual(['casualty-2', 'fire-1']);
  });

  it('プレイヤーが優先度を変更でき、推奨順より優先される', () => {
    const board = buildBoard(tasks, { 'fire-1': { priority: 'high', manualDone: false } });
    expect(board.map((t) => t.id)).toEqual(['fire-1', 'casualty-2']);
    expect(buildBoard(tasks, { 'casualty-2': { priority: 'low', manualDone: false } })[0].id).toBe('fire-1');
  });

  it('手動完了は表示の整理のみで、実際の状態・シミュレーション・評価は変えない', () => {
    const before = structuredClone(s);
    const board = buildBoard(tasks, { 'casualty-2': { priority: 'normal', manualDone: true } });
    const c = board.find((t) => t.id === 'casualty-2')!;
    expect(c.manualDone).toBe(true);
    expect(c.status).toBe('todo');
    expect(board[board.length - 1].id).toBe('casualty-2');
    expect(s).toEqual(before);
    expect(deriveTasks(s)).toEqual(tasks);
    expect(s.incidents.find((i) => i.id === 'casualty-2')!.status).toBe('active');
    // 評価はイベント履歴のみから決まり、タスクボードの操作は入力に含まれない
    const end = simReducer(s, tick(2000));
    expect(evaluateGeneratedRun(spec, end.events)).toEqual(evaluateGeneratedRun(spec, structuredClone(end.events)));
  });
});

describe('情報の公平性（Expert の非公開情報を漏らさない）', () => {
  it('誤報と本物の火災は、現場確認まで同じタスクになる', () => {
    const plan = (genuine: boolean): IncidentPlan[] => [
      { id: 'fire-x', kind: 'fire', zoneId: zA, startAt: 0, genuine },
    ];
    const real = specWith(plan(true), 'expert');
    const fake = specWith(plan(false), 'expert');
    for (const t of [0, 30, 120, 199]) {
      expect(deriveTasks(run(fake, tick(t)))).toEqual(deriveTasks(run(real, tick(t))));
    }
  });

  it('取り違えた傷病者通報は、判明するまで実際の区域をタスクに出さない', () => {
    const plans = (actual: string): IncidentPlan[] => [
      { id: 'casualty-x', kind: 'casualty', zoneId: actual, reportedZoneId: zA, startAt: 0 },
    ];
    const s1 = run(specWith(plans(zB), 'expert'), tick(60));
    const s2 = run(specWith(plans(zC), 'expert'), tick(60));
    expect(deriveTasks(s1)).toEqual(deriveTasks(s2));
    expect(deriveTasks(s1)[0]).toMatchObject({ zoneId: zA, title: '傷病者通報（未確認）' });
  });

  it('発生前の事案（将来のイベント）はタスクに出ない', () => {
    const spec = specWith([{ id: 'fire-later', kind: 'fire', zoneId: zA, startAt: 120, genuine: true }], 'expert');
    expect(deriveTasks(run(spec, tick(119)))).toEqual([]);
    expect(deriveTasks(run(spec, tick(120)))).toHaveLength(1);
  });

  it('Expert の全時刻で、タスクは通報・報告で知った事案と区域だけを参照する', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = createScenario('expert', seed);
      const end = runReferencePlay(spec);
      replayEachSecond(spec, end.events, (s) => {
        const known = new Set(
          s.events.filter((e) => e.type === 'incident_reported').map((e) => (e as { incidentId: string }).incidentId),
        );
        const knownZones = new Set<string>();
        for (const e of s.events) {
          if (e.type === 'incident_reported' && e.reportedZoneId) knownZones.add(e.reportedZoneId);
          if (e.type === 'misreport_found') knownZones.add(e.actualZoneId);
          if (e.type === 'casualty_confirmed' || e.type === 'fire_confirmed') knownZones.add(e.zoneId);
          if (e.type === 'smoke_spread') e.zoneIds.forEach((z) => knownZones.add(z));
        }
        for (const t of deriveTasks(s)) {
          if (t.kind === 'smoke') {
            expect(knownZones.has(t.zoneId!)).toBe(true);
            continue;
          }
          expect(known.has(t.id)).toBe(true);
          if (t.kind !== 'earthquake' && t.zoneId) expect(knownZones.has(t.zoneId)).toBe(true);
        }
      });
    }
  });
});

describe('タスクの状態と実際のシミュレーション状態の整合性', () => {
  for (const d of DIFFICULTY_ORDER) {
    it(`${d}：毎秒、完了⇔事案の収束、対応中⇔区域へ任務中の隊員あり（5シード）`, () => {
      for (const seed of [11, 22, 33, 44, 55]) {
        const spec = createScenario(d, seed);
        const reference = runReferencePlay(spec);
        const replayed = replayEachSecond(spec, reference.events, (s) => {
          for (const t of deriveTasks(s)) {
            if (t.kind === 'smoke') continue;
            const inc = s.incidents.find((i) => i.id === t.id)!;
            expect(t.status === 'done').toBe(inc.status !== 'active');
            if (t.status === 'done') continue;
            const busy = s.guards.filter(
              (g) => g.task && g.task.type !== 'return' && g.task.type !== 'standby' && g.task.target !== HQ,
            );
            const expected =
              t.kind === 'earthquake'
                ? busy.filter((g) => !s.zones[g.task!.target].inspected)
                : busy.filter((g) => g.task!.target === t.zoneId);
            if (t.kind === 'earthquake' && s.time < (inc.kind === 'earthquake' ? inc.shakingUntil : 0)) {
              expect(t.status).toBe('waiting');
              continue;
            }
            expect(t.assignees).toEqual(expected.map((g) => g.callSign));
            expect(t.status === 'active').toBe(expected.length > 0);
          }
        });
        // 再生が基準プレイと同じ経過をたどっていること
        expect(replayed.events).toEqual(reference.events);
      }
    });
  }
});
