import { describe, expect, it } from 'vitest';
import { createScenario, runReferencePlay } from '../../sim/bot';
import { DIFFICULTY_ORDER, SIM_CONSTANTS as K } from '../../sim/difficulty';
import { createSimState, simReducer } from '../../sim/engine';
import { generateScenario } from '../../sim/scenario';
import {
  HQ,
  type Difficulty,
  type IncidentPlan,
  type ScenarioSpec,
  type SimAction,
  type SimState,
} from '../../sim/types';
import type { GeneratedEvaluationResult } from '../types';
import { allowance, buildGenContext } from './context';
import { evaluateGeneratedRun } from './evaluate';
import { GENERATED_RULES } from './rules';

const tick = (seconds: number): SimAction => ({ type: 'TICK', seconds });

function specWith(difficulty: Difficulty, incidents: IncidentPlan[], seed = 2024): ScenarioSpec {
  return { ...generateScenario(difficulty, seed), incidents };
}

function play(spec: ScenarioSpec, ...actions: SimAction[]): SimState {
  return actions.reduce(simReducer, simReducer(createSimState(spec), { type: 'START' }));
}

const evaluate = (spec: ScenarioSpec, s: SimState) => evaluateGeneratedRun(spec, s.events);
const rule = (r: GeneratedEvaluationResult, id: string) => r.rules.find((x) => x.ruleId === id)!;
const ids = (r: GeneratedEvaluationResult) => r.violations.map((v) => v.violationId);

describe('評価ルールの定義（generated/1.0.0）', () => {
  it('5カテゴリ合計100点の配点を維持する', () => {
    const sums = { safety: 30, initial: 25, command: 20, information: 15, resolution: 10 };
    for (const [cat, max] of Object.entries(sums)) {
      expect(GENERATED_RULES.filter((r) => r.category === cat).reduce((n, r) => n + r.maxPoints, 0)).toBe(max);
    }
  });
});

describe('適切な対応・何もしない場合', () => {
  for (const d of DIFFICULTY_ORDER) {
    it(`${d}：基準プレイは高評価で重大な安全違反なし、放置はD（10シード）`, () => {
      for (let i = 0; i < 10; i++) {
        const spec = createScenario(d, i * 31 + 5);
        const good = evaluate(spec, runReferencePlay(spec));
        expect(good.violations).toEqual([]);
        expect(good.totalScore).toBeGreaterThanOrEqual(85);
        expect(['S', 'A']).toContain(good.rank);
        const idle = evaluate(spec, play(spec, tick(2000)));
        expect(idle.rank).toBe('D');
        expect(idle.complete).toBe(true);
      }
    });
  }

  it('評価結果に難易度・施設規模・シード・評価方式・ルールバージョンが含まれる', () => {
    const spec = createScenario('expert', 11);
    const r = evaluate(spec, runReferencePlay(spec));
    expect(r).toMatchObject({
      mode: 'generated',
      difficulty: 'expert',
      seed: 11,
      evaluationMode: 'hybrid',
      rulesVersion: 'generated/1.0.0',
      facilitySize: {
        floors: spec.facility.floors.length,
        zones: spec.facility.zoneOrder.length,
        guards: spec.guards.length,
      },
    });
    expect(evaluate(createScenario('hard', 11), play(createScenario('hard', 11))).evaluationMode).toBe('adaptive');
  });
});

describe('再現性', () => {
  it('同じ難易度・シード・操作からは同じ評価になり、並び順にも依存しない', () => {
    const spec = createScenario('hard', 4242);
    const s = runReferencePlay(spec);
    const a = evaluateGeneratedRun(spec, s.events);
    const regenerated = createScenario('hard', 4242);
    expect(evaluateGeneratedRun(regenerated, [...s.events].reverse())).toEqual(a);
    expect(evaluateGeneratedRun(spec, JSON.parse(JSON.stringify(s.events)))).toEqual(a);
  });

  it('評価根拠は実在するイベントIDと時刻を参照する', () => {
    const spec = createScenario('expert', 99);
    const s = runReferencePlay(spec);
    const byId = new Map(s.events.map((e) => [e.id, e.time]));
    const r = evaluate(spec, s);
    const evidence = [...r.rules.flatMap((x) => x.evidence), ...r.violations.flatMap((v) => v.evidence)];
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) expect(byId.get(e.eventId)).toBe(e.time);
  });
});

