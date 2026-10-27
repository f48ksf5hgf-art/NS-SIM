import { OUTCOME_LABELS } from './evaluate';
import { isGeneratedResult, type AnyEvaluationResult, type GeneratedEvaluationResult } from './types';

export const GENERATED_OUTCOME_LABELS: Record<GeneratedEvaluationResult['outcome'], string> = {
  resolved: '全事案収束',
  failed: '未収束の事案あり',
  timeout: '時間切れ',
  unknown: '不明（終了の記録なし）',
};

/** シナリオ01・ランダム生成のどちらの結果にも使える訓練結果の表示名 */
export function outcomeLabel(result: AnyEvaluationResult): string {
  return isGeneratedResult(result) ? GENERATED_OUTCOME_LABELS[result.outcome] : OUTCOME_LABELS[result.outcome];
}
