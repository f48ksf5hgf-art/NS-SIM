import { describe, expect, it } from 'vitest';
import { createScenario, runReferencePlay } from './bot';
import { DIFFICULTY_ORDER, SIM_CONSTANTS as K } from './difficulty';
import { createSimState, simReducer, smokeTargets } from './engine';
import { generateScenario } from './scenario';
import { HQ, type IncidentPlan, type ScenarioSpec, type SimAction, type SimState } from './types';

/** 生成した施設に、検証したい事件だけを配置したシナリオ */
function specWith(incidents: IncidentPlan[], difficulty: 'normal' | 'expert' = 'normal'): ScenarioSpec {
  const base = generateScenario(difficulty, 2024);
  return { ...base, incidents };
}

function run(spec: ScenarioSpec, ...actions: SimAction[]): SimState {
  return actions.reduce(simReducer, simReducer(createSimState(spec), { type: 'START' }));
}

const tick = (seconds: number): SimAction => ({ type: 'TICK', seconds });
const types = (s: SimState) => s.events.map((e) => e.type);

describe('ランダム生成シナリオのエンジン', () => {
  const base = generateScenario('normal', 2024);
  const zones = base.facility.zoneOrder;
  const fireZone = zones[zones.length - 1];
  const twoZoneFloor = base.facility.floors.find((f) => f.zoneIds.length >= 2)!;

  it('同じシナリオ・同じ操作からは同じイベント履歴になる', () => {
    const spec = createScenario('hard', 99);
    const actions: SimAction[] = [
      { type: 'CALL_119', service: 'fire' },
      tick(120),
      { type: 'ANNOUNCE', mode: 'evacuate' },
      tick(900),
    ];
    expect(run(spec, ...actions).events).toEqual(run(spec, ...actions).events);
  });

  describe('火災', () => {
    const spec = specWith([{ id: 'fire-1', kind: 'fire', zoneId: fireZone, startAt: 0, genuine: true }]);

    it('発報が情報イベントとして記録され、放置すると煙が隣接区域へ広がり延焼で失敗する', () => {
      const s = run(spec, tick(2000));
      const reported = s.events.find((e) => e.type === 'incident_reported');
      expect(reported).toMatchObject({ kind: 'fire', source: 'detector', reportedZoneId: fireZone });
      const spread = s.events.find((e) => e.type === 'smoke_spread');
      expect(spread).toMatchObject({ zoneIds: smokeTargets(spec, fireZone) });
      expect(s.outcome).toBe('failed');
      expect(s.incidents[0].status).toBe('failed');
    });

    it('早期の初期消火で鎮火し、状況が終了する', () => {
      const g = base.guards[0];
      const travel = base.facility.travel[g.location][fireZone]!;
      const s = run(
        spec,
        { type: 'ASSIGN', guardId: g.id, action: 'extinguish', target: fireZone },
        tick(travel + K.extinguishSeconds + 5),
      );
      expect(types(s)).toContain('fire_confirmed');
      expect(types(s)).toContain('extinguish_succeeded');
      expect(s.outcome).toBe('resolved');
    });

    it('119番（火災）で消防隊が到着し鎮火する', () => {
      const s = run(spec, { type: 'CALL_119', service: 'fire' }, tick(K.fireDeptResponse + K.fireDeptExtinguish + 5));
      expect(types(s)).toContain('fire_dept_extinguished');
      expect(s.outcome).toBe('resolved');
    });
  });

  describe('誤報（Expert の不確かな情報）', () => {
    const spec = specWith([{ id: 'fire-false', kind: 'fire', zoneId: fireZone, startAt: 0, genuine: false }]);

    it('受信盤では本物の火災と区別できず、現場確認で誤報と判明して収束する', () => {
      const reported = run(spec).events.find((e) => e.type === 'incident_reported');
      expect(reported).toMatchObject({ kind: 'fire', source: 'detector', reportedZoneId: fireZone });
      const g = base.guards[0];
      const s = run(spec, { type: 'ASSIGN', guardId: g.id, action: 'investigate', target: fireZone }, tick(400));
      expect(s.events.find((e) => e.type === 'false_alarm_confirmed')).toMatchObject({ by: g.id, zoneId: fireZone });
      expect(s.outcome).toBe('resolved');
      expect(s.zones[fireZone].alarm).toBe(false);
    });

    it('誤報でも火勢は上がらず、延焼しない', () => {
      const s = run(spec, tick(899));
      expect(types(s)).not.toContain('smoke_spread');
      expect(s.incidents[0].status).toBe('active');
    });
  });

  describe('傷病者と区域の取り違え', () => {
    const [actual, reported] = twoZoneFloor.zoneIds;
    const spec = specWith([
      { id: 'casualty-1', kind: 'casualty', zoneId: actual, reportedZoneId: reported, startAt: 0 },
    ]);

    it('通報された区域に行くと取り違えが判明し、正しい区域で救護・引継ぎができる', () => {
      const g = base.guards[0];
      let s = run(
        spec,
        { type: 'CALL_119', service: 'ambulance' },
        { type: 'ASSIGN', guardId: g.id, action: 'first_aid', target: reported },
      );
      s = simReducer(s, tick(base.facility.travel[g.location][reported]! + 1));
      const found = s.events.find((e) => e.type === 'misreport_found');
      expect(found).toMatchObject({ reportedZoneId: reported, actualZoneId: actual });
      s = [{ type: 'ASSIGN', guardId: g.id, action: 'first_aid', target: actual } as SimAction, tick(400)].reduce(
        simReducer,
        s,
      );
      expect(types(s)).toContain('casualty_confirmed');
      expect(types(s)).toContain('first_aid_started');
      expect(s.events.find((e) => e.type === 'casualty_handed_over')).toMatchObject({ withGuard: true });
      expect(s.outcome).toBe('resolved');
    });

    it('通報の情報イベントには、取り違えた区域が記録される（真の区域は別イベント）', () => {
      const s = run(spec);
      expect(s.events.find((e) => e.type === 'incident_reported')).toMatchObject({ reportedZoneId: reported });
      expect(s.events.find((e) => e.type === 'incident_started')).toMatchObject({ zoneId: actual });
    });

    it('救護も救急要請もなければ容体が悪化して失敗する', () => {
      const s = run(spec, tick(900));
      expect(types(s)).toContain('casualty_deteriorated');
      expect(s.outcome).toBe('failed');
    });

    it('救護中は容体の悪化が遅くなる', () => {
      const g = base.guards[0];
      const t = base.facility.travel[g.location][actual]!;
      const aided = run(spec, { type: 'ASSIGN', guardId: g.id, action: 'first_aid', target: actual }, tick(t + 100));
      const alone = run(spec, tick(t + 100));
      const v = (s: SimState) => (s.incidents[0].kind === 'casualty' ? s.incidents[0].vitality : 0);
      expect(v(aided)).toBeGreaterThan(v(alone));
    });
  });

  describe('地震', () => {
    const damage = Object.fromEntries(zones.map((z, i) => [z, i === 0 ? ('debris' as const) : ('none' as const)]));
    const spec = specWith([{ id: 'earthquake-1', kind: 'earthquake', startAt: 0, damage }]);

    it('揺れの間は隊員が移動せず、揺れの最中の指示は記録される', () => {
      const g = base.guards.find((x) => x.location !== HQ)!;
      const s = run(
        spec,
        { type: 'ASSIGN', guardId: g.id, action: 'investigate', target: zones[0] },
        tick(K.shakeSeconds - 1),
      );
      expect(s.events.find((e) => e.type === 'command')).toMatchObject({ duringShaking: true });
      expect(s.guards.find((x) => x.id === g.id)!.location).toBe(g.location);
      expect(types(s)).not.toContain('guard_arrived');
    });

    it('揺れが収まった後、全区域の安全確認で収束する', () => {
      let s = run(spec, tick(K.shakeSeconds + 1));
      expect(types(s)).toContain('shaking_ended');
      const actions: SimAction[] = zones.map((z, i) => ({
        type: 'ASSIGN',
        guardId: base.guards[i % base.guards.length].id,
        action: 'investigate',
        target: z,
      }));
      // 隊員数より区域が多いので、時間を進めながら順に指示する
      for (let i = 0; i < actions.length; i += base.guards.length) {
        s = [...actions.slice(i, i + base.guards.length), tick(400)].reduce(simReducer, s);
      }
      expect(s.events.filter((e) => e.type === 'zone_inspected')).toHaveLength(zones.length);
      expect(s.events.find((e) => e.type === 'zone_inspected' && e.zoneId === zones[0])).toMatchObject({
        damage: 'debris',
      });
      expect(s.outcome).toBe('resolved');
    });

    it('安全確認しなければ時間切れで終了する', () => {
      const s = run(spec, tick(2000));
      expect(s.outcome).toBe('timeout');
      expect(s.time).toBe(spec.timeLimit);
    });
  });

  it('複数の事件が同時に進行し、すべて収束するまで状況は終わらない', () => {
    const [actual, reported] = twoZoneFloor.zoneIds;
    const spec = specWith([
      { id: 'fire-1', kind: 'fire', zoneId: fireZone, startAt: 0, genuine: true },
      { id: 'casualty-2', kind: 'casualty', zoneId: actual, reportedZoneId: reported, startAt: 30 },
    ]);
    let s = run(spec, { type: 'CALL_119', service: 'fire' }, tick(K.fireDeptResponse + K.fireDeptExtinguish + 1));
    expect(s.incidents[0].status).toBe('resolved');
    expect(s.outcome).toBeNull();
    s = simReducer(s, tick(900));
    expect(s.incidents[1].status).toBe('failed');
    expect(s.outcome).toBe('failed');
  });
});

describe('クリア可能性の検証', () => {
  for (const d of DIFFICULTY_ORDER) {
    it(`${d}：生成したシナリオは基準プレイで全事案を収束できる（50シード）`, () => {
      for (let i = 0; i < 50; i++) {
        const spec = createScenario(d, i * 104729 + 3);
        const end = runReferencePlay(spec);
        expect(end.outcome).toBe('resolved');
        expect(end.incidents.every((x) => x.status === 'resolved')).toBe(true);
      }
    });
  }

  it('検証済み生成も同じシードから同じシナリオを返す', () => {
    expect(createScenario('expert', 777)).toEqual(createScenario('expert', 777));
  });
});
