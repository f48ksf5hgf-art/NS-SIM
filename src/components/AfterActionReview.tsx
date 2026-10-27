import { formatClock, formatElapsed } from '../game/engine';
import { SCENARIO } from '../game/scenario';
import { OUTCOME_LABELS } from '../evaluation/evaluate';
import { outcomeLabel } from '../evaluation/labels';
import { compareWithHistory, type HistoryEntry } from '../evaluation/storage';
import { CALL_TIERS } from '../evaluation/rules';
import type {
  CallAssessment,
  CallVerdict,
  Evidence,
  EvaluationResult,
  RuleResult,
  RuleStatus,
} from '../evaluation/types';

interface Props {
  result: EvaluationResult;
  history: HistoryEntry[];
  /** 今回の結果の履歴 ID（保存失敗時は null） */
  currentId: string | null;
  saveError: string | null;
  onReplay: () => void;
  onClose: () => void;
}

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

function evidenceTime(e: Evidence | null): string {
  return e ? `#${e.eventId} ${formatClock(SCENARIO.startClock + e.time)}` : '—';
}

function EmergencyCallCard({ call }: { call: CallAssessment }) {
  const excluded = call.status === 'not_applicable' || call.status === 'undeterminable';
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
          <dd className="mono">{call.confirmed ? evidenceTime(call.confirmed) : '確認なし'}</dd>
        </div>
        <div>
          <dt>119番通報</dt>
          <dd className="mono">{call.called ? evidenceTime(call.called) : '未実施'}</dd>
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

function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="aar-evidence">
      {items.map((e, i) => (
        <li key={`${e.eventId}-${i}`}>
          <span className="aar-evidence__ref mono">
            #{e.eventId} {formatClock(SCENARIO.startClock + e.time)}
          </span>
          <span>{e.note}</span>
        </li>
      ))}
    </ul>
  );
}

function RuleItem({ rule }: { rule: RuleResult }) {
  const excluded = rule.status === 'not_applicable' || rule.status === 'undeterminable';
  return (
    <li className={`aar-rule aar-rule--${rule.status}`}>
      <div className="aar-rule__head">
        <span className="aar-rule__status">{STATUS_LABELS[rule.status]}</span>
        <span className="aar-rule__title">
          <span className="mono aar-rule__id">{rule.ruleId}</span> {rule.title}
        </span>
        <span className="aar-rule__points mono">
          {excluded ? `—/${rule.maxPoints}` : `${rule.points}/${rule.maxPoints}`}
        </span>
      </div>
      <p className="aar-rule__detail">{rule.detail}</p>
      <EvidenceList items={rule.evidence} />
    </li>
  );
}

export function AfterActionReview({ result, history, currentId, saveError, onReplay, onClose }: Props) {
  const comparison = compareWithHistory(result, history, currentId);
  const flagged = new Set(
    [...result.violations.flatMap((v) => v.evidence), ...result.improvements.flatMap((r) => r.evidence)].map(
      (e) => e.eventId,
    ),
  );

  return (
    <div className="overlay overlay--aar" role="dialog" aria-modal="true" aria-labelledby="aar-title">
      <div className="aar">
        <header className="aar__head">
          <p className="dialog__eyebrow">AFTER ACTION REVIEW · {result.scenarioId.toUpperCase()}</p>
          <h2 id="aar-title" className="aar__title">
            訓練結果
          </h2>
          <dl className="aar__meta">
            <div>
              <dt>訓練結果</dt>
              <dd>{OUTCOME_LABELS[result.outcome]}</dd>
            </div>
            <div>
              <dt>経過時間</dt>
              <dd className="mono">{formatElapsed(result.elapsedSeconds)}</dd>
            </div>
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

        <div className="aar__grid">
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
              {comparison && (
                <p className="aar-summary__compare">
                  前回 <span className="mono">{comparison.previous.result.totalScore}点</span>（
                  <span className={`mono ${comparison.totalDiff >= 0 ? 'is-up' : 'is-down'}`}>
                    {signed(comparison.totalDiff)}
                  </span>
                  ）・自己ベスト <span className="mono">{comparison.bestScore}点</span>・挑戦 {comparison.attempts}回
                  {comparison.versionMismatch && (
                    <span className="aar-summary__note">（評価ルールのバージョンが異なります）</span>
                  )}
                </p>
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

            <EmergencyCallCard call={result.emergencyCall} />

            <section className="aar-card" aria-labelledby="aar-goal-title">
              <h3 id="aar-goal-title" className="aar-card__title">
                次回の改善目標
              </h3>
              <ol className="aar-goals">
                {result.nextGoals.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ol>
            </section>
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

          <section className="aar-card" aria-labelledby="aar-improve-title">
            <h3 id="aar-improve-title" className="aar-card__title">
              改善が必要な判断
            </h3>
            {result.improvements.length === 0 ? (
              <p className="aar-empty">改善が必要な判断はありません</p>
            ) : (
              <ul className="aar-rules">
                {result.improvements.map((r) => (
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
              <ul className="aar-rules">
                {result.undetermined.map((r) => (
                  <RuleItem key={r.ruleId} rule={r} />
                ))}
              </ul>
            </section>
          )}

          <section className="aar-card aar-card--wide" aria-labelledby="aar-timeline-title">
            <h3 id="aar-timeline-title" className="aar-card__title">
              主要イベントの時系列
            </h3>
            <ol className="aar-timeline">
              {result.timeline.map((t) => (
                <li
                  key={t.eventId}
                  className={`aar-timeline__item aar-timeline__item--${t.kind} ${flagged.has(t.eventId) ? 'is-flagged' : ''}`}
                >
                  <span className="aar-timeline__time mono">
                    #{t.eventId} {formatClock(SCENARIO.startClock + t.time)}
                  </span>
                  <span>{t.text}</span>
                </li>
              ))}
            </ol>
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
                  <li key={h.id} className={h.id === currentId ? 'is-current' : ''}>
                    <span className="mono aar-history__date">{new Date(h.savedAt).toLocaleString('ja-JP')}</span>
                    <span className="aar-history__scenario">{h.result.scenarioId}</span>
                    <span className="mono">{h.result.totalScore}点</span>
                    <span className="mono">{h.result.rank ?? '保留'}</span>
                    <span className="aar-history__outcome">{outcomeLabel(h.result)}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="aar-empty">履歴はこの端末のブラウザ内にのみ保存されます（架空の訓練データのみ）。</p>
          </section>
        </div>

        <footer className="aar__actions">
          <button type="button" className="btn btn--primary btn--block" onClick={onReplay}>
            もう一度挑戦
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            ログを確認する
          </button>
        </footer>
      </div>
    </div>
  );
}
