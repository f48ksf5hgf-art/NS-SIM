/**
 * クリア可能性の検証に使う基準プレイ。事件の真の状況を知った上で、
 * 通常の操作（ASSIGN・CALL_119・ANNOUNCE）だけを使って対応する。
 * これで収束できないシナリオは生成時に採用しない。
 */
import { applySimAction, createSimState, isShaking, simTravelSeconds } from './engine';
import { generateScenario } from './scenario';
import type { Difficulty, ScenarioSpec, SimAction, SimGuard, SimState } from './types';

function nearestFree(state: SimState, zoneId: string, busy: Set<string>): SimGuard | null {
  let best: SimGuard | null = null;
  for (const g of state.guards) {
    if (g.task || busy.has(g.id)) continue;
    if (!best || simTravelSeconds(state, g.location, zoneId) < simTravelSeconds(state, best.location, zoneId)) best = g;
  }
  return best;
}

/** 基準プレイを最後まで実行した最終状態を返す */
export function runReferencePlay(spec: ScenarioSpec): SimState {
  const state = createSimState(spec);
  const act = (a: SimAction) => applySimAction(state, a);
  act({ type: 'START' });
  const handled = new Set<string>();
  const committed = new Set<string>();

  while (!state.outcome) {
    for (const inc of state.incidents) {
      if (inc.status !== 'active') continue;
      if (inc.kind === 'earthquake') {
        if (isShaking(state)) act({ type: 'ANNOUNCE', mode: 'shelter' });
        continue;
      }
      if (handled.has(inc.id) || isShaking(state)) continue;
      // 隊員を割り当てられた時点で対応済みとする（手が空くまで毎秒再試行）
      if (inc.kind === 'fire') {
        if (inc.genuine) {
          act({ type: 'CALL_119', service: 'fire' });
          act({ type: 'ANNOUNCE', mode: 'evacuate' });
        }
        const g = nearestFree(state, inc.zoneId, committed);
        if (g) {
          act({
            type: 'ASSIGN',
            guardId: g.id,
            action: inc.genuine ? 'extinguish' : 'investigate',
            target: inc.zoneId,
          });
          committed.add(g.id);
          handled.add(inc.id);
        }
      } else {
        act({ type: 'CALL_119', service: 'ambulance' });
        const g = nearestFree(state, inc.zoneId, committed);
        if (g) {
          act({ type: 'ASSIGN', guardId: g.id, action: 'first_aid', target: inc.zoneId });
          committed.add(g.id);
          handled.add(inc.id);
        }
      }
    }
    // 揺れが収まった後は、手の空いた隊員で未確認区域を安全確認する
    const quake = state.incidents.find((i) => i.kind === 'earthquake' && i.status === 'active');
    if (quake && !isShaking(state)) {
      const targeted = new Set(state.guards.map((g) => g.task?.target));
      for (const z of state.spec.facility.zoneOrder) {
        if (state.zones[z].inspected || targeted.has(z)) continue;
        const g = state.guards.find((x) => !x.task);
        if (!g) break;
        act({ type: 'ASSIGN', guardId: g.id, action: 'investigate', target: z });
        targeted.add(z);
      }
    }
    for (const g of state.guards) if (!g.task) committed.delete(g.id);
    act({ type: 'TICK' });
  }
  return state;
}

export function isClearable(spec: ScenarioSpec): boolean {
  return runReferencePlay(spec).outcome === 'resolved';
}

/** クリア可能性を検証済みのシナリオを生成する（同じ難易度・シードからは同じ結果） */
export function createScenario(difficulty: Difficulty, seed: number): ScenarioSpec {
  return generateScenario(difficulty, seed, isClearable);
}
