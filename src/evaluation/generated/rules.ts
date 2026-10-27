/**
 * ランダム生成シナリオ（v0.3）の採点ルール `generated/1.0.0`。
 *
 * NS-SIM の訓練用に定めた架空の評価基準であり、消防法令・実在施設の消防計画・警備業務の運用基準を示すものではない。
 * 判断の時間は、その時点でプレイヤーが入手できた情報（発報・内線通報・隊員の報告）を起点に計測し、
 * 後から誤報・区域の取り違えと判明した情報に基づく妥当な行動は減点しない。
 */
import type { CategoryId, Evidence, RuleJudgement, SafetyViolation } from '../types';
import {
  aggregate,
  allowance,
  ev,
  excluded,
  incidentForCommand,
  incidentLabel,
  judged,
  tierPoints,
  timedJudge,
  type Ev,
  type GenCtx,
  type KnownIncident,
} from './context';

export const GENERATED_RULES_VERSION = 'generated/1.0.0';

/** 重大な安全違反の基準秒数（Expert は固定、Easy〜Hard は難易度の余裕で調整） */
export const CRITICAL_SECONDS = 180;

/**
 * 判定できた配点がこれ未満ならランクを判定保留にする。生成シナリオは事件構成により
 * 対象外の項目が多くなる（例：地震のみ）ため、シナリオ01（60点）より低く設定する。
 */
export const GENERATED_MIN_ASSESSED_POINTS = 30;

export interface GeneratedRule {
  id: string;
  category: CategoryId;
  title: string;
  maxPoints: number;
  goal: string;
  judge: (ctx: GenCtx) => RuleJudgement;
}

const MOVE_ACTIONS = new Set(['investigate', 'extinguish', 'evacuate', 'first_aid', 'return']);
const DISPATCH_ACTIONS = new Set(['investigate', 'extinguish', 'first_aid']);

const guardLabel = (ctx: GenCtx, id: string) => ctx.guardNames[id] ?? id;

/** 本物の火災と判断できる情報（隊員の火災確認、または煙の広がりによる第2報） */
function fireDecision(ctx: GenCtx, k: KnownIncident): SimEventLike | null {
  return (
    ctx.events.find(
      (e) => (e.type === 'fire_confirmed' || e.type === 'smoke_spread') && 'incidentId' in e && e.incidentId === k.id,
    ) ?? null
  );
}

type SimEventLike = GenCtx['events'][number];

function decisionLabel(e: SimEventLike): string {
  return e.type === 'fire_confirmed' ? '火災確認の報告' : e.type === 'smoke_spread' ? '第2報（煙感知器）' : '情報';
}

const isEvacuationMeasure = (e: SimEventLike) =>
  (e.type === 'announcement' && e.mode === 'evacuate') || (e.type === 'command' && e.action === 'evacuate');

const fires = (ctx: GenCtx) => ctx.known.filter((k) => k.kind === 'fire');
const casualties = (ctx: GenCtx) => ctx.known.filter((k) => k.kind === 'casualty');
const quakes = (ctx: GenCtx) => ctx.known.filter((k) => k.kind === 'earthquake');
const withZone = (ctx: GenCtx) => ctx.known.filter((k) => k.report.reportedZoneId !== null);

/** 揺れている時間帯 */
function shakingWindows(ctx: GenCtx): { from: number; to: number; start: SimEventLike }[] {
  return ctx.events
    .filter((e): e is Ev<'shaking_started'> => e.type === 'shaking_started')
    .map((s) => {
      const end = ctx.events.find((e) => e.type === 'shaking_ended' && e.incidentId === s.incidentId);
      return { from: s.time, to: end?.time ?? ctx.observedUntil, start: s };
    });
}

// ---------------------------------------------------------------------------
// 重大な安全違反（全難易度で共通の項目。期限は Expert では固定）

