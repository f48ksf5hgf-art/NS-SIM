/**
 * ランダム生成シナリオの評価コンテキスト。イベント履歴とシナリオ定義（難易度・シードから再生成可能）
 * だけから、採点に使う事実を導く。
 */
import { HQ, type IncidentKind, type ScenarioSpec, type SimEventV2 } from '../../sim/types';
import type { CategoryId, Evidence, RuleJudgement } from '../types';

export type Ev<T extends SimEventV2['type']> = Extract<SimEventV2, { type: T }>;

/** プレイヤーが知り得た事案（情報イベントから構成） */
export interface KnownIncident {
  id: string;
  kind: IncidentKind;
  report: Ev<'incident_reported'>;
  /** 情報上の区域（取り違え判明後は正しい区域） */
  zones: string[];
  /**
   * 対応とみなす区域：通報区域・判明した正しい区域・実際の発生区域。
   * 実際の区域へ向かった指示は（偶然でも）事案への対応として扱い、減点しない。
   */
  attendZones: string[];
  misreport: Ev<'misreport_found'> | null;
  resolvedAt: number | null;
}

export interface GenCtx {
  spec: ScenarioSpec;
  events: SimEventV2[];
  started: Ev<'scenario_started'> | null;
  ended: Ev<'scenario_ended'> | null;
  complete: boolean;
  observedUntil: number;
  expert: boolean;
  commands: Ev<'command'>[];
  known: KnownIncident[];
  guardNames: Record<string, string>;
}

export function buildGenContext(spec: ScenarioSpec, input: SimEventV2[]): GenCtx {
  const events = [...input].sort((a, b) => a.id - b.id);
  const first = <T extends SimEventV2['type']>(type: T) => events.find((e): e is Ev<T> => e.type === type) ?? null;
  const started = first('scenario_started');
  const ended = first('scenario_ended');
  const known: KnownIncident[] = events
    .filter((e): e is Ev<'incident_reported'> => e.type === 'incident_reported')
    .map((report) => {
      const misreport =
        events.find(
          (e): e is Ev<'misreport_found'> => e.type === 'misreport_found' && e.incidentId === report.incidentId,
        ) ?? null;
      const resolved = events.find((e) => e.type === 'incident_resolved' && e.incidentId === report.incidentId);
      const truth = events.find(
        (e): e is Ev<'incident_started'> => e.type === 'incident_started' && e.incidentId === report.incidentId,
      );
      const zones = [report.reportedZoneId, misreport?.actualZoneId].filter((z): z is string => !!z);
      return {
        id: report.incidentId,
        kind: report.kind,
        report,
        zones,
        attendZones: [...new Set([...zones, ...(truth?.zoneId ? [truth.zoneId] : [])])],
        misreport,
        resolvedAt: resolved?.time ?? null,
      };
    });
  return {
    spec,
    events,
    started,
    ended,
    complete: started !== null && ended !== null,
    observedUntil: ended?.time ?? events[events.length - 1]?.time ?? 0,
    expert: spec.difficulty === 'expert',
    commands: events.filter((e): e is Ev<'command'> => e.type === 'command'),
    known,
    guardNames: Object.fromEntries(spec.guards.map((g) => [g.id, `${g.callSign} ${g.name}`])),
  };
}

/** 時刻 t に情報上進行中の事案数（同時対応の負荷） */
export function loadAt(ctx: GenCtx, t: number): number {
  return ctx.known.filter((k) => k.report.time <= t && (k.resolvedAt === null || k.resolvedAt > t)).length;
}

/**
 * 時間基準の倍率。
 * - Easy〜Hard（適応型）：難易度の余裕 × 同時進行の事案数
 * - Expert（ハイブリッド型）：安全管理は共通の厳格な基準（倍率1）、それ以外は同時進行の事案数で調整
 */
export function allowance(ctx: GenCtx, category: CategoryId, t: number): number {
  if (ctx.expert && category === 'safety') return 1;
  const load = 1 + 0.25 * Math.max(0, loadAt(ctx, t) - 1);
  return ctx.spec.params.timeAllowance * load;
}

export function ev(e: SimEventV2, note: string): Evidence {
  return { eventId: e.id, time: e.time, note };
}

export function judged(points: number, maxPoints: number, detail: string, evidence: Evidence[]): RuleJudgement {
  const status = points >= maxPoints ? 'pass' : points > 0 ? 'partial' : 'fail';
  return { status, points, detail, evidence };
}

