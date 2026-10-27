/**
 * ランダム生成シナリオの評価。シナリオ定義（難易度・シードから再生成できる）とイベント履歴だけを入力とする純粋関数で、
 * 同じシード・難易度・評価ルールからは常に同じ結果を返す。
 */
import { SIM_ACTION_LABELS } from '../../sim/engine';
import type { ScenarioSpec, SimEventV2 } from '../../sim/types';
import { RANK_CAP_ON_VIOLATION, rankForScore } from '../evaluate';
import { CATEGORIES } from '../rules';
import type { CategoryResult, GeneratedEvaluationResult, Rank, RuleResult, TimelineItem } from '../types';
import { buildGenContext, incidentForCommand, type GenCtx } from './context';
import {
  GENERATED_MIN_ASSESSED_POINTS,
  GENERATED_RULES,
  GENERATED_RULES_VERSION,
  findGeneratedViolations,
} from './rules';

const RANK_ORDER: Rank[] = ['S', 'A', 'B', 'C', 'D'];

/** 重大な安全違反に対応するルール（改善提案の優先度を上げる） */
const VIOLATION_RULE: Record<string, string> = { V1: 'S2', V2: 'S1', V3: 'F2', V4: 'S3', V5: 'F1' };

const KIND_LABELS = { fire: '火災', earthquake: '地震', casualty: '傷病者' } as const;

