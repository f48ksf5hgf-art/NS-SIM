import type { SimEvent } from '../game/types';

export type CategoryId = 'safety' | 'initial' | 'command' | 'information' | 'resolution';

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

/**
 * 判定結果
 * - pass / partial / fail：記録から判定できた
 * - not_applicable：該当する状況が発生しなかった（配点から除外）
 * - undeterminable：記録不足・観察時間不足で判定できない（配点から除外し、結果に明示）
 */
export type RuleStatus = 'pass' | 'partial' | 'fail' | 'not_applicable' | 'undeterminable';

/** 採点根拠として参照するイベント */
export interface Evidence {
  eventId: number;
  time: number;
  note: string;
}

export interface RuleJudgement {
  status: RuleStatus;
  /** 判定できた場合の得点（除外時は 0） */
  points: number;
  detail: string;
  evidence: Evidence[];
}

export interface RuleResult extends RuleJudgement {
  ruleId: string;
  category: CategoryId;
  title: string;
  maxPoints: number;
  /** 次回の改善目標 */
  goal: string;
}

export interface CategoryResult {
  id: CategoryId;
  label: string;
  maxPoints: number;
  /** 判定できた項目の得点合計 */
  earned: number;
  /** 判定できた項目の配点合計（0 なら項目全体が判定対象外） */
  assessedMax: number;
}

export interface SafetyViolation {
  violationId: string;
  title: string;
  detail: string;
  evidence: Evidence[];
}

/**
 * 119番通報の判定
 * - before_confirmation：現場での火災確認より前（または確認なし）に通報
 * - on_time：火災確認から基準時間内に通報
 * - delayed：基準時間を超えて通報（遅延）
 * - not_called：火災確認後、状況終了まで通報なし（未実施）
 * - not_required：火災が確認されておらず、通報の有無では評価しない
 * - undeterminable：記録不足・判断時間不足で判定できない
 */
export type CallVerdict =
  | 'before_confirmation'
  | 'on_time'
  | 'delayed'
  | 'not_called'
  | 'not_required'
  | 'undeterminable';

/** 119番通報の評価根拠（F2 の判定と AAR 画面の表示に用いる） */
export interface CallAssessment extends RuleJudgement {
  verdict: CallVerdict;
  maxPoints: number;
  /** 火災確認の報告 */
  confirmed: Evidence | null;
  /** 119番通報 */
  called: Evidence | null;
  /** 状況終了 */
  ended: Evidence | null;
  /** 火災確認から通報までの秒数（確認前の通報は 0、通報なしは null） */
  delaySeconds: number | null;
  /** 火災確認から状況終了（終了の記録がなければ最終記録）までの秒数 */
  observedSeconds: number | null;
  /** 警備員の初期消火で鎮火したか */
  extinguishedByGuard: boolean;
}

export type TrainingOutcome = 'extinguished_by_guard' | 'extinguished_by_fire_department' | 'fire_spread' | 'unknown';

export interface TimelineItem {
  eventId: number;
  time: number;
  kind: 'alarm' | 'command' | 'report' | 'danger' | 'success' | 'system';
  text: string;
}

export interface EvaluationResult {
  scenarioId: string;
  rulesVersion: string;
  /** 100点満点。判定できた配点で換算する */
  totalScore: number;
  /** 判定保留（記録不足）の場合は null */
  rank: Rank | null;
  /** 重大な安全違反により上限が適用されたか */
  rankCapped: boolean;
  /** 判定保留の理由 */
  rankNote: string | null;
  /** 判定できた配点の合計（100 未満なら除外項目あり） */
  assessedMax: number;
  categories: CategoryResult[];
  rules: RuleResult[];
  goodDecisions: RuleResult[];
  improvements: RuleResult[];
  undetermined: RuleResult[];
  violations: SafetyViolation[];
  /** 119番通報の評価根拠 */
  emergencyCall: CallAssessment;
  /** 状況終了までの経過秒数（記録がなければ最終イベント時刻） */
  elapsedSeconds: number;
  outcome: TrainingOutcome;
  /** 開始・終了が記録された完全な履歴か */
  complete: boolean;
  timeline: TimelineItem[];
  nextGoals: string[];
}

export interface EvaluationInput {
  scenarioId: string;
  events: SimEvent[];
}