describe('対象外・判定不能', () => {
  it('発生しなかった事案の項目は対象外とし、減点しない', () => {
    const base = generateScenario('normal', 2024);
    const zone = base.facility.zoneOrder[1];
    const spec = specWith('normal', [{ id: 'fire-1', kind: 'fire', zoneId: zone, startAt: 0, genuine: true }]);
    const g = base.guards[0];
    const r = evaluate(
      spec,
      play(
        spec,
        { type: 'ASSIGN', guardId: g.id, action: 'extinguish', target: zone },
        { type: 'CALL_119', service: 'fire' },
        tick(600),
      ),
    );
    for (const id of ['S3', 'I3', 'R2']) expect(rule(r, id).status).toBe('not_applicable');
    expect(r.improvements.map((x) => x.ruleId)).not.toContain('S3');
  });

  it('記録が途中で途切れた場合はランクを判定保留にし、未到来の期限を失敗扱いにしない', () => {
    const spec = createScenario('hard', 7);
    const s = runReferencePlay(spec);
    const cut = s.events.filter((e) => e.time <= 5);
    const r = evaluateGeneratedRun(spec, cut);
    expect(r.complete).toBe(false);
    expect(r.rank).toBeNull();
    expect(r.improvements.filter((x) => x.status === 'fail')).toEqual([]);
    expect(evaluateGeneratedRun(spec, []).rank).toBeNull();
  });
});

describe('地震：適切な待機の評価', () => {
  const base = generateScenario('normal', 2024);
  const damage = Object.fromEntries(base.facility.zoneOrder.map((z) => [z, 'none' as const]));
  const spec = specWith('normal', [{ id: 'earthquake-1', kind: 'earthquake', startAt: 0, damage }]);
  const mover = base.guards.find((g) => g.location !== HQ)!;

  it('揺れの間に隊員を動かさず安全確保の放送をすれば満点（待機を正当に評価）', () => {
    const r = evaluate(spec, play(spec, { type: 'ANNOUNCE', mode: 'shelter' }, tick(K.shakeSeconds + 5)));
    expect(rule(r, 'S3')).toMatchObject({ status: 'pass', points: 6 });
    expect(rule(r, 'S3').detail).toMatch(/適切な待機/);
    expect(ids(r)).not.toContain('V4');
  });

  it('揺れの最中に移動を指示すると重大な安全違反（V4）となり、ランク上限C', () => {
    const s = play(
      spec,
      { type: 'ANNOUNCE', mode: 'shelter' },
      { type: 'ASSIGN', guardId: mover.id, action: 'investigate', target: base.facility.zoneOrder[0] },
      tick(900),
    );
    const r = evaluate(spec, s);
    expect(ids(r)).toContain('V4');
    expect(rule(r, 'S3').points).toBe(3);
    expect(rule(r, 'S2').status).toBe('fail');
    expect(['C', 'D']).toContain(r.rank);
  });
});

describe('Expert：その時点の情報に基づく判断の合理性', () => {
  const base = generateScenario('expert', 2024);
  const zone = base.facility.zoneOrder[2];
  const g = base.guards[0];

  describe('誤報', () => {
    const spec = specWith('expert', [{ id: 'fire-false', kind: 'fire', zoneId: zone, startAt: 0, genuine: false }]);

    it('未確認の発報で放送・通報しても、後で誤報と判明したことによる減点はない', () => {
      const r = evaluate(
        spec,
        play(
          spec,
          { type: 'ANNOUNCE', mode: 'evacuate' },
          { type: 'CALL_119', service: 'fire' },
          { type: 'ASSIGN', guardId: g.id, action: 'investigate', target: zone },
          tick(900),
        ),
      );
      expect(rule(r, 'S1').status).toBe('not_applicable');
      expect(rule(r, 'F2').status).toBe('pass');
      expect(r.violations).toEqual([]);
    });

    it('隊員が現場で誤報を確認すれば未確認情報の確認を満点、消防隊任せは部分評価', () => {
      const checked = evaluate(
        spec,
        play(spec, { type: 'ASSIGN', guardId: g.id, action: 'investigate', target: zone }, tick(900)),
      );
      expect(rule(checked, 'I1')).toMatchObject({ status: 'pass', points: 6 });
      const leftToFd = evaluate(spec, play(spec, { type: 'CALL_119', service: 'fire' }, tick(900)));
      expect(rule(leftToFd, 'I1')).toMatchObject({ status: 'partial', points: 3 });
    });
  });

  describe('区域の取り違え', () => {
    const floor = base.facility.floors.find((f) => f.zoneIds.length >= 2)!;
    const [actual, reported] = floor.zoneIds;
    const spec = specWith('expert', [
      { id: 'casualty-1', kind: 'casualty', zoneId: actual, reportedZoneId: reported, startAt: 0 },
    ]);
    const toReported: SimAction = { type: 'ASSIGN', guardId: g.id, action: 'first_aid', target: reported };
    const t = base.facility.travel[g.location][reported]!;

    it('通報された区域へすぐ派遣した判断は、誤った情報でも適切と評価する', () => {
      const r = evaluate(
        spec,
        play(
          spec,
          { type: 'CALL_119', service: 'ambulance' },
          toReported,
          tick(t + 1),
          { type: 'ASSIGN', guardId: g.id, action: 'first_aid', target: actual },
          tick(900),
        ),
      );
      expect(rule(r, 'F1')).toMatchObject({ status: 'pass' });
      expect(rule(r, 'I1').status).toBe('pass');
      expect(rule(r, 'I2')).toMatchObject({ status: 'pass' });
      expect(r.violations).toEqual([]);
    });

    it('取り違えが判明した後に正しい区域へ向かわなければ、新しい情報への対応が未達', () => {
      const r = evaluate(spec, play(spec, { type: 'CALL_119', service: 'ambulance' }, toReported, tick(900)));
      expect(rule(r, 'I2').status).toBe('fail');
    });
  });

  it('安全管理は共通の厳格な基準（倍率1）、その他は同時進行の事案数に応じて調整する', () => {
    const spec = createScenario('expert', 5);
    const s = runReferencePlay(spec);
    const ctx = buildGenContext(spec, s.events);
    const busiest = Math.max(...ctx.known.map((k) => k.report.time));
    expect(allowance(ctx, 'safety', busiest)).toBe(1);
    expect(allowance(ctx, 'initial', busiest)).toBeGreaterThanOrEqual(1);
    const hard = createScenario('hard', 5);
    const hctx = buildGenContext(hard, runReferencePlay(hard).events);
    expect(allowance(hctx, 'safety', 0)).toBeGreaterThan(1);
  });
});

