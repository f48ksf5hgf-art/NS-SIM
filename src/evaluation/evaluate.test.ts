import { describe, expect, it } from 'vitest';
import { gameReducer } from '../game/engine';
import { SCENARIO, createInitialState } from '../game/scenario';
import type { GameAction, GameState, SimEvent } from '../game/types';
import { evaluateRun, rankForScore } from './evaluate';
import { CATEGORIES, RULES, RULES_VERSION } from './rules';
import type { EvaluationResult } from './types';

function play(...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, gameReducer(createInitialState(), { type: 'START' }));
}

function evaluateEvents(events: SimEvent[]): EvaluationResult {
  return evaluateRun({ scenarioId: SCENARIO.id, events });
}

const rule = (r: EvaluationResult, id: string) => r.rules.find((x) => x.ruleId === id)!;
const tick = (seconds: number): GameAction => ({ type: 'TICK', seconds });
const assign = (
  guardId: string,
  action: 'investigate' | 'extinguish' | 'evacuate',
  target: 'A' | 'B' | 'C' | 'D' | 'E' | 'F',
): GameAction => ({
  type: 'ASSIGN',
  guardId,
  action,
  target,
});

/** 発報直後に初期消火・119番通報・非常放送・避難誘導を行う模範的な対応 */
const IDEAL: GameAction[] = [
  assign('g1', 'extinguish', 'D'),
  { type: 'CALL_119' },
  { type: 'ANNOUNCE' },
  assign('g2', 'evacuate', 'B'),
  assign('g3', 'evacuate', 'F'),
  tick(600),
];

describe('評価ルールの定義', () => {
  it('配点は5項目で合計100点、各ルールの配点合計が項目の配点と一致する', () => {
    expect(CATEGORIES.reduce((n, c) => n + c.maxPoints, 0)).toBe(100);
    for (const c of CATEGORIES) {
      expect(RULES.filter((r) => r.category === c.id).reduce((n, r) => n + r.maxPoints, 0)).toBe(c.maxPoints);
    }
  });

  it('ランクの境界', () => {
    expect([100, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(rankForScore)).toEqual([
      'S',
      'S',
      'A',
      'A',
      'B',
      'B',
      'C',
      'C',
      'D',
      'D',
    ]);
  });
});

describe('適切な対応をした場合', () => {
  const s = play(...IDEAL);
  const r = evaluateEvents(s.events);

  it('高得点・Sランクで、重大な安全違反はない', () => {
    expect(s.outcome).toBe('resolved');
    expect(r.totalScore).toBeGreaterThanOrEqual(90);
    expect(r.rank).toBe('S');
    expect(r.violations).toEqual([]);
    expect(r.improvements).toEqual([]);
    expect(r.outcome).toBe('extinguished_by_guard');
  });

  it('評価結果に必要な情報がそろっている', () => {
    expect(r.scenarioId).toBe(SCENARIO.id);
    expect(r.rulesVersion).toBe(RULES_VERSION);
    expect(r.elapsedSeconds).toBe(s.time);
    expect(r.categories.map((c) => c.id)).toEqual(['safety', 'initial', 'command', 'information', 'resolution']);
    expect(r.goodDecisions.length).toBeGreaterThan(0);
    expect(r.nextGoals.length).toBeGreaterThan(0);
    expect(r.complete).toBe(true);
  });

  it('評価根拠は実在するイベントIDと時刻を参照する', () => {
    const byId = new Map(s.events.map((e) => [e.id, e]));
    const evidence = r.rules.flatMap((x) => x.evidence);
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) {
      expect(byId.get(e.eventId)?.time).toBe(e.time);
    }
  });

  it('早期に状況が終わり判定できない項目は、対象外として明示し配点から除外する', () => {
    // 110秒で鎮火したため、火災判断後120秒の待機判定は対象外
    expect(rule(r, 'C3').status).toBe('not_applicable');
    expect(r.undetermined.map((x) => x.ruleId)).toContain('C3');
    expect(r.assessedMax).toBeLessThan(100);
  });
});

describe('119番通報が未実施の場合', () => {
  it('延焼拡大まで通報しなければ失敗・重大な安全違反となり、ランクはC以下', () => {
    const s = play(assign('g1', 'investigate', 'D'), { type: 'ANNOUNCE' }, assign('g2', 'evacuate', 'C'), tick(1000));
    const r = evaluateEvents(s.events);
    expect(s.outcome).toBe('failed');
    expect(rule(r, 'F2').status).toBe('fail');
    expect(r.violations.map((v) => v.violationId)).toContain('V3');
    expect(['C', 'D']).toContain(r.rank);
  });

  it('通報の判定期限前に初期消火で終了した場合は、成功にも失敗にもせず判定不能とする', () => {
    const s = play(assign('g1', 'investigate', 'D'), tick(90), assign('g1', 'extinguish', 'D'), tick(100));
    const r = evaluateEvents(s.events);
    expect(s.outcome).toBe('resolved');
    expect(rule(r, 'F2').status).toBe('undeterminable');
    expect(rule(r, 'F2').points).toBe(0);
    expect(r.undetermined.map((x) => x.ruleId)).toContain('F2');
    expect(r.improvements.map((x) => x.ruleId)).not.toContain('F2');
    expect(r.goodDecisions.map((x) => x.ruleId)).not.toContain('F2');
  });
});

