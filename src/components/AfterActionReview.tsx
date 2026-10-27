import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatClock, formatElapsed } from '../game/engine';
import { SCENARIO } from '../game/scenario';
import { outcomeLabel } from '../evaluation/labels';
import { CALL_TIERS } from '../evaluation/rules';
import { comparisonKey, compareWithHistory, type HistoryEntry } from '../evaluation/storage';
import {
  isGeneratedResult,
  type AnyEvaluationResult,
  type CallAssessment,
  type CallVerdict,
  type Evidence,
  type GeneratedEvaluationResult,
  type RuleResult,
  type RuleStatus,
} from '../evaluation/types';
import { DIFFICULTIES, SIM_CONSTANTS } from '../sim/difficulty';
import { IncidentIcon } from './sim/IncidentIcon';

export interface AarAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface Props {
  result: AnyEvaluationResult;
  history: HistoryEntry[];
  /** 今回の結果の履歴 ID（保存失敗時は null） */
  currentId: string | null;
  saveError: string | null;
  onReplay: () => void;
  onClose: () => void;
  /** ランダム生成シナリオ用の追加操作（新しいシナリオ・モード選択など） */
  extraActions?: AarAction[];
}

type Tab = 'summary' | 'improve' | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: '総合評価' },
  { id: 'improve', label: '改善点' },
  { id: 'log', label: '詳細ログ' },
];

const STATUS_LABELS: Record<RuleStatus, string> = {
  pass: '達成',
  partial: '一部',
  fail: '未達',
  not_applicable: '対象外',
  undeterminable: '判定不能',
};

const CALL_VERDICT_LABELS: Record<CallVerdict, string> = {
  before_confirmation: '確認前に通報',
  on_time: '基準内に通報',
  delayed: '通報遅延',
  not_called: '通報未実施',
  not_required: '評価対象外',
  undeterminable: '判定不能',
};

/** 評価根拠から詳細ログの該当行へ移動する */
const JumpContext = createContext<{ startClock: number; jump: (eventId: number) => void }>({
  startClock: 0,
  jump: () => {},
});

function useClock() {
  const { startClock } = useContext(JumpContext);
  return (t: number) => formatClock(startClock + t);
}

function EvidenceRef({ e }: { e: Evidence }) {
  const { jump } = useContext(JumpContext);
  const clock = useClock();
  return (
    <button
      type="button"
      className="aar-evidence__ref mono"
      onClick={() => jump(e.eventId)}
      aria-label={`詳細ログの #${e.eventId}（${clock(e.time)}）を表示`}
    >
      #{e.eventId} {clock(e.time)}
    </button>
  );
}

function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="aar-evidence">
      {items.map((e, i) => (
        <li key={`${e.eventId}-${i}`}>
          <EvidenceRef e={e} />
          <span>{e.note}</span>
        </li>
      ))}
    </ul>
  );
}

function RuleItem({ rule, rank }: { rule: RuleResult; rank?: number }) {
  const excluded = rule.status === 'not_applicable' || rule.status === 'undeterminable';
  return (
    <li className={`aar-rule aar-rule--${rule.status}`}>
      <div className="aar-rule__head">
        <span className="aar-rule__status">
          {rank !== undefined && <span className="aar-rule__priority mono">{rank}</span>}
          {STATUS_LABELS[rule.status]}
        </span>
        <span className="aar-rule__title">
          <span className="mono aar-rule__id">{rule.ruleId}</span> {rule.title}
        </span>
        <span className="aar-rule__points mono">
          {excluded ? `—/${rule.maxPoints}` : `${rule.points}/${rule.maxPoints}`}
        </span>
      </div>
      <p className="aar-rule__detail">{rule.detail}</p>
      {rank !== undefined && <p className="aar-rule__goal">提案：{rule.goal}</p>}
      <EvidenceList items={rule.evidence} />
    </li>
  );
}