function timelineText(ctx: GenCtx, e: SimEventV2): TimelineItem | null {
  const g = (id: string) => ctx.guardNames[id] ?? id;
  const z = (id: string) => `${id}区域`;
  const base = { eventId: e.id, time: e.time };
  switch (e.type) {
    case 'scenario_started':
      return { ...base, kind: 'system', text: '状況開始' };
    case 'incident_started':
      return {
        ...base,
        kind: 'system',
        text: `［実際の状況］${KIND_LABELS[e.kind]}${e.zoneId ? `：${z(e.zoneId)}` : ''}${e.genuine ? '' : '（誤報）'}`,
      };
    case 'incident_reported':
      return {
        ...base,
        kind: 'alarm',
        text:
          e.source === 'detector'
            ? `${z(e.reportedZoneId!)} 発報`
            : e.source === 'phone'
              ? `内線：${z(e.reportedZoneId!)}で傷病者との通報`
              : '地震発生',
      };
    case 'command': {
      const dest = e.target === null ? 'その場' : e.target === 'HQ' ? '防災センター' : z(e.target);
      return {
        ...base,
        kind: 'command',
        text: `${g(e.guardId)} → ${dest}：${SIM_ACTION_LABELS[e.action]}${e.duringShaking ? '（揺れの最中）' : ''}`,
      };
    }
    case 'call_119':
      return { ...base, kind: 'command', text: `119番通報（${e.service === 'fire' ? '火災' : '救急'}）` };
    case 'announcement':
      return {
        ...base,
        kind: 'command',
        text: e.mode === 'evacuate' ? '非常放送（全館避難）' : '館内放送（安全確保）',
      };
    case 'guard_arrived':
      return e.location === 'HQ' ? null : { ...base, kind: 'report', text: `${g(e.guardId)} ${z(e.location)}に到着` };
    case 'fire_confirmed':
      return { ...base, kind: 'danger', text: `${g(e.guardId)}が${z(e.zoneId)}の火災を確認（火勢${e.intensity}%）` };
    case 'false_alarm_confirmed':
      return {
        ...base,
        kind: 'report',
        text: `${z(e.zoneId)}：誤報と確認（${e.by === 'fire_department' ? '消防隊' : g(e.by)}）`,
      };
    case 'smoke_spread':
      return { ...base, kind: 'alarm', text: `第2報：${e.zoneIds.map(z).join('・')}に煙` };
    case 'smoke_confirmed':
      return { ...base, kind: 'danger', text: `${g(e.guardId)}が${z(e.zoneId)}の煙を確認` };
    case 'zone_clear':
      return { ...base, kind: 'report', text: `${g(e.guardId)}：${z(e.zoneId)} 異常なし` };
    case 'extinguish_succeeded':
      return { ...base, kind: 'success', text: `${g(e.guardId)}が初期消火に成功` };
    case 'extinguish_failed':
      return { ...base, kind: 'danger', text: `${g(e.guardId)}：初期消火不能（火勢${e.intensity}%）` };
    case 'fire_danger':
      return { ...base, kind: 'danger', text: `火勢拡大（火勢${e.intensity}%）` };
    case 'shaking_started':
      return null;
    case 'shaking_ended':
      return { ...base, kind: 'alarm', text: '揺れが収束' };
    case 'zone_inspected':
      return {
        ...base,
        kind: e.damage === 'debris' ? 'danger' : 'report',
        text: `${g(e.guardId)}：${z(e.zoneId)} 安全確認（${e.damage === 'debris' ? '被害あり' : '被害なし'}）`,
      };
    case 'casualty_confirmed':
      return { ...base, kind: 'danger', text: `${g(e.guardId)}が${z(e.zoneId)}で傷病者を確認（容体${e.vitality}%）` };
    case 'misreport_found':
      return {
        ...base,
        kind: 'report',
        text: `${g(e.guardId)}：通報区域の取り違えが判明（実際は${z(e.actualZoneId)}）`,
      };
    case 'first_aid_started':
      return { ...base, kind: 'report', text: `${g(e.guardId)}が救護を開始` };
    case 'casualty_deteriorated':
      return { ...base, kind: 'danger', text: '傷病者の容体が急変' };
    case 'ambulance_arrived':
      return { ...base, kind: 'system', text: '救急隊 現着' };
    case 'casualty_handed_over':
      return { ...base, kind: 'success', text: `傷病者を救急隊へ引継ぎ${e.withGuard ? '' : '（隊員の案内なし）'}` };
    case 'zone_evacuated':
      return { ...base, kind: 'success', text: `${z(e.zoneId)} 避難完了` };
    case 'fire_dept_arrived':
      return { ...base, kind: 'system', text: '消防隊 現着' };
    case 'fire_dept_extinguished':
      return { ...base, kind: 'success', text: '消防隊により鎮火' };
    case 'incident_resolved':
      return { ...base, kind: 'success', text: `${KIND_LABELS[e.kind]}（${e.incidentId}）収束` };
    case 'incident_failed':
      return { ...base, kind: 'danger', text: `${KIND_LABELS[e.kind]}（${e.incidentId}）：${e.reason}` };
    case 'scenario_ended':
      return {
        ...base,
        kind: 'system',
        text: `状況終了：${e.outcome === 'resolved' ? '全事案収束' : e.outcome === 'timeout' ? '時間切れ' : '未収束の事案あり'}`,
      };
    case 'guard_idle':
      return null;
  }
}

function indicators(
  ctx: GenCtx,
  categories: CategoryResult[],
  violations: number,
): GeneratedEvaluationResult['indicators'] {
  const commands = ctx.commands.filter((c) => c.action !== 'standby');
  const effective = commands.filter(
    (c) => c.action === 'return' || c.action === 'evacuate' || incidentForCommand(ctx, c) !== null,
  );
  const safety = categories.find((c) => c.id === 'safety')!;
  return {
    efficiency: {
      value: commands.length ? Math.round((100 * effective.length) / commands.length) : null,
      detail: commands.length
        ? `指示 ${commands.length}件のうち、事案・避難・帰隊に結びついた指示 ${effective.length}件`
        : '指示がない',
    },
    safety: {
      value: safety.assessedMax
        ? Math.max(0, Math.round((100 * safety.earned) / safety.assessedMax) - 20 * violations)
        : null,
      detail: `安全管理の得点率から、重大な安全違反1件につき20を差し引いた値（違反 ${violations}件）`,
    },
  };
}

