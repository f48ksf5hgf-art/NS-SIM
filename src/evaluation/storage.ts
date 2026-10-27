/**
 * 訓練結果の履歴をブラウザの localStorage に保存する。
 * 保存するのは評価結果（架空のシナリオ・架空の隊員名・得点・根拠）のみで、
 * 利用者の氏名などの個人情報や実在施設の情報は扱わない。
 */
import type { CategoryId, EvaluationResult } from './types';

export const HISTORY_KEY = 'ns-sim:aar-history:v1';
export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  id: string;
  /** 保存日時（ISO 8601） */
  savedAt: string;
  result: EvaluationResult;
}

/** localStorage と同じ形のストレージ（テストでは差し替える） */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface LoadResult {
  entries: HistoryEntry[];
  error: string | null;
}

export interface SaveResult extends LoadResult {
  ok: boolean;
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // プライベートブラウズや設定でストレージへのアクセスが拒否される場合がある
    return null;
  }
}

function isEntry(v: unknown): v is HistoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<HistoryEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.savedAt === 'string' &&
    typeof e.result === 'object' &&
    e.result !== null &&
    typeof e.result.scenarioId === 'string' &&
    typeof e.result.totalScore === 'number' &&
    Array.isArray(e.result.categories)
  );
}

/** 保存済みの履歴を新しい順で返す */
export function loadHistory(storage: KeyValueStorage | null = browserStorage()): LoadResult {
  if (!storage) return { entries: [], error: 'このブラウザでは履歴を保存できません（ストレージを利用できません）' };
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return { entries: [], error: null };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed))
      return { entries: [], error: '保存された履歴の形式が正しくないため読み込めませんでした' };
    const entries = parsed.filter(isEntry);
    entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return { entries: entries.slice(0, HISTORY_LIMIT), error: null };
  } catch {
    return { entries: [], error: '保存された履歴を読み込めませんでした' };
  }
}

/** 評価結果を先頭に追加し、直近 HISTORY_LIMIT 件だけを保存する */
export function saveResult(
  result: EvaluationResult,
  options: { storage?: KeyValueStorage | null; now?: Date; id?: string } = {},
): SaveResult {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const now = options.now ?? new Date();
  const entry: HistoryEntry = {
    id: options.id ?? `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: now.toISOString(),
    result,
  };
  const loaded = loadHistory(storage);
  // 保存に失敗した場合は、保存済みの履歴だけを返す（未保存の結果を履歴として扱わない）
  if (!storage) return { ok: false, entries: loaded.entries, error: loaded.error };
  const entries = [entry, ...loaded.entries.filter((e) => e.id !== entry.id)].slice(0, HISTORY_LIMIT);
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(entries));
    return { ok: true, entries, error: null };
  } catch {
    return {
      ok: false,
      entries: loaded.entries,
      error: '訓練結果を保存できませんでした（ストレージの容量不足、またはプライベートブラウズの可能性があります）',
    };
  }
}

/** 同じシナリオの直前の結果（current 自身は除く） */
export function previousResult(
  entries: HistoryEntry[],
  scenarioId: string,
  currentId: string | null,
): HistoryEntry | null {
  return entries.find((e) => e.id !== currentId && e.result.scenarioId === scenarioId) ?? null;
}

export interface Comparison {
  previous: HistoryEntry;
  totalDiff: number;
  categoryDiffs: Record<CategoryId, number | null>;
  /** 評価ルールのバージョンが異なり、単純比較できない */
  versionMismatch: boolean;
  bestScore: number;
  attempts: number;
}

export function compareWithHistory(
  result: EvaluationResult,
  entries: HistoryEntry[],
  currentId: string | null,
): Comparison | null {
  const previous = previousResult(entries, result.scenarioId, currentId);
  if (!previous) return null;
  const sameScenario = entries.filter((e) => e.result.scenarioId === result.scenarioId);
  const categoryDiffs = {} as Record<CategoryId, number | null>;
  for (const c of result.categories) {
    const p = previous.result.categories.find((x) => x.id === c.id);
    categoryDiffs[c.id] = p && c.assessedMax > 0 && p.assessedMax === c.assessedMax ? c.earned - p.earned : null;
  }
  return {
    previous,
    totalDiff: result.totalScore - previous.result.totalScore,
    categoryDiffs,
    versionMismatch: previous.result.rulesVersion !== result.rulesVersion,
    bestScore: Math.max(result.totalScore, ...sameScenario.map((e) => e.result.totalScore)),
    attempts: sameScenario.length + (sameScenario.some((e) => e.id === currentId) ? 0 : 1),
  };
}
