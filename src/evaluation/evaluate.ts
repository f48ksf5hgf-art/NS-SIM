import { ACTION_LABELS } from '../game/engine';
import { createInitialState } from '../game/scenario';
import type { SimEvent } from '../game/types';
import { CATEGORIES, MIN_ASSESSED_POINTS, RULES, RULES_VERSION, findViolations, type EvalContext } from './rules';
import type {
  CategoryResult,
  EvaluationInput,
  EvaluationResult,
  Rank,
  RuleResult,
  TimelineItem,
  TrainingOutcome,
} from './types';

export const RANK_THRESHOLDS: [Rank, number][] = [
  ['S', 90],
  ['A', 80],
  ['B', 70],
  ['C', 60],
  ['D', 0],
];

export function rankForScore(score: number): Rank {
  return RANK_THRESHOLDS.find(([, min]) => score >= min)?.[0] ?? 'D';
}

const RANK_ORDER: Rank[] = ['S', 'A', 'B', 'C', 'D'];

const VIOLATION_GOAL_RULE: Record<string, string> = { V1: 'S3', V2: 'S1', V3: 'F2' };

/** 重大な安全違反がある場合の上限 */
export const RANK_CAP_ON_VIOLATION: Rank = 'C';

function guardNames(): Record<string, string> {
  return Object.fromEntries(createInitialState().guards.map((g) => [g.id, `${g.callSign} ${g.name}`]));
}

export function buildContext(events: SimEvent[]): EvalContext {
  // 記録順（ID 順）に並べ、入力の並び順に結果が左右されないようにする
  const sorted = [...events].sort((a, b) => a.id - b.id);
  const find = <T extends SimEvent['type']>(type: T) =>
    sorted.find((e): e is Extract<SimEvent, { type: T }> => e.type === type) ?? null;

  const started = find('scenario_started');
  const ended = find('scenario_ended');
  const firstAlarm =
    sorted.find((e): e is Extract<SimEvent, { type: 'alarm' }> => e.type === 'alarm' && e.stage === 1) ?? null;
  const decisionPoint =
    sorted.find(
      (e) => e.type === 'fire_confirmed' || e.type === 'smoke_confirmed' || (e.type === 'alarm' && e.stage === 2),
    ) ?? null;
  const fireConfirmed = find('fire_confirmed');
  const withdrawalInfo = sorted.find((e) => e.type === 'extinguish_failed' || e.type === 'fire_danger') ?? null;

  return {
    events: sorted,
    started,
    ended,
    observedUntil: ended?.time ?? sorted[sorted.length - 1]?.time ?? 0,
    complete: started !== null && ended !== null,
    firstAlarm,
    decisionPoint,
    commands: sorted.filter((e): e is Extract<SimEvent, { type: 'command' }> => e.type === 'command'),
    fireZone: fireConfirmed?.zoneId ?? firstAlarm?.zoneId ?? null,
    withdrawalInfo,
    guardNames: guardNames(),
  };
}

function outcomeOf(ctx: EvalContext): TrainingOutcome {
  if (!ctx.ended) return 'unknown';
  if (ctx.ended.outcome === 'failed') return 'fire_spread';
  return ctx.ended.extinguishedBy === 'guard' ? 'extinguished_by_guard' : 'extinguished_by_fire_department';
}

export const OUTCOME_LABELS: Record<TrainingOutcome, string> = {
  extinguished_by_guard: '鎮火（警備員の初期消火）',
  extinguished_by_fire_department: '鎮火（消防隊）',
  fire_spread: '延焼拡大',
  unknown: '不明（終了の記録なし）',
};

function timelineText(ctx: EvalContext, e: SimEvent): TimelineItem | null {
  const g = (id: string) => ctx.guardNames[id] ?? id;
  const base = { eventId: e.id, time: e.time };
  switch (e.type) {
    case 'scenario_started':
      return { ...base, kind: 'system', text: '状況開始' };
    case 'alarm':
      return { ...base, kind: 'alarm', text: `${e.zoneId}区域 発報（第${e.stage}報）` };
    case 'command': {
      const dest = e.target === null ? 'その場' : e.target === 'HQ' ? '防災センター' : `${e.target}区域`;
      return { ...base, kind: 'command', text: `${g(e.guardId)} → ${dest}：${ACTION_LABELS[e.action]}` };
    }
    case 'call_119':
      return { ...base, kind: 'command', text: '119番通報' };
    case 'announcement':
      return { ...base, kind: 'command', text: '非常放送（全館避難）' };
    case 'fire_confirmed':
      return { ...base, kind: 'danger', text: `${g(e.guardId)}が${e.zoneId}区域の火災を確認（火勢${e.intensity}%）` };
    case 'smoke_confirmed':
      return { ...base, kind: 'danger', text: `${g(e.guardId)}が${e.zoneId}区域の煙流入を確認` };
    case 'zone_clear':
      return { ...base, kind: 'report', text: `${g(e.guardId)}：${e.zoneId}区域 異常なし` };
    case 'extinguish_succeeded':
      return { ...base, kind: 'success', text: `${g(e.guardId)}が初期消火に成功` };
    case 'extinguish_failed':
      return { ...base, kind: 'danger', text: `${g(e.guardId)}：初期消火不能（火勢${e.intensity}%）` };
    case 'fire_danger':
      return { ...base, kind: 'danger', text: `火勢拡大（火勢${e.intensity}%）` };
    case 'zone_evacuated':
      return { ...base, kind: 'success', text: `${e.zoneId}区域 避難完了` };
    case 'fire_dept_arrived':
      return { ...base, kind: 'system', text: '消防隊 現着' };
    case 'fire_dept_extinguished':
      return { ...base, kind: 'success', text: '消防隊により鎮火' };
    case 'scenario_ended':
      return { ...base, kind: 'system', text: `状況終了：${e.outcome === 'resolved' ? '鎮火' : '延焼拡大'}` };
    case 'guard_idle':
      return null;
  }
}

