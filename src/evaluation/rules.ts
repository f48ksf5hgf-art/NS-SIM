/**
 * シナリオ01「商業施設 自動火災報知設備 発報」の採点ルール。
 *
 * これは NS-SIM の訓練用に定めた架空の評価基準であり、消防法令・実在施設の消防計画・
 * 警備業務の運用基準を示すものではない。秒数の基準はゲーム内の時間進行に合わせて設定している。
 *
 * 各ルールは記録されたイベント（EvalContext）だけを参照する純粋関数で、
 * 同じイベント履歴からは常に同じ判定を返す。
 */
import { formatElapsed } from '../game/engine';
import type { GuardActionType, SimEvent, ZoneId } from '../game/types';
import type { CallAssessment, CategoryId, Evidence, RuleJudgement, SafetyViolation } from './types';

export const RULES_VERSION = 'scenario-01/1.1.0';

export const CATEGORIES: { id: CategoryId; label: string; maxPoints: number }[] = [
  { id: 'safety', label: '安全管理', maxPoints: 30 },
  { id: 'initial', label: '初動対応', maxPoints: 25 },
  { id: 'command', label: '指揮統制', maxPoints: 20 },
  { id: 'information', label: '情報管理', maxPoints: 15 },
  { id: 'resolution', label: '事態収束', maxPoints: 10 },
];

/** 判定できた配点がこれ未満の場合、ランクは判定保留とする */
export const MIN_ASSESSED_POINTS = 60;

/** 火災判断からこの秒数を超えて通報・避難措置がない場合は重大な安全違反 */
export const CRITICAL_DELAY_SECONDS = 180;

/**
 * 119番通報の時間基準（NS-SIM 独自の訓練基準）：火災確認からの遅れ [秒, 得点]。
 * 最終段階を超えた通報も「遅延」として1点を与え、未実施（0点）と区別する。
 */
export const CALL_TIERS: [number, number][] = [
  [60, 10],
  [120, 6],
  [240, 3],
];
export const CALL_LATE_POINTS = 1;

/** 火災確認後、通報せずに状況終了した場合に「未実施」と判定できる最短の判断時間（秒） */
export const CALL_MIN_DECISION_SECONDS = 30;

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

/** 採点に用いる、イベント履歴から導出した事実 */
export interface EvalContext {
  events: SimEvent[];
  started: Ev<'scenario_started'> | null;
  ended: Ev<'scenario_ended'> | null;
  /** 判定に使える最終時刻（終了イベント、なければ最後に記録されたイベント） */
  observedUntil: number;
  complete: boolean;
  /** 第1報（発報区域の情報） */
  firstAlarm: Ev<'alarm'> | null;
  /**
   * 火災判断時点：火災の確認・煙の確認・第2報のうち最も早い情報。
   * 第1報（単一感知器の発報）のみでは火災と断定できないため、時間評価の起点を分ける。
   */
  decisionPoint: SimEvent | null;
  commands: Ev<'command'>[];
  /** 火災区域（現場確認で判明した区域、なければ第1報の区域） */
  fireZone: ZoneId | null;
  /** 隊員の退避が必要と分かった情報（初期消火不能・火勢拡大） */
  withdrawalInfo: SimEvent | null;
  guardNames: Record<string, string>;
}

export interface RuleDefinition {
  id: string;
  category: CategoryId;
  title: string;
  maxPoints: number;
  goal: string;
  judge: (ctx: EvalContext) => RuleJudgement;
}

// ---------------------------------------------------------------------------
// 判定ヘルパー

function ev(e: SimEvent, note: string): Evidence {
  return { eventId: e.id, time: e.time, note };
}

function judged(points: number, maxPoints: number, detail: string, evidence: Evidence[]): RuleJudgement {
  const status = points >= maxPoints ? 'pass' : points > 0 ? 'partial' : 'fail';
  return { status, points, detail, evidence };
}

function excluded(
  status: 'not_applicable' | 'undeterminable',
  detail: string,
  evidence: Evidence[] = [],
): RuleJudgement {
  return { status, points: 0, detail, evidence };
}