function EmergencyCallCard({ call }: { call: CallAssessment }) {
  const excluded = call.status === 'not_applicable' || call.status === 'undeterminable';
  const ref = (e: Evidence | null, empty: string) => (e ? <EvidenceRef e={e} /> : empty);
  return (
    <section className={`aar-card aar-call aar-rule--${call.status}`} aria-labelledby="aar-call-title">
      <h3 id="aar-call-title" className="aar-card__title">
        119番通報の評価
      </h3>
      <div className="aar-rule__head">
        <span className="aar-rule__status" data-testid="aar-call-verdict">
          {CALL_VERDICT_LABELS[call.verdict]}
        </span>
        <span className="aar-rule__title">F2 119番通報</span>
        <span className="aar-rule__points mono">
          {excluded ? `—/${call.maxPoints}` : `${call.points}/${call.maxPoints}`}
        </span>
      </div>
      <dl className="aar-call__facts">
        <div>
          <dt>火災確認</dt>
          <dd className="mono">{ref(call.confirmed, '確認なし')}</dd>
        </div>
        <div>
          <dt>119番通報</dt>
          <dd className="mono">{ref(call.called, '未実施')}</dd>
        </div>
        <div>
          <dt>確認→通報</dt>
          <dd className="mono">
            {call.delaySeconds === null
              ? '—'
              : call.verdict === 'before_confirmation'
                ? '確認前'
                : `${call.delaySeconds}秒`}
          </dd>
        </div>
        <div>
          <dt>確認→終了</dt>
          <dd className="mono">{call.observedSeconds === null ? '—' : `${call.observedSeconds}秒`}</dd>
        </div>
        <div>
          <dt>初期消火</dt>
          <dd>{call.extinguishedByGuard ? '成功（通報とは別に評価）' : 'なし'}</dd>
        </div>
      </dl>
      <p className="aar-rule__detail">{call.detail}</p>
      <p className="aar-empty">
        時間基準（火災確認から{CALL_TIERS.map(([sec, pts]) => `${sec}秒以内${pts}点`).join('・')}
        、それ以降の通報1点、未実施0点）はNS-SIM独自の訓練基準です。消防法令上の通報義務やその適否を判定するものではありません。
      </p>
    </section>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function historyLabel(h: HistoryEntry): string {
  const r = h.result;
  return isGeneratedResult(r) ? `${DIFFICULTIES[r.difficulty].label}・seed ${r.seed}` : 'シナリオ01';
}

function GeneratedSummary({ result }: { result: GeneratedEvaluationResult }) {
  return (
    <>
      <section className="aar-card" aria-labelledby="aar-indicator-title">
        <h3 id="aar-indicator-title" className="aar-card__title">
          補助指標（総合得点には含まない）
        </h3>
        <dl className="aar-indicators">
          {(
            [
              ['判断効率', result.indicators.efficiency],
              ['安全性', result.indicators.safety],
            ] as const
          ).map(([label, ind]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="mono">{ind.value === null ? '—' : ind.value}</dd>
              <dd className="aar-indicators__detail">{ind.detail}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="aar-card" aria-labelledby="aar-incidents-title">
        <h3 id="aar-incidents-title" className="aar-card__title">
          発生した事案（実際の状況）
        </h3>
        <ul className="aar-incidents">
          {result.incidents.map((i) => (
            <li key={i.id} className={`aar-incidents__item is-${i.status}`}>
              <IncidentIcon kind={i.kind} size={18} />
              <span>{i.label}</span>
              <span className="aar-incidents__status">
                {i.status === 'resolved'
                  ? '収束'
                  : i.status === 'failed'
                    ? '未収束'
                    : i.status === 'active'
                      ? '対応中に終了'
                      : '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function AfterActionReview({
  result,
  history,
  currentId,
  saveError,
  onReplay,
  onClose,
  extraActions = [],
}: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [target, setTarget] = useState<number | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ summary: null, improve: null, log: null });
  const generated = isGeneratedResult(result) ? result : null;
  const startClock = generated ? SIM_CONSTANTS.startClock : SCENARIO.startClock;
  const comparison = compareWithHistory(result, history, currentId);

  // 評価根拠として参照されたイベント → ルール ID
  const refsByEvent = useMemo(() => {
    const map = new Map<number, string[]>();
    const add = (id: number, label: string) => map.set(id, [...new Set([...(map.get(id) ?? []), label])]);
    for (const r of result.rules) for (const e of r.evidence) add(e.eventId, r.ruleId);
    for (const v of result.violations) for (const e of v.evidence) add(e.eventId, v.violationId);
    return map;
  }, [result]);
  const flagged = new Set(
    [...result.violations.flatMap((v) => v.evidence), ...result.improvements.flatMap((r) => r.evidence)].map(
      (e) => e.eventId,
    ),
  );

  const jump = (eventId: number) => {
    // 時系列に表示しないイベント（待機開始など）は、その直前の表示行へ移動する
    const ids = result.timeline.map((t) => t.eventId);
    const shown = ids.includes(eventId) ? eventId : ([...ids].reverse().find((id) => id <= eventId) ?? ids[0]);
    setTarget(shown ?? null);
    setTab('log');
  };

  useEffect(() => {
    if (tab !== 'log' || target === null) return;
    const el = document.getElementById(`aar-ev-${target}`);
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }, [tab, target]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const clock = (t: number) => formatClock(startClock + t);
  const sameKey = history.filter((h) => comparisonKey(h.result) === comparisonKey(result));

  return (
    <JumpContext.Provider value={{ startClock, jump }}>
      <div className="overlay overlay--aar" role="dialog" aria-modal="true" aria-labelledby="aar-title">
        <div className="aar">
          <header className="aar__head">
            <p className="dialog__eyebrow">
              AFTER ACTION REVIEW ·{' '}
              {generated
                ? `${DIFFICULTIES[generated.difficulty].label.toUpperCase()} · SEED ${generated.seed}`
                : result.scenarioId.toUpperCase()}
            </p>
            <h2 id="aar-title" className="aar__title">
              訓練結果
            </h2>
            <dl className="aar__meta">
              <div>
                <dt>訓練結果</dt>
                <dd>{outcomeLabel(result)}</dd>
              </div>
              <div>
                <dt>経過時間</dt>
                <dd className="mono">{formatElapsed(result.elapsedSeconds)}</dd>
              </div>
              {generated && (
                <>
                  <div>
                    <dt>施設</dt>
                    <dd>
                      {generated.facilityName}（{generated.facilitySize.floors}フロア・{generated.facilitySize.zones}
                      区域・隊員{generated.facilitySize.guards}名）
                    </dd>
                  </div>
                  <div>
                    <dt>評価方式</dt>
                    <dd>{generated.evaluationMode === 'hybrid' ? 'ハイブリッド（安全管理は共通基準）' : '適応型'}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>評価ルール</dt>
                <dd className="mono">{result.rulesVersion}</dd>
              </div>
            </dl>
          </header>

          {saveError && (
            <p className="aar__alert" role="alert">
              ⚠ {saveError}
            </p>
          )}

          <div className="aar-tabs" role="tablist" aria-label="訓練結果の表示切替">
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`aar-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`aar-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={`aar-tabs__tab ${tab === t.id ? 'is-active' : ''}`}
                onClick={() => setTab(t.id)}
                onKeyDown={onTabKey}
              >
                {t.label}
                {t.id === 'improve' && result.improvements.length > 0 && (
                  <span className="aar-tabs__count">{result.improvements.length}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'summary' && (
            <div className="aar__grid" role="tabpanel" id="aar-panel-summary" aria-labelledby="aar-tab-summary">
              <div className="aar__col">
                <section className="aar-card aar-summary" aria-label="総合評価">
                  <div className="aar-summary__score">
                    <span className="aar-summary__num mono" data-testid="aar-score">
                      {result.totalScore}
                    </span>
                    <span className="aar-summary__max mono">/ 100</span>
                  </div>
                  <div className="aar-summary__rank">
                    {result.rank ? (
                      <span className={`rank rank--${result.rank} aar-summary__badge`} data-testid="aar-rank">
                        {result.rank}
                      </span>
                    ) : (
                      <span className="aar-summary__pending" data-testid="aar-rank">
                        判定保留
                      </span>
                    )}
                    <span className="aar-summary__label">評価ランク</span>
                  </div>
                  {result.rankNote && <p className="aar-summary__note">{result.rankNote}</p>}
                  {result.assessedMax < 100 && (
                    <p className="aar-summary__note">
                      判定対象 {result.assessedMax}
                      /100点。対象外・判定不能の項目は成功・失敗のどちらにも数えず、判定できた配点で100点満点に換算しています。
                    </p>
                  )}
                  {comparison ? (
                    <p className="aar-summary__compare">
                      前回 <span className="mono">{comparison.previous.result.totalScore}点</span>（
                      <span className={`mono ${comparison.totalDiff >= 0 ? 'is-up' : 'is-down'}`}>
                        {signed(comparison.totalDiff)}
                      </span>
                      ）・自己ベスト <span className="mono">{comparison.bestScore}点</span>・挑戦 {comparison.attempts}
                      回
                      {comparison.sameSeed === false && (
                        <span className="aar-summary__note">（同じ難易度・別の施設／事案での比較です）</span>
                      )}
                      {comparison.versionMismatch && (
                        <span className="aar-summary__note">（評価ルールのバージョンが異なります）</span>
                      )}
                    </p>
                  ) : (
                    generated && (
                      <p className="aar-summary__note">
                        比較は同じ難易度の結果どうしでのみ行います（難易度の異なる得点は比較しません）。
                      </p>
                    )
                  )}
                </section>

                <section className="aar-card aar-card--danger" aria-labelledby="aar-violation-title">
                  <h3 id="aar-violation-title" className="aar-card__title">
                    重大な安全違反
                  </h3>
                  {result.violations.length === 0 ? (
                    <p className="aar-empty">記録上、重大な安全違反はありません</p>
                  ) : (
                    <ul className="aar-rules">
                      {result.violations.map((v, i) => (
                        <li key={`${v.violationId}-${i}`} className="aar-rule aar-rule--fail">
                          <div className="aar-rule__head">
                            <span className="aar-rule__status">違反</span>
                            <span className="aar-rule__title">
                              <span className="mono aar-rule__id">{v.violationId}</span> {v.title}
                            </span>
                          </div>
                          <p className="aar-rule__detail">{v.detail}</p>
                          <EvidenceList items={v.evidence} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {!generated && 'emergencyCall' in result && <EmergencyCallCard call={result.emergencyCall} />}
                {generated && <GeneratedSummary result={generated} />}
              </div>

              <section className="aar-card" aria-labelledby="aar-cat-title">
                <h3 id="aar-cat-title" className="aar-card__title">
                  項目別スコア
                </h3>
                <ul className="aar-bars">
                  {result.categories.map((c) => {
                    const ratio = c.assessedMax > 0 ? c.earned / c.assessedMax : 0;
                    const diff = comparison?.categoryDiffs[c.id];
                    return (
                      <li key={c.id} className="aar-bar">
                        <div className="aar-bar__head">
                          <span>{c.label}</span>
                          <span className="mono">
                            {c.assessedMax > 0 ? `${c.earned}/${c.assessedMax}` : '判定対象外'}
                            {c.assessedMax > 0 && c.assessedMax < c.maxPoints && (
                              <span className="aar-bar__sub">（配点{c.maxPoints}）</span>
                            )}
                            {diff !== undefined && diff !== null && diff !== 0 && (
                              <span className={`aar-bar__diff ${diff > 0 ? 'is-up' : 'is-down'}`}>{signed(diff)}</span>
                            )}
                          </span>
                        </div>
                        <div
                          className="aar-bar__track"
                          role="meter"
                          aria-label={c.label}
                          aria-valuemin={0}
                          aria-valuemax={c.assessedMax}
                          aria-valuenow={c.earned}
                        >
                          <span
                            className={`aar-bar__fill ${ratio < 0.6 ? 'is-low' : ratio < 0.8 ? 'is-mid' : ''}`}
                            style={{ width: `${Math.round(ratio * 100)}%` }}
                          />
                        </div>
                        <details className="aar-bar__details">
                          <summary>評価根拠</summary>
                          <ul className="aar-rules">
                            {result.rules
                              .filter((r) => r.category === c.id)
                              .map((r) => (
                                <RuleItem key={r.ruleId} rule={r} />
                              ))}
                          </ul>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="aar-card aar-card--wide" aria-labelledby="aar-history-title">
                <h3 id="aar-history-title" className="aar-card__title">
                  訓練履歴（直近{history.length}件・新しい順）
                </h3>
                {history.length === 0 ? (
                  <p className="aar-empty">保存された履歴はありません</p>
                ) : (
                  <ol className="aar-history">
                    {history.map((h) => (
                      <li
                        key={h.id}
                        className={`${h.id === currentId ? 'is-current' : ''} ${sameKey.includes(h) ? '' : 'is-other'}`}
                      >
                        <span className="mono aar-history__date">{new Date(h.savedAt).toLocaleString('ja-JP')}</span>
                        <span className="aar-history__scenario">{historyLabel(h)}</span>
                        <span className="mono">{h.result.totalScore}点</span>
                        <span className="mono">{h.result.rank ?? '保留'}</span>
                        <span className="aar-history__outcome">{outcomeLabel(h.result)}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="aar-empty">
                  薄く表示した行は別のシナリオ・難易度の結果です（得点は比較しません）。履歴はこの端末のブラウザ内にのみ保存されます（架空の訓練データのみ）。
                </p>
              </section>
            </div>
          )}

          {tab === 'improve' && (
            <div className="aar__grid" role="tabpanel" id="aar-panel-improve" aria-labelledby="aar-tab-improve">
              <section className="aar-card aar-card--wide" aria-labelledby="aar-goal-title">
                <h3 id="aar-goal-title" className="aar-card__title">
                  次回の改善目標
                </h3>
                <ol className="aar-goals">
                  {result.nextGoals.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ol>
              </section>

              <section className="aar-card" aria-labelledby="aar-improve-title">
                <h3 id="aar-improve-title" className="aar-card__title">
                  改善が必要な判断
                </h3>
                {result.improvements.length === 0 ? (
                  <p className="aar-empty">改善が必要な判断はありません</p>
                ) : (
                  <>
                    <p className="aar-empty">優先順位順（重大な安全違反に関わる項目 → 安全管理 → 失点の大きい順）</p>
                    <ul className="aar-rules">
                      {result.improvements.map((r, i) => (
                        <RuleItem key={r.ruleId} rule={r} rank={i + 1} />
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <section className="aar-card" aria-labelledby="aar-good-title">
                <h3 id="aar-good-title" className="aar-card__title">
                  良かった判断
                </h3>
                {result.goodDecisions.length === 0 ? (
                  <p className="aar-empty">基準を満たした判断はありません</p>
                ) : (
                  <ul className="aar-rules">
                    {result.goodDecisions.map((r) => (
                      <RuleItem key={r.ruleId} rule={r} />
                    ))}
                  </ul>
                )}
              </section>

              {result.undetermined.length > 0 && (
                <section className="aar-card aar-card--wide" aria-labelledby="aar-undetermined-title">
                  <h3 id="aar-undetermined-title" className="aar-card__title">
                    対象外・判定不能の項目
                  </h3>
                  <p className="aar-empty">
                    対象外：対応する機会がなかった項目（減点しません）。判定不能：記録や判断時間が足りず判定できない項目（成功扱いにもしません）。
                  </p>
                  <ul className="aar-rules">
                    {result.undetermined.map((r) => (
                      <RuleItem key={r.ruleId} rule={r} />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {tab === 'log' && (
            <div className="aar__grid" role="tabpanel" id="aar-panel-log" aria-labelledby="aar-tab-log">
              <section className="aar-card aar-card--wide" aria-labelledby="aar-timeline-title">
                <h3 id="aar-timeline-title" className="aar-card__title">
                  主要イベントの時系列
                </h3>
                <p className="aar-empty">
                  評価根拠となったイベントには、関連する評価項目（ルールID・違反ID）を表示しています。
                </p>
                <ol className="aar-timeline aar-timeline--full">
                  {result.timeline.map((t) => {
                    const refs = refsByEvent.get(t.eventId) ?? [];
                    return (
                      <li
                        key={t.eventId}
                        id={`aar-ev-${t.eventId}`}
                        tabIndex={-1}
                        className={`aar-timeline__item aar-timeline__item--${t.kind} ${flagged.has(t.eventId) ? 'is-flagged' : ''} ${target === t.eventId ? 'is-target' : ''}`}
                      >
                        <span className="aar-timeline__time mono">
                          #{t.eventId} {clock(t.time)}
                        </span>
                        <span>
                          {t.text}
                          {refs.length > 0 && (
                            <span className="aar-timeline__refs">
                              {refs.map((r) => (
                                <span key={r} className="aar-timeline__ref mono">
                                  {r}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
              <section className="aar-card aar-card--wide" aria-labelledby="aar-evidence-title">
                <h3 id="aar-evidence-title" className="aar-card__title">
                  評価根拠一覧
                </h3>
                <ul className="aar-rules">
                  {result.rules.map((r) => (
                    <RuleItem key={r.ruleId} rule={r} />
                  ))}
                </ul>
              </section>
            </div>
          )}

          <footer className={`aar__actions ${extraActions.length ? 'aar__actions--many' : ''}`}>
            <button type="button" className="btn btn--primary btn--block" onClick={onReplay}>
              もう一度挑戦
            </button>
            {extraActions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`btn ${a.primary ? 'btn--primary' : 'btn--ghost'} btn--block`}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
            <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
              ログを確認する
            </button>
          </footer>
        </div>
      </div>
    </JumpContext.Provider>
  );
}
