import { useEffect, useRef, useState } from 'react';
import { saveResult, type HistoryEntry } from '../evaluation/storage';
import type { AnyEvaluationResult } from '../evaluation/types';

export interface HistoryState {
  entries: HistoryEntry[];
  currentId: string | null;
  error: string | null;
}

/**
 * 評価結果を1回の訓練につき1度だけ履歴へ保存する。
 * runKey は訓練ごとに変わる値（イベント履歴の配列など）で、同じ訓練の再描画では保存しない。
 */
export function useResultHistory(result: AnyEvaluationResult | null, runKey: unknown): HistoryState {
  const [history, setHistory] = useState<HistoryState>({ entries: [], currentId: null, error: null });
  const saved = useRef<unknown>(null);
  useEffect(() => {
    if (!result || saved.current === runKey) return;
    saved.current = runKey;
    const res = saveResult(result);
    setHistory({ entries: res.entries, currentId: res.ok ? res.entries[0].id : null, error: res.error });
  }, [result, runKey]);
  return history;
}
