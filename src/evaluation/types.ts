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
