/**
 * シード付き乱数（mulberry32）。同じシードからは常に同じ系列を返す。
 * 施設生成・事件計画にのみ使い、ゲーム進行中のエンジンは乱数を使わない。
 */
export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [min, max] の整数 */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    chance: (p) => next() < p,
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** 新しいシード（画面側でのみ使用。生成・評価は与えられたシードだけに依存する） */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** シード文字列（数字）を検証して数値にする */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= 0xffffffff ? n : null;
}