/** [許容遅れ秒数, 得点] を早い順に並べた段階評価 */
type Tiers = [number, number][];

function tierPoints(delay: number, tiers: Tiers): number {
  for (const [limit, points] of tiers) if (delay <= limit) return points;
  return 0;
}

/**
 * 基準時刻からの遅れで採点する。行動が記録されていない場合、最終段階の期限を過ぎて観察できていれば失敗、
 * 期限前に状況終了（または記録が途切れた）なら判定不能とする。
 */
function timed(
  ctx: EvalContext,
  maxPoints: number,
  ref: { event: SimEvent; label: string },
  action: { event: SimEvent | undefined; label: string },
  tiers: Tiers,
): RuleJudgement {
  const refEvidence = ev(ref.event, ref.label);
  if (action.event) {
    const delay = Math.max(0, action.event.time - ref.event.time);
    const points = tierPoints(delay, tiers);
    const timing = action.event.time <= ref.event.time ? `${ref.label}より前に実施` : `${ref.label}から${delay}秒後`;
    return judged(points, maxPoints, `${action.label}：${timing}`, [refEvidence, ev(action.event, action.label)]);
  }
  const deadline = ref.event.time + tiers[tiers.length - 1][0];
  if (ctx.observedUntil > deadline) {
    return judged(
      0,
      maxPoints,
      `${action.label}の記録なし（${ref.label}から${tiers[tiers.length - 1][0]}秒以上経過）`,
      [refEvidence],
    );
  }
  return excluded(
    'undeterminable',
    `${action.label}の記録なし。判定期限（${formatElapsed(deadline)}）前に${ctx.complete ? '状況終了' : '記録が途切れている'}`,
    [refEvidence],
  );
}

function decisionLabel(e: SimEvent): string {
  switch (e.type) {
    case 'fire_confirmed':
      return '火災確認の報告';
    case 'smoke_confirmed':
      return '煙流入確認の報告';
    case 'alarm':
      return `第${e.stage}報`;
    default:
      return '火災判断の情報';
  }
}

/** 火災判断時点を基準とするルールで、基準情報がない場合の扱い */
function noDecisionPoint(ctx: EvalContext): RuleJudgement {
  return ctx.complete
    ? excluded('not_applicable', '火災確認・第2報のいずれも発生しなかった')
    : excluded('undeterminable', '火災判断の基準となる情報が記録されていない');
}

function isEvacuationMeasure(e: SimEvent): boolean {
  return e.type === 'announcement' || (e.type === 'command' && e.action === 'evacuate');
}

const ENTRY_ACTIONS: GuardActionType[] = ['investigate', 'extinguish', 'evacuate'];

function guardLabel(ctx: EvalContext, id: string): string {
  return ctx.guardNames[id] ?? id;
}

// ---------------------------------------------------------------------------
// 119番通報

/**
 * 火災確認から119番通報までを評価する。初期消火の成否は通報の評価に影響させない
 * （NS-SIM の訓練基準では、初期消火と並行して通報することを求める）。
 */
