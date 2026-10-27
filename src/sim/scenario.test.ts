import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_ORDER } from './difficulty';
import { createRng, parseSeed } from './rng';
import { generateScenario, validateScenario } from './scenario';
import { HQ } from './types';

const SEEDS = Array.from({ length: 100 }, (_, i) => i * 7919 + 1);

describe('シード付き乱数', () => {
  it('同じシードからは同じ系列になる', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('シード入力を検証する', () => {
    expect(parseSeed(' 123 ')).toBe(123);
    expect(parseSeed('4294967295')).toBe(4294967295);
    expect(parseSeed('4294967296')).toBeNull();
    expect(parseSeed('abc')).toBeNull();
    expect(parseSeed('')).toBeNull();
  });
});

describe('施設・シナリオ生成', () => {
  it('同じ難易度・シードからは同じシナリオを生成する', () => {
    for (const d of DIFFICULTY_ORDER) {
      expect(generateScenario(d, 12345)).toEqual(generateScenario(d, 12345));
    }
  });

  it('シードが異なれば施設構成が変わる', () => {
    const layouts = new Set(SEEDS.slice(0, 20).map((s) => generateScenario('hard', s).facility.zoneOrder.join()));
    expect(layouts.size).toBeGreaterThan(5);
  });

  for (const d of DIFFICULTY_ORDER) {
    describe(DIFFICULTIES[d].label, () => {
      const p = DIFFICULTIES[d];
      const specs = SEEDS.map((s) => generateScenario(d, s));

      it('整合性の問題がない（全区域へ移動可能・隊員配置・事件区域）', () => {
        for (const spec of specs) expect(validateScenario(spec)).toEqual([]);
      });

      it('施設規模・隊員数が難易度の範囲に収まる', () => {
        for (const spec of specs) {
          const { floors, zoneOrder } = spec.facility;
          expect(floors.length).toBeGreaterThanOrEqual(p.floors[0]);
          expect(floors.length).toBeLessThanOrEqual(p.floors[1]);
          expect(zoneOrder.length).toBeGreaterThanOrEqual(p.zones[0]);
          expect(zoneOrder.length).toBeLessThanOrEqual(p.zones[1]);
          expect(spec.guards).toHaveLength(p.guards);
          for (const f of floors) expect(f.zoneIds.length).toBeGreaterThanOrEqual(2);
        }
      });

      it('移動時間は全地点間で有限・対称・同一地点0秒', () => {
        for (const spec of specs.slice(0, 20)) {
          const nodes = [HQ, ...spec.facility.zoneOrder];
          for (const a of nodes) {
            expect(spec.facility.travel[a][a]).toBe(0);
            for (const b of nodes) {
              const t = spec.facility.travel[a][b];
              expect(t).not.toBeNull();
              expect(t).toBe(spec.facility.travel[b][a]);
              if (a !== b) expect(t!).toBeGreaterThan(0);
            }
          }
        }
      });
    });
  }

  it('Easy：事件は1件で開始直後に発生する', () => {
    for (const s of SEEDS) {
      const spec = generateScenario('easy', s);
      expect(spec.incidents).toHaveLength(1);
      expect(spec.incidents[0].startAt).toBe(0);
      expect(spec.params.revealIncidents).toBe(true);
    }
  });

  it('Expert：通常勤務から開始し、誤報1件と区域の取り違えがある傷病者を含む', () => {
    for (const s of SEEDS) {
      const spec = generateScenario('expert', s);
      expect(spec.params.revealIncidents).toBe(false);
      expect(Math.min(...spec.incidents.map((i) => i.startAt))).toBeGreaterThan(0);
      expect(spec.incidents.filter((i) => i.kind === 'fire' && !i.genuine)).toHaveLength(1);
      const casualty = spec.incidents.find((i) => i.kind === 'casualty');
      expect(casualty).toBeDefined();
      if (casualty?.kind === 'casualty') {
        expect(casualty.reportedZoneId).not.toBe(casualty.zoneId);
        expect(spec.facility.zones[casualty.reportedZoneId].floor).toBe(spec.facility.zones[casualty.zoneId].floor);
      }
    }
  });

  it('Hard 以上で複数の事件が発生しうる（地震を含む）', () => {
    const kinds = SEEDS.map((s) => generateScenario('hard', s).incidents.map((i) => i.kind));
    expect(kinds.every((k) => k.length >= 2)).toBe(true);
    expect(kinds.some((k) => k.includes('earthquake'))).toBe(true);
  });
});