export function findGeneratedViolations(ctx: GenCtx): SafetyViolation[] {
  const out: SafetyViolation[] = [];
  const limitFor = (t: number) => Math.round(CRITICAL_SECONDS * allowance(ctx, 'safety', t));

  // V1：初期消火不能・火勢拡大の情報後に、火災区域へ隊員を進入させる
  for (const k of fires(ctx)) {
    const info = ctx.events.find(
      (e) => (e.type === 'extinguish_failed' || e.type === 'fire_danger') && e.incidentId === k.id,
    );
    if (!info) continue;
    for (const c of ctx.commands) {
      if (c.id > info.id && c.target === k.report.reportedZoneId && c.action !== 'return' && c.action !== 'standby') {
        out.push({
          violationId: 'V1',
          title: '退避判断後の火災区域への進入指示',
          detail: `${info.type === 'extinguish_failed' ? '初期消火不能' : '火勢拡大'}の情報の後、${guardLabel(ctx, c.guardId)}を${c.target}区域へ進入させた`,
          evidence: [ev(info, '退避が必要な情報'), ev(c, '進入指示')],
        });
      }
    }
  }

  for (const k of fires(ctx)) {
    const dp = fireDecision(ctx, k);
    if (!dp) continue;
    const limit = dp.time + limitFor(dp.time);
    if (ctx.observedUntil <= limit) continue;
    // V2：本物の火災と判断できた後、長時間にわたり避難措置なし
    const evac = ctx.events.find(isEvacuationMeasure);
    if (!evac || evac.time > limit) {
      out.push({
        violationId: 'V2',
        title: '避難措置の重大な遅れ',
        detail: `${decisionLabel(dp)}から${limit - dp.time}秒以上、非常放送（全館避難）・避難誘導のいずれもなかった`,
        evidence: [ev(dp, decisionLabel(dp)), ...(evac ? [ev(evac, '最初の避難措置')] : [])],
      });
    }
    // V3：本物の火災と判断できた後、長時間にわたり119番（火災）なし
    const call = ctx.events.find((e) => e.type === 'call_119' && e.service === 'fire');
    if (!call || call.time > limit) {
      out.push({
        violationId: 'V3',
        title: '119番通報（火災）の重大な遅れ',
        detail: `${decisionLabel(dp)}から${limit - dp.time}秒以上、119番通報（火災）がなかった`,
        evidence: [ev(dp, decisionLabel(dp)), ...(call ? [ev(call, '119番通報')] : [])],
      });
    }
  }

  // V4：揺れの最中に隊員を移動させる指示
  for (const c of ctx.commands) {
    if (c.duringShaking && MOVE_ACTIONS.has(c.action)) {
      out.push({
        violationId: 'V4',
        title: '揺れの最中の移動指示',
        detail: `揺れが続いている間に${guardLabel(ctx, c.guardId)}へ移動を伴う指示を出した`,
        evidence: [ev(c, '揺れの最中の指示')],
      });
    }
  }

  // V5：傷病者の通報後、長時間にわたり隊員を向かわせない
  for (const k of casualties(ctx)) {
    const limit = k.report.time + limitFor(k.report.time);
    if (ctx.observedUntil <= limit) continue;
    const dispatch = ctx.commands.find(
      (c) => c.time >= k.report.time && c.target !== null && k.attendZones.includes(c.target) && c.action !== 'standby',
    );
    if (!dispatch || dispatch.time > limit) {
      out.push({
        violationId: 'V5',
        title: '傷病者への対応の重大な遅れ',
        detail: `傷病者の通報から${limit - k.report.time}秒以上、隊員を向かわせなかった`,
        evidence: [ev(k.report, '傷病者の通報'), ...(dispatch ? [ev(dispatch, '最初の派遣')] : [])],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 補助関数

/** 事案に最初に隊員を向かわせた指示（情報上の区域へ） */
function firstDispatch(ctx: GenCtx, k: KnownIncident): Ev<'command'> | undefined {
  return ctx.commands.find(
    (c) =>
      c.time >= k.report.time &&
      c.target !== null &&
      k.attendZones.includes(c.target) &&
      DISPATCH_ACTIONS.has(c.action),
  );
}

/** 時刻 t に、最寄りの隊員が zone へ到着できた最短秒数（その時点の位置から） */
function bestTravelAt(ctx: GenCtx, zone: string, t: number): number {
  const loc = new Map(ctx.spec.guards.map((g) => [g.id, g.location]));
  for (const e of ctx.events) {
    if (e.time > t) break;
    if (e.type === 'guard_arrived' || e.type === 'guard_idle') loc.set(e.guardId, e.location);
  }
  return Math.min(...[...loc.values()].map((l) => ctx.spec.facility.travel[l]?.[zone] ?? Infinity));
}

// ---------------------------------------------------------------------------
// 採点ルール

export const GENERATED_RULES: GeneratedRule[] = [
  // ---- 安全管理 30 ----
  {
    id: 'S1',
    category: 'safety',
    title: '在館者の避難開始',
    maxPoints: 10,
    goal: '火災確認・第2報を受けたら60秒以内に全館避難の放送または避難誘導を開始する',
    judge: (ctx) =>
      aggregate(
        10,
        fires(ctx).map((k) => {
          const dp = fireDecision(ctx, k);
          return {
            label: incidentLabel(k),
            max: 10,
            judgement: dp
              ? timedJudge(
                  ctx,
                  10,
                  allowance(ctx, 'safety', dp.time),
                  { event: dp, label: decisionLabel(dp) },
                  { event: ctx.events.find(isEvacuationMeasure), label: '最初の避難措置' },
                  [
                    [60, 10],
                    [120, 6],
                    [180, 3],
                  ],
                )
              : excluded('not_applicable', '本物の火災と判断できる情報がなかった（誤報・早期鎮火を含む）'),
          };
        }),
        '火災の発報がなかった',
      ),
  },
  {
    id: 'S2',
    category: 'safety',
    title: '警備員の安全確保',
    maxPoints: 8,
    goal: '揺れの最中や初期消火不能の後に、隊員を危険な場所へ移動させない',
    judge: (ctx) => {
      if (ctx.commands.length === 0) return excluded('not_applicable', '警備員への指示がない');
      const v = findGeneratedViolations(ctx).filter((x) => x.violationId === 'V1' || x.violationId === 'V4');
      if (v.length)
        return judged(
          0,
          8,
          `危険な移動・進入の指示 ${v.length}件`,
          v.flatMap((x) => x.evidence),
        );
      return judged(8, 8, '隊員を危険にさらす指示なし', []);
    },
  },
  {
    id: 'S3',
    category: 'safety',
    title: '地震時の安全確保（適切な待機）',
    maxPoints: 6,
    goal: '揺れている間は隊員を動かさず、館内放送で「その場で身の安全を確保」を呼びかける',
    judge: (ctx) => {
      const windows = shakingWindows(ctx);
      if (windows.length === 0) return excluded('not_applicable', '地震が発生しなかった');
      const w = windows[0];
      const moved = ctx.commands.filter((c) => c.duringShaking && MOVE_ACTIONS.has(c.action));
      const shelter = ctx.events.find(
        (e) =>
          e.type === 'announcement' &&
          e.mode === 'shelter' &&
          e.time <= w.to + Math.round(10 * allowance(ctx, 'safety', w.from)),
      );
      const evidence: Evidence[] = [ev(w.start, '揺れの開始'), ...moved.map((c) => ev(c, '揺れの最中の移動指示'))];
      if (shelter) evidence.push(ev(shelter, '安全確保の放送'));
      const points = (moved.length === 0 ? 3 : 0) + (shelter ? 3 : 0);
      const parts = [
        moved.length === 0 ? '揺れの間、隊員を動かさなかった（適切な待機）' : `揺れの最中に移動指示 ${moved.length}件`,
        shelter ? '安全確保の放送を実施' : '安全確保の放送なし',
      ];
      return judged(points, 6, parts.join('・'), evidence);
    },
  },
  {
    id: 'S4',
    category: 'safety',
    title: '在館者の煙曝露の抑制',
    maxPoints: 6,
    goal: '煙が広がる前に、煙の影響を受ける区域の避難を終える',
    judge: (ctx) => {
      if (!ctx.events.some((e) => e.type === 'smoke_spread')) {
        return ctx.complete
          ? excluded('not_applicable', '煙の拡大が発生しなかった')
          : excluded('undeterminable', '状況終了の記録がない');
      }
      if (!ctx.ended) return excluded('undeterminable', '状況終了の記録がなく、煙曝露量を確認できない');
      const x = ctx.ended.smokeExposure;
      const points = x === 0 ? 6 : x <= 1500 ? 4 : x <= 5000 ? 2 : 0;
      return judged(points, 6, `煙にさらされた在館者 延べ${x.toLocaleString()}人・秒`, [
        ev(ctx.ended, '状況終了時の集計'),
      ]);
    },
  },

  // ---- 初動対応 25 ----
  {
    id: 'F1',
    category: 'initial',
    title: '通報区域への派遣指示',
    maxPoints: 8,
    goal: '発報・内線通報を受けたら、30秒以内に通報された区域へ隊員を派遣する',
    judge: (ctx) =>
      aggregate(
        8,
        withZone(ctx).map((k) => ({
          label: incidentLabel(k),
          max: 8,
          judgement: timedJudge(
            ctx,
            8,
            allowance(ctx, 'initial', k.report.time),
            { event: k.report, label: k.kind === 'casualty' ? '内線通報' : '発報' },
            { event: firstDispatch(ctx, k), label: `${k.report.reportedZoneId}区域への派遣` },
            [
              [30, 8],
              [60, 6],
              [120, 3],
              [180, 1],
            ],
          ),
        })),
        '区域を伴う通報がなかった',
      ),
  },
  {
    id: 'F2',
    category: 'initial',
    title: '119番通報（火災・救急）',
    maxPoints: 9,
    goal: '火災・傷病者を確認したら60秒以内に119番通報する（確認前の通報も可）',
    judge: (ctx) => {
      const parts = [...fires(ctx), ...casualties(ctx)].map((k) => {
        const service = k.kind === 'fire' ? 'fire' : 'ambulance';
        const confirmed = ctx.events.find(
          (e) => (e.type === 'fire_confirmed' || e.type === 'casualty_confirmed') && e.incidentId === k.id,
        );
        const call = ctx.events.find((e) => e.type === 'call_119' && e.service === service);
        const label = `${incidentLabel(k)}（${service === 'fire' ? '火災' : '救急'}）`;
        if (!confirmed) {
          if (call) return { label, max: 9, judgement: judged(9, 9, '確認前に通報', [ev(call, '119番通報')]) };
          return {
            label,
            max: 9,
            judgement: excluded(
              'not_applicable',
              k.kind === 'fire' && ctx.events.some((e) => e.type === 'false_alarm_confirmed' && e.incidentId === k.id)
                ? '誤報と確認されたため通報は不要'
                : '隊員による確認がなく、通報の有無だけでは評価しない',
            ),
          };
        }
        if (call && call.time <= confirmed.time) {
          return {
            label,
            max: 9,
            judgement: judged(9, 9, '確認より前に通報', [ev(confirmed, '確認'), ev(call, '119番通報')]),
          };
        }
        const factor = allowance(ctx, 'initial', confirmed.time);
        if (call) {
          const delay = call.time - confirmed.time;
          const pts =
            tierPoints(
              delay,
              [
                [60, 9],
                [120, 5],
                [240, 3],
              ],
              factor,
            ) || 1;
          return {
            label,
            max: 9,
            judgement: judged(
              pts,
              9,
              delay <= 60 * factor ? `確認から${delay}秒後に通報` : `通報遅延：確認から${delay}秒後`,
              [ev(confirmed, '確認'), ev(call, '119番通報')],
            ),
          };
        }
        const observed = ctx.observedUntil - confirmed.time;
        if (ctx.complete ? observed >= 30 : observed > 240 * factor) {
          return {
            label,
            max: 9,
            judgement: judged(0, 9, `通報未実施：確認から${ctx.complete ? '状況終了' : '記録終了'}まで${observed}秒`, [
              ev(confirmed, '確認'),
            ]),
          };
        }
        return {
          label,
          max: 9,
          judgement: excluded('undeterminable', `確認から${observed}秒で終了し、判断時間が不足`, [
            ev(confirmed, '確認'),
          ]),
        };
      });
      return aggregate(9, parts, '火災・傷病者の通報がなかった');
    },
  },
  {
    id: 'F3',
    category: 'initial',
    title: '隊員配置（最寄り隊員による現着）',
    maxPoints: 8,
    goal: '通報区域に最も近い隊員を選び、最短に近い時間で現着させる',
    judge: (ctx) =>
      aggregate(
        8,
        withZone(ctx).map((k) => {
          const zone = k.report.reportedZoneId!;
          const best = bestTravelAt(ctx, zone, k.report.time);
          const arrival = ctx.events.find(
            (e): e is Ev<'guard_arrived'> =>
              e.type === 'guard_arrived' && k.attendZones.includes(e.location) && e.time >= k.report.time,
          );
          const factor = allowance(ctx, 'initial', k.report.time);
          const label = incidentLabel(k);
          if (!arrival) {
            const done = ctx.events.some(
              (e) => e.type === 'false_alarm_confirmed' && e.incidentId === k.id && e.by === 'fire_department',
            );
            if (ctx.observedUntil - k.report.time > best + 180 * factor || done) {
              return { label, max: 8, judgement: judged(0, 8, `${zone}区域への現着なし`, [ev(k.report, '通報')]) };
            }
            return { label, max: 8, judgement: excluded('undeterminable', '現着前に終了', [ev(k.report, '通報')]) };
          }
          const excess = arrival.time - k.report.time - best;
          const pts =
            tierPoints(
              excess,
              [
                [30, 8],
                [60, 6],
                [120, 3],
              ],
              factor,
            ) || 1;
          return {
            label,
            max: 8,
            judgement: judged(pts, 8, `通報から${arrival.time - k.report.time}秒で現着（最短 約${best}秒）`, [
              ev(k.report, '通報'),
              ev(arrival, `${guardLabel(ctx, arrival.guardId)} 現着`),
            ]),
          };
        }),
        '区域を伴う通報がなかった',
      ),
  },

  // ---- 指揮統制 20 ----
  {
    id: 'C1',
    category: 'command',
    title: '役割分担',
    maxPoints: 6,
    goal: '事案ごとに必要な役割（確認・消火・避難誘導・救護・安全確認）へ隊員を分担させる',
    judge: (ctx) => {
      if (ctx.known.length === 0) return excluded('not_applicable', '事案が発生しなかった');
      const zones = ctx.spec.facility.zoneOrder.length;
      const needed = Math.min(
        ctx.spec.guards.length,
        ctx.known.reduce(
          (n, k) =>
            n + (k.kind === 'fire' ? (fireDecision(ctx, k) ? 2 : 1) : k.kind === 'casualty' ? 1 : Math.min(zones, 3)),
          0,
        ),
      );
      const firstReport = Math.min(...ctx.known.map((k) => k.report.time));
      const tasked = new Map<string, Ev<'command'>>();
      for (const c of ctx.commands) {
        if (c.time >= firstReport && c.action !== 'standby' && c.action !== 'return' && !tasked.has(c.guardId))
          tasked.set(c.guardId, c);
      }
      const n = Math.min(tasked.size, needed);
      return judged(
        Math.round((6 * n) / needed),
        6,
        `必要な役割 ${needed}名分に対し ${tasked.size}名に任務付与`,
        [...tasked.values()].map((c) => ev(c, `${guardLabel(ctx, c.guardId)}への最初の任務`)),
      );
    },
  },
  {
    id: 'C2',
    category: 'command',
    title: '優先順位の判断',
    maxPoints: 6,
    goal: '複数の事案が重なったら、人命に関わる事案（傷病者・確認された火災）へ先に隊員を向ける',
    judge: (ctx) => {
      // 事案の優先度（その時点の情報で判断）
      const priority = (k: KnownIncident, t: number) => {
        if (k.kind === 'casualty') return 3;
        if (k.kind === 'fire') {
          const dp = fireDecision(ctx, k);
          return dp && dp.time <= t ? 3 : 2;
        }
        return 1;
      };
      const attendedAt = (k: KnownIncident, t: number) =>
        ctx.commands.some((c) => c.time <= t && incidentForCommand(ctx, c)?.id === k.id && c.time >= k.report.time);
      const parts = ctx.known.flatMap((k) => {
        const t = k.report.time;
        const open = ctx.known.filter(
          (x) => x.report.time <= t && (x.resolvedAt === null || x.resolvedAt > t) && !attendedAt(x, t - 1),
        );
        if (open.length < 2) return [];
        const top = Math.max(...open.map((x) => priority(x, t)));
        const next = ctx.commands.find(
          (c) => c.time >= t && !c.duringShaking && open.some((x) => incidentForCommand(ctx, c)?.id === x.id),
        );
        const label = `${incidentLabel(k)}の通報時点`;
        if (!next) {
          return [
            {
              label,
              max: 6,
              judgement:
                ctx.observedUntil - t > 120
                  ? judged(0, 6, '重なった事案へ隊員を向けなかった', [ev(k.report, '通報')])
                  : excluded('undeterminable', '判断前に終了', [ev(k.report, '通報')]),
            },
          ];
        }
        const chosen = incidentForCommand(ctx, next)!;
        const ok = priority(chosen, next.time) >= top;
        return [
          {
            label,
            max: 6,
            judgement: judged(
              ok ? 6 : 0,
              6,
              ok
                ? `優先度の高い「${incidentLabel(chosen)}」へ先に派遣`
                : `優先度の低い「${incidentLabel(chosen)}」へ先に派遣`,
              [ev(k.report, '通報'), ev(next, '次の派遣')],
            ),
          },
        ];
      });
      return aggregate(6, parts, '事案が重ならず、優先順位の判断は不要だった');
    },
  },
  {
    id: 'C3',
    category: 'command',
    title: '指示の一貫性',
    maxPoints: 4,
    goal: '実行中の任務の上書きを減らし、指示を出す前に優先順位を決める',
    judge: (ctx) => {
      if (ctx.commands.length === 0) return excluded('not_applicable', '警備員への指示がない');
      // 新しい情報（取り違え判明など）を受けた直後の切り替えは上書きに数えない
      const infoTimes = ctx.events
        .filter(
          (e) =>
            e.type === 'misreport_found' ||
            e.type === 'incident_reported' ||
            e.type === 'shaking_ended' ||
            e.type === 'false_alarm_confirmed',
        )
        .map((e) => e.time);
      const overrides = ctx.commands.filter(
        (c) =>
          c.replaced !== null &&
          c.action !== 'return' &&
          c.action !== 'standby' &&
          !infoTimes.some((t) => c.time >= t && c.time - t <= 30),
      );
      const n = overrides.length;
      return judged(
        n <= 1 ? 4 : n <= 3 ? 2 : 0,
        4,
        `新しい情報によらない任務の上書き ${n}回`,
        overrides.map((c) => ev(c, '任務の上書き')),
      );
    },
  },
  {
    id: 'C4',
    category: 'command',
    title: '待機の妥当性',
    maxPoints: 4,
    goal: '対応が必要な事案が残っている間は、手の空いた隊員を待機させたままにしない',
    judge: (ctx) => {
      if (ctx.known.length === 0) return excluded('not_applicable', '事案が発生しなかった');
      const shaking = shakingWindows(ctx);
      const busy = new Map<string, string | null>(ctx.spec.guards.map((g) => [g.id, null]));
      let longest = 0;
      let longestGuard: string | null = null;
      let longestFrom = 0;
      const idleSince = new Map<string, number>(ctx.spec.guards.map((g) => [g.id, 0]));
      const inspected = new Set<string>();
      let ei = 0;
      for (let t = 0; t <= ctx.observedUntil; t++) {
        while (ei < ctx.events.length && ctx.events[ei].time <= t) {
          const e = ctx.events[ei++];
          if (e.type === 'zone_inspected') inspected.add(e.zoneId);
          if (e.type === 'command' && e.action !== 'standby') {
            busy.set(e.guardId, e.target);
            idleSince.delete(e.guardId);
          } else if (e.type === 'guard_idle' && busy.get(e.guardId) !== null) {
            busy.set(e.guardId, null);
            idleSince.set(e.guardId, t);
          } else if (e.type === 'guard_idle' && !idleSince.has(e.guardId)) {
            idleSince.set(e.guardId, t);
          }
        }
        const inShake = shaking.some((w) => t >= w.from && t < w.to);
        // 対応が必要な事案：情報上進行中で、どの隊員も向かっていない事案（地震は未確認区域が残る間）
        const targets = new Set([...busy.values()].filter((v): v is string => v !== null));
        const need = ctx.known.some((k) => {
          if (k.report.time > t || (k.resolvedAt !== null && k.resolvedAt <= t)) return false;
          // 地震：揺れの収束後、未確認で誰も向かっていない区域が残っている間
          if (k.kind === 'earthquake') {
            return !inShake && ctx.spec.facility.zoneOrder.some((z) => !inspected.has(z) && !targets.has(z));
          }
          return !k.attendZones.some((z) => targets.has(z));
        });
        for (const [g, since] of [...idleSince]) {
          if (!need || inShake) {
            idleSince.set(g, t + 1);
            continue;
          }
          if (t - since > longest) {
            longest = t - since;
            longestGuard = g;
            longestFrom = since;
          }
        }
      }
      const factor = allowance(ctx, 'command', longestFrom);
      const pts = longest <= 60 * factor ? 4 : longest <= 120 * factor ? 2 : 0;
      return judged(
        pts,
        4,
        longestGuard && longest > 0
          ? `対応が必要な事案がある間の最長待機：${guardLabel(ctx, longestGuard)} ${longest}秒`
          : '対応が必要な間、待機させたままの隊員なし（揺れの間・対応済みの間の待機は適切として扱う）',
        [],
      );
    },
  },

  // ---- 情報管理 15 ----
  {
    id: 'I1',
    category: 'information',
    title: '未確認情報の現場確認',
    maxPoints: 6,
    goal: '発報・内線通報は隊員の現場確認で真偽と正確な場所を確かめる',
    judge: (ctx) =>
      aggregate(
        6,
        withZone(ctx).map((k) => {
          const label = incidentLabel(k);
          const byGuard = ctx.events.find(
            (e) =>
              ((e.type === 'fire_confirmed' || e.type === 'casualty_confirmed' || e.type === 'misreport_found') &&
                e.incidentId === k.id) ||
              (e.type === 'false_alarm_confirmed' && e.incidentId === k.id && e.by !== 'fire_department'),
          );
          if (byGuard) {
            const note =
              byGuard.type === 'false_alarm_confirmed'
                ? '隊員が誤報と確認'
                : byGuard.type === 'misreport_found'
                  ? '隊員が区域の取り違えを確認'
                  : '隊員が現場で確認';
            return { label, max: 6, judgement: judged(6, 6, note, [ev(k.report, '通報'), ev(byGuard, note)]) };
          }
          const byFd = ctx.events.find((e) => e.type === 'false_alarm_confirmed' && e.incidentId === k.id);
          if (byFd)
            return {
              label,
              max: 6,
              judgement: judged(3, 6, '消防隊の到着まで確認されなかった', [
                ev(k.report, '通報'),
                ev(byFd, '消防隊が確認'),
              ]),
            };
          if (ctx.complete || ctx.observedUntil - k.report.time > 180) {
            return { label, max: 6, judgement: judged(0, 6, '現場確認なし', [ev(k.report, '通報')]) };
          }
          return { label, max: 6, judgement: excluded('undeterminable', '確認前に記録終了', [ev(k.report, '通報')]) };
        }),
        '区域を伴う通報がなかった',
      ),
  },
  {
    id: 'I2',
    category: 'information',
    title: '新しい情報への対応',
    maxPoints: 5,
    goal: '取り違え判明・第2報・初期消火不能・揺れの収束など新しい情報を受けたら、60秒以内に対応を切り替える',
    judge: (ctx) => {
      const parts = ctx.events.flatMap((e) => {
        let window = 60;
        let ok: SimEventLike | undefined;
        let label: string;
        if (e.type === 'misreport_found') {
          label = `取り違え判明（${e.actualZoneId}区域）`;
          ok = ctx.commands.find((c) => c.time >= e.time && c.target === e.actualZoneId && c.action !== 'standby');
        } else if (e.type === 'smoke_spread') {
          label = '第2報';
          window = 90;
          ok = ctx.events.find(
            (x) => isEvacuationMeasure(x) && x.time <= e.time + window * allowance(ctx, 'information', e.time),
          );
        } else if (e.type === 'extinguish_failed' || e.type === 'fire_danger') {
          label = e.type === 'extinguish_failed' ? '初期消火不能' : '火勢拡大';
          const call = ctx.events.find((x) => x.type === 'call_119' && x.service === 'fire');
          const evac = ctx.events.find(isEvacuationMeasure);
          ok = call && evac ? (call.time > evac.time ? call : evac) : undefined;
        } else if (e.type === 'shaking_ended') {
          label = '揺れの収束';
          ok = ctx.commands.find((c) => c.time >= e.time && c.action === 'investigate');
        } else {
          return [];
        }
        const deadline = e.time + Math.round(window * allowance(ctx, 'information', e.time));
        const judgement =
          ok && ok.time <= deadline
            ? judged(5, 5, '期限内に対応', [ev(e, label), ev(ok, '対応')])
            : ctx.observedUntil > deadline
              ? judged(0, 5, `${deadline - e.time}秒以内の対応なし`, [ev(e, label)])
              : excluded('undeterminable', '判定期限前に終了', [ev(e, label)]);
        return [{ label, max: 5, judgement }];
      });
      return aggregate(5, parts, '対応を切り替えるべき新しい情報がなかった');
    },
  },
  {
    id: 'I3',
    category: 'information',
    title: '地震後の安全確認',
    maxPoints: 4,
    goal: '揺れが収まったら全区域の安全確認を行い、被害を把握する',
    judge: (ctx) => {
      if (quakes(ctx).length === 0) return excluded('not_applicable', '地震が発生しなかった');
      const inspected = ctx.events.filter((e): e is Ev<'zone_inspected'> => e.type === 'zone_inspected');
      const total = ctx.spec.facility.zoneOrder.length;
      if (!ctx.complete && inspected.length < total) return excluded('undeterminable', '記録が途切れている');
      return judged(
        Math.floor((4 * inspected.length) / total),
        4,
        `安全確認 ${inspected.length}/${total}区域`,
        inspected.filter((e) => e.damage === 'debris').map((e) => ev(e, `${e.zoneId}区域 被害あり`)),
      );
    },
  },

  // ---- 事態収束 10 ----
  {
    id: 'R1',
    category: 'resolution',
    title: '事案の収束',
    maxPoints: 6,
    goal: 'すべての事案を訓練時間内に収束させる',
    judge: (ctx) => {
      if (!ctx.ended) return excluded('undeterminable', '状況終了の記録がない');
      const list = ctx.ended.incidents;
      if (list.length === 0) return excluded('not_applicable', '事案がなかった');
      const ok = list.filter((i) => i.status === 'resolved').length;
      return judged(Math.round((6 * ok) / list.length), 6, `収束 ${ok}/${list.length}件`, [ev(ctx.ended, '状況終了')]);
    },
  },
  {
    id: 'R2',
    category: 'resolution',
    title: '傷病者への救護',
    maxPoints: 4,
    goal: '傷病者には救急隊の到着まで隊員が付き添い、救護を行う',
    judge: (ctx) =>
      aggregate(
        4,
        casualties(ctx).map((k) => {
          const label = incidentLabel(k);
          const aid = ctx.events.find((e) => e.type === 'first_aid_started' && e.incidentId === k.id);
          const handed = ctx.events.find(
            (e): e is Ev<'casualty_handed_over'> => e.type === 'casualty_handed_over' && e.incidentId === k.id,
          );
          const failed = ctx.events.find((e) => e.type === 'casualty_deteriorated' && e.incidentId === k.id);
          if (!handed && !failed) {
            return {
              label,
              max: 4,
              judgement: ctx.complete
                ? judged(aid ? 2 : 0, 4, '引継ぎ前に終了', aid ? [ev(aid, '救護開始')] : [])
                : excluded('undeterminable', '記録が途切れている'),
            };
          }
          const evidence = [
            aid ? ev(aid, '救護開始') : null,
            handed ? ev(handed, '救急隊へ引継ぎ') : null,
            failed ? ev(failed, '容体急変') : null,
          ].filter((x): x is Evidence => x !== null);
          if (failed) return { label, max: 4, judgement: judged(0, 4, '容体が急変した', evidence) };
          const pts = (aid ? 2 : 0) + (handed!.withGuard ? 2 : 0);
          return {
            label,
            max: 4,
            judgement: judged(
              pts,
              4,
              `${aid ? '救護あり' : '救護なし'}・${handed!.withGuard ? '隊員が付き添って引継ぎ' : '隊員の案内なし'}`,
              evidence,
            ),
          };
        }),
        '傷病者が発生しなかった',
      ),
  },
];