export function evaluateGeneratedRun(spec: ScenarioSpec, events: SimEventV2[]): GeneratedEvaluationResult {
  const ctx = buildGenContext(spec, events);
  const rules: RuleResult[] = GENERATED_RULES.map((r) => ({
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
  const totalScore = assessedMax > 0 ? Math.round((100 * earned) / assessedMax) : 0;
  const violations = findGeneratedViolations(ctx);

  let rank: Rank | null = rankForScore(totalScore);
  let rankCapped = false;
  let rankNote: string | null = null;
  if (!ctx.complete) {
    rank = null;
    rankNote = '状況開始または終了の記録がないため、ランクは判定保留です';
  } else if (assessedMax < GENERATED_MIN_ASSESSED_POINTS) {
    rank = null;
    rankNote = `判定できた配点が${assessedMax}点（${GENERATED_MIN_ASSESSED_POINTS}点未満）のため、ランクは判定保留です`;
  } else if (violations.length > 0 && RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(RANK_CAP_ON_VIOLATION)) {
    rank = RANK_CAP_ON_VIOLATION;
    rankCapped = true;
    rankNote = `重大な安全違反があるため、ランクの上限を${RANK_CAP_ON_VIOLATION}としました`;
  }

  // 改善提案の優先順位：重大な安全違反に関わる項目 → 安全管理 → 失点の大きい順
  const violated = new Set(violations.map((v) => VIOLATION_RULE[v.violationId]));
  const order = (r: RuleResult) => GENERATED_RULES.findIndex((x) => x.id === r.ruleId);
  const improvements = rules
    .filter((r) => r.status === 'partial' || r.status === 'fail')
    .sort(
      (a, b) =>
        Number(violated.has(b.ruleId)) - Number(violated.has(a.ruleId)) ||
        Number(b.category === 'safety') - Number(a.category === 'safety') ||
        b.maxPoints - b.points - (a.maxPoints - a.points) ||
        order(a) - order(b),
    );
  const nextGoals: string[] = [];
  for (const r of improvements) {
    if (nextGoals.length >= 3) break;
    if (!nextGoals.includes(r.goal)) nextGoals.push(r.goal);
  }
  if (nextGoals.length === 0) nextGoals.push('同水準の対応を維持し、より上の難易度に挑戦する');

  const endIncidents = ctx.ended?.incidents;
  return {
    mode: 'generated',
    scenarioId: spec.scenarioId,
    rulesVersion: GENERATED_RULES_VERSION,
    difficulty: spec.difficulty,
    seed: spec.seed,
    facilityName: spec.facility.name,
    facilitySize: {
      floors: spec.facility.floors.length,
      zones: spec.facility.zoneOrder.length,
      guards: spec.guards.length,
    },
    evaluationMode: spec.difficulty === 'expert' ? 'hybrid' : 'adaptive',
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
    outcome: ctx.ended?.outcome ?? 'unknown',
    complete: ctx.complete,
    incidents: spec.incidents.map((p) => {
      const end = endIncidents?.find((i) => i.id === p.id);
      const zone = p.kind === 'earthquake' ? null : p.zoneId;
      const genuine = p.kind !== 'fire' || p.genuine;
      return {
        id: p.id,
        kind: p.kind,
        status: end?.status ?? 'unknown',
        genuine,
        label: `${KIND_LABELS[p.kind]}${genuine ? '' : '（誤報）'}${zone ? `・${zone}区域` : ''}${
          p.kind === 'casualty' && p.reportedZoneId !== p.zoneId ? `（通報は${p.reportedZoneId}区域）` : ''
        }`,
      };
    }),
    indicators: indicators(ctx, categories, violations.length),
    timeline: ctx.events.map((e) => timelineText(ctx, e)).filter((t): t is TimelineItem => t !== null),
    nextGoals,
  };
}