/**
 * イベント履歴から評価結果を算出する純粋関数。
 * 現在時刻・乱数・画面状態に依存せず、同じ履歴からは常に同じ結果を返す。
 */
export function evaluateRun(input: EvaluationInput): EvaluationResult {
  const ctx = buildContext(input.events);

  const rules: RuleResult[] = RULES.map((r) => ({
    ruleId: r.id,
    category: r.category,
    title: r.title,
    maxPoints: r.maxPoints,
    goal: r.goal,
    ...r.judge(ctx),
  }));
  const isAssessed = (r: RuleResult) => r.status !== 'not_applicable' && r.status !== 'undeterminable';

  const categories: CategoryResult[] = CATEGORIES.map((c) => {
    const inCat = rules.filter((r) => r.category === c.id && isAssessed(r));
    return {
      id: c.id,
      label: c.label,
      maxPoints: c.maxPoints,
      earned: inCat.reduce((n, r) => n + r.points, 0),
      assessedMax: inCat.reduce((n, r) => n + r.maxPoints, 0),
    };
  });

  const earned = categories.reduce((n, c) => n + c.earned, 0);
  const assessedMax = categories.reduce((n, c) => n + c.assessedMax, 0);
  // 判定できなかった配点は成功・失敗のどちらにも数えず、判定できた配点で100点満点に換算する
  const totalScore = assessedMax > 0 ? Math.round((100 * earned) / assessedMax) : 0;

  const violations = findViolations(ctx);

  let rank: Rank | null = rankForScore(totalScore);
  let rankCapped = false;
  let rankNote: string | null = null;
  if (!ctx.complete) {
    rank = null;
    rankNote = '状況開始または終了の記録がないため、ランクは判定保留です';
  } else if (assessedMax < MIN_ASSESSED_POINTS) {
    rank = null;
    rankNote = `判定できた配点が${assessedMax}点（${MIN_ASSESSED_POINTS}点未満）のため、ランクは判定保留です`;
  } else if (violations.length > 0 && RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(RANK_CAP_ON_VIOLATION)) {
    rank = RANK_CAP_ON_VIOLATION;
    rankCapped = true;
    rankNote = `重大な安全違反があるため、ランクの上限を${RANK_CAP_ON_VIOLATION}としました`;
  }

  const lost = (r: RuleResult) => r.maxPoints - r.points;
  const improvements = rules
    .filter((r) => r.status === 'partial' || r.status === 'fail')
    .sort(
      (a, b) =>
        lost(b) - lost(a) || RULES.findIndex((x) => x.id === a.ruleId) - RULES.findIndex((x) => x.id === b.ruleId),
    );

  // 重大な安全違反に対応するルールの改善目標を最優先にする
  const nextGoals: string[] = [];
  for (const v of violations) {
    const goal = RULES.find((r) => r.id === VIOLATION_GOAL_RULE[v.violationId])?.goal;
    if (goal && !nextGoals.includes(goal)) nextGoals.push(goal);
  }
  for (const r of improvements) {
    if (nextGoals.length >= 3) break;
    if (!nextGoals.includes(r.goal)) nextGoals.push(r.goal);
  }
  if (nextGoals.length === 0) nextGoals.push('同水準の対応を維持し、×2・×4の速度でも同じ判断ができるようにする');

  return {
    scenarioId: input.scenarioId,
    rulesVersion: RULES_VERSION,
    totalScore,
    rank,
    rankCapped,
    rankNote,
    assessedMax,
    categories,
    rules,
    goodDecisions: rules.filter((r) => r.status === 'pass'),
    improvements,
    undetermined: rules.filter((r) => !isAssessed(r)),
    violations,
    elapsedSeconds: ctx.observedUntil - (ctx.started?.time ?? 0),
    outcome: outcomeOf(ctx),
    complete: ctx.complete,
    timeline: ctx.events.map((e) => timelineText(ctx, e)).filter((t): t is TimelineItem => t !== null),
    nextGoals,
  };
}
