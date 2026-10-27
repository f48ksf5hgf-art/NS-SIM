import { describe, expect, it } from 'vitest';
import { evaluate, formatClock, gameReducer, travelSeconds } from './engine';
import { SCENARIO, createInitialState } from './scenario';
import type { GameAction, GameState } from './types';

function run(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state);
}

function started(): GameState {
  return run(createInitialState(), { type: 'START' });
}

describe('初期状態', () => {
  it('6区域と警備員3名で構成される', () => {
    const s = createInitialState();
    expect(s.zoneOrder).toHaveLength(6);
    expect(s.guards).toHaveLength(3);
    expect(s.started).toBe(false);
  });

  it('状況開始で火災区域が発報し、ログに記録される', () => {
    const s = started();
    expect(s.zones[SCENARIO.fireZone].alarm).toBe(true);
    expect(s.zones[SCENARIO.fireZone].confirmed).toBe(false);
    expect(s.log.some((l) => l.category === 'alarm')).toBe(true);
  });
});

describe('時間経過', () => {
  it('開始前・一時停止中は時間が進まない', () => {
    expect(run(createInitialState(), { type: 'TICK' }).time).toBe(0);
    expect(run(started(), { type: 'PAUSE' }, { type: 'TICK', seconds: 10 }).time).toBe(0);
  });

  it('TICKで時刻と火勢が進む', () => {
    const s = run(started(), { type: 'TICK', seconds: 10 });
    expect(s.time).toBe(10);
    expect(s.fire.intensity).toBeCloseTo(SCENARIO.initialIntensity + 10 * SCENARIO.growthPerSecond);
  });

  it('時刻を HH:MM:SS 形式で表示する', () => {
    expect(formatClock(SCENARIO.startClock + 75)).toBe('14:33:15');
  });

  it('火勢が閾値を超えると隣接区域へ煙が流入し発報する', () => {
    const s = run(started(), { type: 'TICK', seconds: 220 });
    expect(s.zones[SCENARIO.smokeSpreadZone].alarm).toBe(true);
    expect(s.zones[SCENARIO.smokeSpreadZone].smoke).toBe(true);
  });

  it('放置すると延焼拡大で失敗する', () => {
    const s = run(started(), { type: 'TICK', seconds: 1000 });
    expect(s.outcome).toBe('failed');
    expect(evaluate(s).rank).toBe('D');
  });
});

describe('警備員への指示', () => {
  it('移動時間は階差に応じて増える', () => {
    const s = createInitialState();
    expect(travelSeconds(s, 'HQ', 'HQ')).toBe(0);
    expect(travelSeconds(s, 'HQ', 'B')).toBe(30);
    expect(travelSeconds(s, 'HQ', 'D')).toBe(70);
    expect(travelSeconds(s, 'F', 'D')).toBe(150);
  });

  it('区域指定が必要な指示は区域なしでは無視される', () => {
    const s = started();
    expect(run(s, { type: 'ASSIGN', guardId: 'g1', action: 'investigate' })).toBe(s);
  });

  it('現場確認で火災を発見する', () => {
    let s = run(started(), { type: 'ASSIGN', guardId: 'g1', action: 'investigate', target: 'D' });
    expect(s.guards[0].task?.phase).toBe('moving');
    s = run(s, { type: 'TICK', seconds: 70 });
    expect(s.guards[0].location).toBe('D');
    expect(s.guards[0].task?.phase).toBe('working');
    s = run(s, { type: 'TICK', seconds: 20 });
    expect(s.zones.D.confirmed).toBe(true);
    expect(s.fire.discoveredAt).toBe(90);
    expect(s.guards[0].task).toBeNull();
  });

  it('早期の初期消火は成功し状況終了となる', () => {
    const s = run(
      started(),
      { type: 'ASSIGN', guardId: 'g1', action: 'extinguish', target: 'D' },
      { type: 'CALL_119' },
      { type: 'ANNOUNCE' },
      { type: 'TICK', seconds: 200 },
    );
    expect(s.fire.active).toBe(false);
    expect(s.fire.extinguishedBy).toBe('guard');
    expect(s.outcome).toBe('resolved');
    const result = evaluate(s);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.rank).toBe('S');
  });

  it('火勢が強すぎると初期消火は失敗する', () => {
    let s = run(started(), { type: 'TICK', seconds: 250 });
    s = run(s, { type: 'ASSIGN', guardId: 'g1', action: 'extinguish', target: 'D' }, { type: 'TICK', seconds: 110 });
    expect(s.fire.active).toBe(true);
    expect(s.log.some((l) => l.message.includes('初期消火不能'))).toBe(true);
  });

  it('避難誘導で区域の在館者が減り、避難完了となる', () => {
    let s = run(started(), { type: 'ASSIGN', guardId: 'g2', action: 'evacuate', target: 'A' });
    expect(s.guards[1].task?.phase).toBe('working');
    s = run(s, { type: 'TICK', seconds: 20 });
    expect(s.zones.A.occupants).toBe(0);
    expect(s.zones.A.evacuated).toBe(true);
    expect(s.guards[1].task).toBeNull();
  });

  it('非常放送で全区域の避難が進む', () => {
    const s = run(started(), { type: 'ANNOUNCE' }, { type: 'TICK', seconds: 10 });
    for (const id of s.zoneOrder) {
      const z = s.zones[id];
      expect(z.occupants).toBe(Math.max(0, z.initialOccupants - 30));
    }
  });
});

describe('消防隊', () => {
  it('119番通報後に消防隊が到着し鎮火する', () => {
    const s = run(started(), { type: 'CALL_119' }, { type: 'TICK', seconds: 400 });
    expect(s.fireDeptArrivedAt).toBe(SCENARIO.fireDeptResponseSeconds);
    expect(s.fire.extinguishedBy).toBe('fire_department');
    expect(s.outcome).toBe('resolved');
  });

  it('119番通報は一度だけ記録される', () => {
    const s = run(started(), { type: 'CALL_119' }, { type: 'TICK' }, { type: 'CALL_119' });
    expect(s.called119At).toBe(0);
    expect(s.log.filter((l) => l.message.includes('119番')).length).toBe(1);
  });
});

describe('リセット', () => {
  it('初期状態に戻る', () => {
    const s = run(started(), { type: 'TICK', seconds: 30 }, { type: 'RESET' });
    expect(s).toEqual(createInitialState());
  });
});