export function assessEmergencyCall(ctx: EvalContext): CallAssessment {
  const maxPoints = 10;
  const confirmed = ctx.events.find((e) => e.type === 'fire_confirmed') ?? null;
  const call = ctx.events.find((e) => e.type === 'call_119') ?? null;
  const base = {
    maxPoints,
    confirmed: confirmed ? ev(confirmed, '火災確認の報告') : null,
    called: call ? ev(call, '119番通報') : null,
    ended: ctx.ended ? ev(ctx.ended, '状況終了') : null,
    extinguishedByGuard: ctx.ended?.extinguishedBy === 'guard',
    observedSeconds: confirmed ? ctx.observedUntil - confirmed.time : null,
  };
  const evidence = [base.confirmed, base.called, base.ended].filter((e): e is Evidence => e !== null);
  const make = (
    verdict: CallAssessment['verdict'],
    judgement: RuleJudgement,
    delaySeconds: number | null,
  ): CallAssessment => ({ ...base, ...judgement, verdict, delaySeconds });

  if (!confirmed) {
    if (call) {
      return make('before_confirmation', judged(maxPoints, maxPoints, '現場での火災確認より前に通報', evidence), 0);
    }
    if (!ctx.complete) {
      return make(
        'undeterminable',
        excluded('undeterminable', '記録が途切れており、火災確認・通報の有無を判定できない'),
        null,
      );
    }
    return make(
      'not_required',
      excluded('not_applicable', '火災が確認されていないため、通報の有無だけでは評価しない', evidence),
      null,
    );
  }

  if (call) {
    const delay = call.time - confirmed.time;
    if (delay <= 0) {
      return make('before_confirmation', judged(maxPoints, maxPoints, '火災確認の報告より前に通報', evidence), 0);
    }
    const points = tierPoints(delay, CALL_TIERS) || CALL_LATE_POINTS;
    const limit = CALL_TIERS[0][0];
    return make(
      delay <= limit ? 'on_time' : 'delayed',
      judged(
        points,
        maxPoints,
        delay <= limit
          ? `火災確認から${delay}秒後に通報`
          : `通報遅延：火災確認から${delay}秒後に通報（基準${limit}秒以内）`,
        evidence,
      ),
      delay,
    );
  }

  // 通報なし：終了（または記録終了）までに判断できた時間で評価する
  const observed = base.observedSeconds!;
  const enough = ctx.complete ? observed >= CALL_MIN_DECISION_SECONDS : observed > CALL_TIERS[CALL_TIERS.length - 1][0];
  if (!enough) {
    return make(
      'undeterminable',
      excluded(
        'undeterminable',
        `火災確認から${ctx.complete ? '状況終了' : '記録終了'}まで${observed}秒で、通報の判断時間が不足`,
        evidence,
      ),
      null,
    );
  }
  const suffix = base.extinguishedByGuard ? '（初期消火に成功しても通報は必要）' : '';
  return make(
    'not_called',
    judged(
      0,
      maxPoints,
      `通報未実施：火災確認から${ctx.complete ? '状況終了' : '記録終了'}まで${observed}秒、通報なし${suffix}`,
      evidence,
    ),
    null,
  );
}

// ---------------------------------------------------------------------------
// 重大な安全違反

