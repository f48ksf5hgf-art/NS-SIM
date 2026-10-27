import { describe, expect, it } from 'vitest';
import { gameReducer } from '../game/engine';
import { SCENARIO, createInitialState } from '../game/scenario';
import type { GameAction } from '../game/types';
import { evaluateRun } from './evaluate';
import {
  HISTORY_KEY,
  HISTORY_LIMIT,
  compareWithHistory,
  loadHistory,
  saveResult,
  type KeyValueStorage,
} from './storage';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

function resultOf(...actions: GameAction[]) {
  const s = actions.reduce(gameReducer, gameReducer(createInitialState(), { type: 'START' }));
  return evaluateRun({ scenarioId: SCENARIO.id, events: s.events });
}

const good = resultOf(
  { type: 'ASSIGN', guardId: 'g1', action: 'extinguish', target: 'D' },
  { type: 'CALL_119' },
  { type: 'ANNOUNCE' },
  { type: 'TICK', seconds: 600 },
);
const idle = resultOf({ type: 'TICK', seconds: 2000 });

const at = (n: number) => new Date(Date.UTC(2026, 9, 27, 0, 0, n));

describe('履歴保存', () => {
  it('新しい順に保存し、直近20件だけを保持する', () => {
    const storage = memoryStorage();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      saveResult(i % 2 ? good : idle, { storage, now: at(i), id: `run-${i}` });
    }
    const { entries, error } = loadHistory(storage);
    expect(error).toBeNull();
    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0].id).toBe(`run-${HISTORY_LIMIT + 4}`);
    expect(entries.at(-1)!.id).toBe('run-5');
  });

  it('保存内容は評価結果のみ（ゲーム状態やイベント履歴そのものは保存しない）', () => {
    const storage = memoryStorage();
    saveResult(good, { storage, now: at(0), id: 'a' });
    const saved = JSON.parse(storage.data.get(HISTORY_KEY)!);
    expect(Object.keys(saved[0]).sort()).toEqual(['id', 'result', 'savedAt']);
    expect(saved[0].result).toEqual(good);
    expect(saved[0].result).not.toHaveProperty('events');
  });

  it('同じシナリオの前回結果と比較できる', () => {
    const storage = memoryStorage();
    saveResult(idle, { storage, now: at(0), id: 'first' });
    const { entries } = saveResult(good, { storage, now: at(1), id: 'second' });
    const cmp = compareWithHistory(good, entries, 'second')!;
    expect(cmp.previous.id).toBe('first');
    expect(cmp.totalDiff).toBe(good.totalScore - idle.totalScore);
    expect(cmp.bestScore).toBe(good.totalScore);
    expect(cmp.attempts).toBe(2);
    expect(cmp.versionMismatch).toBe(false);
  });

  it('前回結果がなければ比較しない', () => {
    const storage = memoryStorage();
    const { entries } = saveResult(good, { storage, now: at(0), id: 'only' });
    expect(compareWithHistory(good, entries, 'only')).toBeNull();
  });
});

describe('履歴保存に失敗した場合', () => {
  it('書き込みで例外が出ると警告を返し、未保存の結果を履歴に含めない', () => {
    const storage = memoryStorage();
    saveResult(idle, { storage, now: at(0), id: 'old' });
    const failing: KeyValueStorage = {
      getItem: storage.getItem,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    const res = saveResult(good, { storage: failing, now: at(1), id: 'new' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/保存できませんでした/);
    expect(res.entries.map((e) => e.id)).toEqual(['old']);
  });

  it('ストレージを利用できない環境では警告を返す', () => {
    const res = saveResult(good, { storage: null });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/保存できません/);
    expect(res.entries).toEqual([]);
  });

  it('壊れた保存データは読み込まずに警告する', () => {
    const storage = memoryStorage();
    storage.setItem(HISTORY_KEY, '{not json');
    const { entries, error } = loadHistory(storage);
    expect(entries).toEqual([]);
    expect(error).toMatch(/読み込めませんでした/);
  });

  it('形式の合わない要素は無視する', () => {
    const storage = memoryStorage();
    storage.setItem(HISTORY_KEY, JSON.stringify([{ id: 1 }, { id: 'x', savedAt: at(0).toISOString(), result: good }]));
    expect(loadHistory(storage).entries.map((e) => e.id)).toEqual(['x']);
  });
});