describe('現場確認が遅れた場合', () => {
  it('第1報からの経過時間に応じて初動対応が減点される', () => {
    const prompt = evaluateEvents(
      play({ type: 'CALL_119' }, { type: 'ANNOUNCE' }, assign('g1', 'investigate', 'D'), tick(600)).events,
    );
    const late = evaluateEvents(
      play({ type: 'CALL_119' }, { type: 'ANNOUNCE' }, tick(150), assign('g1', 'investigate', 'D'), tick(600)).events,
    );
    expect(rule(prompt, 'F1').points).toBe(10);
    expect(rule(late, 'F1').status).toBe('partial');
    expect(rule(late, 'F1').points).toBe(2);
    expect(rule(late, 'F3').points).toBeLessThan(rule(prompt, 'F3').points);
    expect(late.totalScore).toBeLessThan(prompt.totalScore);
    expect(late.improvements.map((x) => x.ruleId)).toContain('F1');
  });
});

describe('危険な指示を出した場合', () => {
  it('初期消火不能の報告後に火災区域へ進入させるとV1となり、ランクの上限がCになる', () => {
    const s = play(
      assign('g1', 'investigate', 'D'),
      { type: 'ANNOUNCE' },
      assign('g2', 'evacuate', 'C'),
      assign('g3', 'evacuate', 'F'),
      tick(100),
      { type: 'CALL_119' },
      tick(140),
      assign('g1', 'extinguish', 'D'), // 火勢50%超で着手 → 初期消火不能
      tick(41),
      assign('g1', 'extinguish', 'D'), // 不能の報告後に再進入（危険）
      tick(600),
    );
    const r = evaluateEvents(s.events);
    const v1 = r.violations.find((v) => v.violationId === 'V1');
    expect(v1).toBeDefined();
    expect(rule(r, 'S3').status).toBe('fail');
    expect(r.totalScore).toBeGreaterThanOrEqual(70);
    expect(r.rank).toBe('C');
    expect(r.rankCapped).toBe(true);
    // 根拠に初期消火不能の報告と進入指示の両方が含まれる
    const types = v1!.evidence.map((e) => s.events.find((x) => x.id === e.eventId)!.type);
    expect(types).toEqual(['extinguish_failed', 'command']);
  });
});

describe('時間経過のみで終了した場合', () => {
  it('0点・Dランクで、避難と通報の重大な遅れが記録される', () => {
    const s = play(tick(2000));
    const r = evaluateEvents(s.events);
    expect(r.outcome).toBe('fire_spread');
    expect(r.totalScore).toBe(0);
    expect(r.rank).toBe('D');
    expect(r.violations.map((v) => v.violationId).sort()).toEqual(['V2', 'V3']);
    // 指示がないことを「隊員を危険にさらさなかった」として加点しない
    expect(rule(r, 'S3').status).toBe('not_applicable');
    expect(rule(r, 'C2').status).toBe('not_applicable');
  });
});

describe('操作履歴が不足している場合', () => {
  const full = play(...IDEAL).events;

  it('終了の記録がなければランクを判定保留にし、終了時の項目を判定不能とする', () => {
    const r = evaluateEvents(full.filter((e) => e.type !== 'scenario_ended'));
    expect(r.complete).toBe(false);
    expect(r.rank).toBeNull();
    expect(r.rankNote).toMatch(/判定保留/);
    expect(r.outcome).toBe('unknown');
    for (const id of ['S2', 'R1', 'R2']) expect(rule(r, id).status).toBe('undeterminable');
  });

  it('途中までの記録では、期限前の未実施を失敗扱いにしない', () => {
    const r = evaluateEvents(full.slice(0, 3));
    expect(r.rank).toBeNull();
    expect(r.improvements).toEqual([]);
    expect(r.undetermined.length).toBeGreaterThan(0);
  });

  it('記録が空でも例外にならず判定保留となる', () => {
    const r = evaluateEvents([]);
    expect(r.rank).toBeNull();
    expect(r.totalScore).toBe(0);
    expect(r.rules.every((x) => x.status === 'undeterminable' || x.status === 'not_applicable')).toBe(true);
  });
});

describe('再プレイ・再評価', () => {
  it('リセット後に同じ操作をすると同じ評価になる', () => {
    const first = play(...IDEAL);
    const replay = [{ type: 'RESET' } as GameAction, { type: 'START' } as GameAction, ...IDEAL].reduce(
      gameReducer,
      first,
    );
    expect(gameReducer(first, { type: 'RESET' }).events).toEqual([]);
    expect(evaluateEvents(replay.events)).toEqual(evaluateEvents(first.events));
  });

  it('同じ履歴を再評価すると、並び順や保存・復元に関係なく同じ結果になる', () => {
    const events = play(...IDEAL).events;
    const a = evaluateEvents(events);
    const b = evaluateEvents([...events].reverse());
    const c = evaluateEvents(JSON.parse(JSON.stringify(events)));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('評価は入力の履歴を変更しない', () => {
    const events = play(...IDEAL).events;
    const snapshot = structuredClone(events);
    evaluateEvents(events);
    expect(events).toEqual(snapshot);
  });
});