export function findViolations(ctx: EvalContext): SafetyViolation[] {
  const violations: SafetyViolation[] = [];

  // V1: 退避が必要と分かった後に、火災区域へ隊員を進入させる指示
  if (ctx.withdrawalInfo && ctx.fireZone) {
    const info = ctx.withdrawalInfo;
    for (const c of ctx.commands) {
      if (c.id > info.id && c.target === ctx.fireZone && ENTRY_ACTIONS.includes(c.action)) {
        violations.push({
          violationId: 'V1',
          title: '退避判断後の火災区域への進入指示',
          detail: `${info.type === 'extinguish_failed' ? '初期消火不能' : '火勢拡大'}の情報を受けた後、${guardLabel(ctx, c.guardId)}を火災区域（${ctx.fireZone}区域）へ進入させた`,
          evidence: [
            ev(info, info.type === 'extinguish_failed' ? '初期消火不能の報告' : '火勢拡大の情報'),
            ev(c, '進入指示'),
          ],
        });
      }
    }
  }

  const dp = ctx.decisionPoint;
  if (dp) {
    const limit = dp.time + CRITICAL_DELAY_SECONDS;
    const observed = ctx.observedUntil > limit;
    // V2: 火災判断後、長時間にわたり避難措置なし
    const evac = ctx.events.find(isEvacuationMeasure);
    if (observed && (!evac || evac.time > limit)) {
      violations.push({
        violationId: 'V2',
        title: '避難措置の重大な遅れ',
        detail: `${decisionLabel(dp)}から${CRITICAL_DELAY_SECONDS}秒以上、非常放送・避難誘導のいずれも行われなかった`,
        evidence: [ev(dp, decisionLabel(dp)), ...(evac ? [ev(evac, '最初の避難措置')] : [])],
      });
    }
    // V3: 火災判断後、長時間にわたり119番通報なし
    const call = ctx.events.find((e) => e.type === 'call_119');
    if (observed && (!call || call.time > limit)) {
      violations.push({
        violationId: 'V3',
        title: '119番通報の重大な遅れ',
        detail: `${decisionLabel(dp)}から${CRITICAL_DELAY_SECONDS}秒以上、119番通報が行われなかった`,
        evidence: [ev(dp, decisionLabel(dp)), ...(call ? [ev(call, '119番通報')] : [])],
      });
    }
  }

  // V3: 火災を確認したまま通報せずに状況終了（早期の初期消火で上記の期限前に終わった場合も含む）
  if (!violations.some((v) => v.violationId === 'V3')) {
    const assessment = assessEmergencyCall(ctx);
    if (assessment.verdict === 'not_called' && ctx.complete) {
      violations.push({
        violationId: 'V3',
        title: '火災確認後の119番通報の未実施',
        detail: `火災確認から状況終了まで${assessment.observedSeconds}秒、119番通報が行われなかった${
          assessment.extinguishedByGuard ? '（初期消火の成功で通報が不要になるわけではない）' : ''
        }`,
        evidence: assessment.evidence,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 採点ルール

export const RULES: RuleDefinition[] = [
  // ---- 安全管理 30 ----
  {
    id: 'S1',
    category: 'safety',
    title: '在館者の避難開始',
    maxPoints: 10,
    goal: '火災の確認・第2報を受けたら60秒以内に非常放送または避難誘導を開始する',
    judge: (ctx) => {
      if (!ctx.decisionPoint) return noDecisionPoint(ctx);
      return timed(
        ctx,
        10,
        { event: ctx.decisionPoint, label: decisionLabel(ctx.decisionPoint) },
        { event: ctx.events.find(isEvacuationMeasure), label: '最初の避難措置' },
        [
          [60, 10],
          [120, 6],
          [180, 3],
        ],
      );
    },
  },
  {
    id: 'S2',
    category: 'safety',
    title: '在館者の煙曝露の抑制',
    maxPoints: 8,
    goal: '煙が流入する前に在館者の避難を完了させる',
    judge: (ctx) => {
      if (!ctx.ended) return excluded('undeterminable', '状況終了の記録がなく、煙曝露量を確認できない');
      const exposure = ctx.ended.smokeExposure;
      const points = exposure === 0 ? 8 : exposure <= 1500 ? 5 : exposure <= 5000 ? 2 : 0;
      return judged(points, 8, `煙にさらされた在館者 延べ${exposure.toLocaleString()}人・秒`, [
        ev(ctx.ended, '状況終了時の集計'),
      ]);
    },
  },
  {
    id: 'S3',
    category: 'safety',
    title: '警備員の安全確保',
    maxPoints: 12,
    goal: '初期消火不能・火勢拡大の情報を受けたら、火災区域へ隊員を進入させない',
    judge: (ctx) => {
      if (ctx.commands.length === 0) return excluded('not_applicable', '警備員への指示がない');
      const v1 = findViolations(ctx).filter((v) => v.violationId === 'V1');
      if (v1.length > 0) {
        return judged(
          0,
          12,
          `退避判断後の進入指示 ${v1.length}件`,
          v1.flatMap((v) => v.evidence),
        );
      }
      return judged(
        12,
        12,
        ctx.withdrawalInfo ? '退避が必要な情報の後、火災区域への進入指示なし' : '危険区域への不適切な進入指示なし',
        ctx.withdrawalInfo ? [ev(ctx.withdrawalInfo, '退避が必要な情報')] : [],
      );
    },
  },

  // ---- 初動対応 25 ----
  {
    id: 'F1',
    category: 'initial',
    title: '発報区域への現場確認指示',
    maxPoints: 10,
    goal: '第1報から30秒以内に発報区域へ隊員を派遣する',
    judge: (ctx) => {
      const alarm = ctx.firstAlarm;
      if (!alarm) return excluded('undeterminable', '第1報の記録がない');
      return timed(
        ctx,
        10,
        { event: alarm, label: '第1報' },
        {
          event: ctx.commands.find(
            (c) => c.target === alarm.zoneId && (c.action === 'investigate' || c.action === 'extinguish'),
          ),
          label: `${alarm.zoneId}区域への派遣指示`,
        },
        [
          [30, 10],
          [60, 7],
          [120, 4],
          [180, 2],
        ],
      );
    },
  },
  {
    id: 'F2',
    category: 'initial',
    title: '119番通報',
    maxPoints: 10,
    goal: '火災を確認したら、初期消火と並行して60秒以内に119番通報する（初期消火に成功しても通報する）',
    judge: (ctx) => {
      const { status, points, detail, evidence } = assessEmergencyCall(ctx);
      return { status, points, detail, evidence };
    },
  },
  {
    id: 'F3',
    category: 'initial',
    title: '発報区域からの第一報告',
    maxPoints: 5,
    goal: '発報区域に近い隊員を選び、第1報から2分以内に現場の状況報告を得る',
    judge: (ctx) => {
      const alarm = ctx.firstAlarm;
      if (!alarm) return excluded('undeterminable', '第1報の記録がない');
      const report = ctx.events.find(
        (e) =>
          (e.type === 'fire_confirmed' || e.type === 'smoke_confirmed' || e.type === 'zone_clear') &&
          e.zoneId === alarm.zoneId,
      );
      return timed(
        ctx,
        5,
        { event: alarm, label: '第1報' },
        { event: report, label: `${alarm.zoneId}区域からの報告` },
        [
          [120, 5],
          [180, 3],
          [300, 1],
        ],
      );
    },
  },

  // ---- 指揮統制 20 ----
  {
    id: 'C1',
    category: 'command',
    title: '隊員の役割分担',
    maxPoints: 8,
    goal: '確認・消火・避難誘導に隊員を分担させ、3名全員に任務を与える',
    judge: (ctx) => {
      const tasked = ctx.commands.filter((c) => c.action !== 'standby');
      const firstByGuard = new Map<string, Ev<'command'>>();
      for (const c of tasked) if (!firstByGuard.has(c.guardId)) firstByGuard.set(c.guardId, c);
      if (!ctx.complete && firstByGuard.size < 3) {
        return excluded(
          'undeterminable',
          `記録が途切れているため判定できない（記録上 ${firstByGuard.size}名に任務付与）`,
        );
      }
      const n = firstByGuard.size;
      const points = n >= 3 ? 8 : n === 2 ? 5 : n === 1 ? 2 : 0;
      return judged(
        points,
        8,
        `任務を与えた隊員 ${n}名`,
        [...firstByGuard.values()].map((c) => ev(c, `${guardLabel(ctx, c.guardId)}への最初の任務`)),
      );
    },
  },
  {
    id: 'C2',
    category: 'command',
    title: '指示の一貫性',
    maxPoints: 6,
    goal: '実行中の任務の上書きを減らし、指示を出す前に優先順位を決める',
    judge: (ctx) => {
      if (ctx.commands.length === 0) return excluded('not_applicable', '警備員への指示がない');
      // 帰隊（退避）・待機への切替は安全上の判断のため上書きに数えない
      const overrides = ctx.commands.filter(
        (c) => c.replaced !== null && c.action !== 'return' && c.action !== 'standby',
      );
      const n = overrides.length;
      const points = n <= 1 ? 6 : n <= 3 ? 3 : 0;
      return judged(
        points,
        6,
        `実行中の任務を別任務で上書き ${n}回`,
        overrides.map((c) => ev(c, `${guardLabel(ctx, c.guardId)}の任務上書き`)),
      );
    },
  },
  {
    id: 'C3',
    category: 'command',
    title: '待機隊員の活用',
    maxPoints: 6,
    goal: '火災判断後は隊員を2分以上待機させたままにしない',
    judge: (ctx) => {
      const dp = ctx.decisionPoint;
      if (!dp) return noDecisionPoint(ctx);
      const windowEnd = ctx.observedUntil;
      if (windowEnd - dp.time <= 120) {
        return excluded(
          ctx.complete ? 'not_applicable' : 'undeterminable',
          `${decisionLabel(dp)}から${ctx.complete ? '状況終了' : '記録終了'}までが120秒以内のため判定対象外`,
          [ev(dp, decisionLabel(dp))],
        );
      }
      // 隊員ごとの待機開始時刻（開始時は全員待機）
      const idleSince = new Map<string, number>();
      const idleEvent = new Map<string, SimEvent | null>();
      for (const id of Object.keys(ctx.guardNames)) {
        idleSince.set(id, ctx.started?.time ?? 0);
        idleEvent.set(id, ctx.started);
      }
      let longest = 0;
      let longestGuard: string | null = null;
      let longestFrom: SimEvent | null = null;
      const close = (id: string, until: number) => {
        const since = idleSince.get(id);
        if (since === undefined) return;
        const span = until - Math.max(since, dp.time);
        if (span > longest) {
          longest = span;
          longestGuard = id;
          longestFrom = idleEvent.get(id) ?? null;
        }
      };
      for (const e of ctx.events) {
        if (e.type === 'command' && e.action !== 'standby') {
          close(e.guardId, e.time);
          idleSince.delete(e.guardId);
        } else if (e.type === 'guard_idle' && !idleSince.has(e.guardId)) {
          idleSince.set(e.guardId, e.time);
          idleEvent.set(e.guardId, e);
        }
      }
      for (const id of idleSince.keys()) close(id, windowEnd);
      const points = longest <= 120 ? 6 : longest <= 240 ? 3 : 0;
      const evidence = [ev(dp, decisionLabel(dp))];
      const from = longestFrom as SimEvent | null;
      if (longestGuard && from && longest > 120) evidence.push(ev(from, `${guardLabel(ctx, longestGuard)} 待機開始`));
      return judged(
        points,
        6,
        longestGuard && longest > 0
          ? `火災判断後の最長待機：${guardLabel(ctx, longestGuard)} ${longest}秒`
          : '火災判断後、待機したままの隊員なし',
        evidence,
      );
    },
  },

  // ---- 情報管理 15 ----
  {
    id: 'I1',
    category: 'information',
    title: '状況変化への対応',
    maxPoints: 6,
    goal: '第2報・初期消火不能・火勢拡大の情報を受けたら、避難措置と119番通報が済んでいるか直ちに確認する',
    judge: (ctx) => {
      const changes = ctx.events.filter(
        (e) => (e.type === 'alarm' && e.stage === 2) || e.type === 'extinguish_failed' || e.type === 'fire_danger',
      );
      if (changes.length === 0) {
        return ctx.complete
          ? excluded('not_applicable', '第2報・初期消火不能・火勢拡大のいずれも発生しなかった')
          : excluded('undeterminable', '状況変化の記録がない');
      }
      let handled = 0;
      let assessed = 0;
      const evidence: Evidence[] = [];
      for (const c of changes) {
        const window = c.type === 'alarm' ? 90 : 60;
        const deadline = c.time + window;
        const evac = ctx.events.find((e) => isEvacuationMeasure(e) && e.time <= deadline);
        const call = ctx.events.find((e) => e.type === 'call_119' && e.time <= deadline);
        // 第2報は避難措置、隊員の危険を示す情報は避難措置と119番通報の両方を求める
        const ok = c.type === 'alarm' ? !!evac : !!evac && !!call;
        const label = c.type === 'alarm' ? '第2報' : c.type === 'extinguish_failed' ? '初期消火不能' : '火勢拡大';
        if (ok) {
          handled++;
          assessed++;
          evidence.push(ev(c, `${label}：${window}秒以内に必要な措置あり`));
        } else if (ctx.observedUntil > deadline) {
          assessed++;
          evidence.push(ev(c, `${label}：${window}秒以内に必要な措置なし`));
        } else {
          evidence.push(ev(c, `${label}：判定期限前に終了（判定不能）`));
        }
      }
      if (assessed === 0) return excluded('undeterminable', '対応の判定期限前に状況が終了した', evidence);
      return judged(
        Math.round((6 * handled) / assessed),
        6,
        `状況変化 ${assessed}件中 ${handled}件に適切に対応`,
        evidence,
      );
    },
  },
  {
    id: 'I2',
    category: 'information',
    title: '情報に基づく派遣先の選択',
    maxPoints: 5,
    goal: '発報・煙の情報がある区域を優先して確認する',
    judge: (ctx) => {
      const dispatches = ctx.commands.filter((c) => c.action === 'investigate' || c.action === 'extinguish');
      if (dispatches.length === 0) return excluded('not_applicable', '現場確認・初期消火の指示がない');
      const wrong = dispatches.filter((c) => {
        const known = new Set<string>();
        for (const e of ctx.events) {
          if (e.id >= c.id) break;
          if (e.type === 'alarm' || e.type === 'smoke_confirmed' || e.type === 'fire_confirmed') known.add(e.zoneId);
        }
        return c.target !== null && !known.has(c.target);
      });
      const points = wrong.length === 0 ? 5 : wrong.length === 1 ? 2 : 0;
      return judged(
        points,
        5,
        wrong.length === 0
          ? `派遣 ${dispatches.length}件すべて情報のある区域`
          : `発報・煙の情報がない区域への派遣 ${wrong.length}件`,
        wrong.map((c) => ev(c, `${c.target}区域への派遣（情報なし）`)),
      );
    },
  },
  {
    id: 'I3',
    category: 'information',
    title: '火災の現場確認',
    maxPoints: 4,
    goal: '感知器の発報だけで判断せず、隊員による現場確認で火災を確定させる',
    judge: (ctx) => {
      const confirmed = ctx.events.find((e) => e.type === 'fire_confirmed');
      if (confirmed) return judged(4, 4, '隊員が火災を現場確認', [ev(confirmed, '火災確認の報告')]);
      if (!ctx.complete) return excluded('undeterminable', '記録が途切れており、火災確認の有無を判定できない');
      return judged(0, 4, '状況終了まで火災の現場確認なし', ctx.ended ? [ev(ctx.ended, '状況終了')] : []);
    },
  },

  // ---- 事態収束 10 ----
  {
    id: 'R1',
    category: 'resolution',
    title: '火災の鎮圧',
    maxPoints: 6,
    goal: '初期消火が可能な段階で消火に着手するか、早期の119番通報で消防隊に引き継ぐ',
    judge: (ctx) => {
      if (!ctx.ended) return excluded('undeterminable', '状況終了の記録がない');
      const e = ctx.ended;
      if (e.outcome === 'resolved') {
        return judged(6, 6, e.extinguishedBy === 'guard' ? '警備員の初期消火により鎮火' : '消防隊により鎮火', [
          ev(e, '状況終了'),
        ]);
      }
      return judged(0, 6, '延焼拡大により状況終了', [ev(e, '状況終了')]);
    },
  },
  {
    id: 'R2',
    category: 'resolution',
    title: '終了時の在館者の安全',
    maxPoints: 4,
    goal: '状況終了時に、煙の影響を受けた区域に在館者を残さない',
    judge: (ctx) => {
      if (!ctx.ended) return excluded('undeterminable', '状況終了の記録がない');
      const e = ctx.ended;
      // 鎮火時は煙の影響を受けた区域、延焼拡大時は全館を対象とする
      const zones = e.outcome === 'resolved' ? e.zones.filter((z) => z.smoke) : e.zones;
      const total = zones.reduce((n, z) => n + z.initialOccupants, 0);
      const remaining = zones.reduce((n, z) => n + z.occupants, 0);
      if (total === 0) return judged(4, 4, '煙の影響を受けた区域なし', [ev(e, '状況終了時の集計')]);
      const points = Math.floor((4 * (total - remaining)) / total);
      const scope = e.outcome === 'resolved' ? '煙の影響区域' : '全館';
      return judged(points, 4, `${scope}の残留者 ${remaining}/${total}名`, [ev(e, '状況終了時の集計')]);
    },
  },
];