describe('優先順位・隊員配置・待機', () => {
  const base = generateScenario('hard', 2024);
  const floor = base.facility.floors.find((f) => f.zoneIds.length >= 2)!;
  const [cz, fz] = floor.zoneIds;
  const spec = specWith('hard', [
    { id: 'fire-1', kind: 'fire', zoneId: fz, startAt: 0, genuine: true },
    { id: 'casualty-2', kind: 'casualty', zoneId: cz, reportedZoneId: cz, startAt: 1 },
  ]);
  const [g1, g2] = base.guards;

  it('未確認の発報と傷病者が重なったら、傷病者へ先に派遣した判断を評価する', () => {
    const casualtyFirst = evaluate(
      spec,
      play(
        spec,
        tick(1),
        { type: 'ASSIGN', guardId: g1.id, action: 'first_aid', target: cz },
        { type: 'ASSIGN', guardId: g2.id, action: 'investigate', target: fz },
        tick(900),
      ),
    );
    expect(rule(casualtyFirst, 'C2')).toMatchObject({ status: 'pass' });
    const alarmFirst = evaluate(
      spec,
      play(
        spec,
        tick(1),
        { type: 'ASSIGN', guardId: g2.id, action: 'investigate', target: fz },
        { type: 'ASSIGN', guardId: g1.id, action: 'first_aid', target: cz },
        tick(900),
      ),
    );
    expect(rule(alarmFirst, 'C2').status).toBe('fail');
  });

  it('全事案に隊員が向かっている間の待機は減点しない', () => {
    const s = play(
      spec,
      tick(1),
      { type: 'ASSIGN', guardId: g1.id, action: 'first_aid', target: cz },
      { type: 'ASSIGN', guardId: g2.id, action: 'extinguish', target: fz },
      { type: 'CALL_119', service: 'fire' },
      { type: 'CALL_119', service: 'ambulance' },
      { type: 'ANNOUNCE', mode: 'evacuate' },
      tick(900),
    );
    expect(rule(evaluate(spec, s), 'C4')).toMatchObject({ status: 'pass' });
  });

  it('近い隊員を選ぶと隊員配置（F3）の評価が高い', () => {
    const near = [...base.guards].sort(
      (a, b) => base.facility.travel[a.location][cz]! - base.facility.travel[b.location][cz]!,
    );
    const nearest = near[0];
    const farthest = near[near.length - 1];
    const only = specWith('hard', [{ id: 'casualty-1', kind: 'casualty', zoneId: cz, reportedZoneId: cz, startAt: 0 }]);
    const good = evaluate(
      only,
      play(only, { type: 'ASSIGN', guardId: nearest.id, action: 'first_aid', target: cz }, tick(900)),
    );
    const bad = evaluate(
      only,
      play(only, { type: 'ASSIGN', guardId: farthest.id, action: 'first_aid', target: cz }, tick(900)),
    );
    expect(rule(good, 'F3').points).toBe(8);
    if (base.facility.travel[farthest.location][cz]! - base.facility.travel[nearest.location][cz]! > 120) {
      expect(rule(bad, 'F3').points).toBeLessThan(8);
    }
  });
});

describe('補助指標', () => {
  it('判断効率・安全性を0〜100で算出し、総合得点とは独立している', () => {
    const spec = createScenario('normal', 3);
    const r = evaluate(spec, runReferencePlay(spec));
    expect(r.indicators.efficiency.value).toBeGreaterThanOrEqual(0);
    expect(r.indicators.efficiency.value).toBeLessThanOrEqual(100);
    expect(r.indicators.safety.value).toBeGreaterThanOrEqual(0);
    const idle = evaluate(spec, play(spec, tick(2000)));
    expect(idle.indicators.efficiency.value).toBeNull();
  });
});