export function excluded(
  status: 'not_applicable' | 'undeterminable',
  detail: string,
  evidence: Evidence[] = [],
): RuleJudgement {
  return { status, points: 0, detail, evidence };
}

export type Tiers = [number, number][];

/** 段階評価：遅れ（秒）が limit×倍率 以内なら得点 */
export function tierPoints(delay: number, tiers: Tiers, factor: number): number {
  for (const [limit, points] of tiers) if (delay <= limit * factor) return points;
  return 0;
}

/**
 * 基準時刻からの遅れで採点する。行動の記録がない場合、最終段階の期限を過ぎて観察できていれば失敗、
 * 期限前に終了・記録終了していれば判定不能とする。
 */
export function timedJudge(
  ctx: GenCtx,
  maxPoints: number,
  factor: number,
  ref: { event: SimEventV2; label: string },
  action: { event: SimEventV2 | undefined; label: string },
  tiers: Tiers,
): RuleJudgement {
  const refEv = ev(ref.event, ref.label);
  if (action.event) {
    const delay = Math.max(0, action.event.time - ref.event.time);
    const points = tierPoints(delay, tiers, factor);
    const timing =
      action.event.time <= ref.event.time ? `${ref.label}の時点で実施済み` : `${ref.label}から${delay}秒後`;
    return judged(points, maxPoints, `${action.label}：${timing}`, [refEv, ev(action.event, action.label)]);
  }
  const lastLimit = Math.round(tiers[tiers.length - 1][0] * factor);
  if (ctx.observedUntil - ref.event.time > lastLimit) {
    return judged(0, maxPoints, `${action.label}の記録なし（${ref.label}から${lastLimit}秒以上経過）`, [refEv]);
  }
  return excluded(
    'undeterminable',
    `${action.label}の記録なし。判定期限前に${ctx.complete ? '状況終了' : '記録終了'}`,
    [refEv],
  );
}

/**
 * 事案ごとの判定を1つのルールに集約する（判定できた事案の得点率の平均）。
 * すべて除外なら、判定不能が1つでもあれば判定不能、そうでなければ対象外。
 */
export function aggregate(
  maxPoints: number,
  parts: { label: string; judgement: RuleJudgement; max: number }[],
  emptyDetail: string,
): RuleJudgement {
  if (parts.length === 0) return excluded('not_applicable', emptyDetail);
  const assessed = parts.filter(
    (p) => p.judgement.status !== 'not_applicable' && p.judgement.status !== 'undeterminable',
  );
  const evidence = parts.flatMap((p) => p.judgement.evidence);
  const detail = parts.map((p) => `【${p.label}】${p.judgement.detail}`).join(' ');
  if (assessed.length === 0) {
    return excluded(
      parts.some((p) => p.judgement.status === 'undeterminable') ? 'undeterminable' : 'not_applicable',
      detail,
      evidence,
    );
  }
  const ratio = assessed.reduce((n, p) => n + p.judgement.points / p.max, 0) / assessed.length;
  return judged(Math.round(maxPoints * ratio), maxPoints, detail, evidence);
}

export function incidentLabel(k: KnownIncident): string {
  const zone = k.report.reportedZoneId;
  const kind = k.kind === 'fire' ? '火災発報' : k.kind === 'casualty' ? '傷病者' : '地震';
  return zone ? `${kind}・${zone}区域` : kind;
}

/** 指示がどの事案への対応か（情報上の区域で判断）。地震後の安全確認は地震事案に対応づける */
export function incidentForCommand(ctx: GenCtx, c: Ev<'command'>): KnownIncident | null {
  if (!c.target || c.target === HQ || c.action === 'return' || c.action === 'standby') return null;
  const candidates = ctx.known.filter(
    (k) => k.report.time <= c.time && (k.resolvedAt === null || k.resolvedAt >= c.time) && k.kind !== 'earthquake',
  );
  const byZone = candidates.find((k) => k.attendZones.includes(c.target!));
  if (byZone) return byZone;
  const quake = ctx.known.find(
    (k) => k.kind === 'earthquake' && k.report.time <= c.time && (k.resolvedAt === null || k.resolvedAt >= c.time),
  );
  return quake && c.action === 'investigate' ? quake : null;
}
