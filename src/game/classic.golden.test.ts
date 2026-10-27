/**
 * シナリオ01（従来版）の回帰テスト。
 * v0.2.1 時点の時系列ログ・評価結果を固定値（__fixtures__/classic-golden.json）として保存し、
 * 以降の変更でシナリオ01の動作と評価結果が変わらないことを確認する。
 * 固定値の再生成は意図的な仕様変更時のみ：UPDATE_GOLDEN=1 npx vitest run src/game/classic.golden.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateRun } from '../evaluation/evaluate';
import { gameReducer } from './engine';
import { SCENARIO, createInitialState } from './scenario';
import type { GameAction, GameState } from './types';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'classic-golden.json');

const tick = (seconds: number): GameAction => ({ type: 'TICK', seconds });
const assign = (guardId: string, action: 'investigate' | 'extinguish' | 'evacuate', target: string): GameAction =>
  ({ type: 'ASSIGN', guardId, action, target }) as GameAction;

const SCRIPTS: Record<string, GameAction[]> = {
  ideal: [
    assign('g1', 'extinguish', 'D'),
    { type: 'CALL_119' },
    { type: 'ANNOUNCE' },
    assign('g2', 'evacuate', 'B'),
    assign('g3', 'evacuate', 'F'),
    tick(600),
  ],
  investigateThenAct: [
    assign('g1', 'investigate', 'D'),
    assign('g2', 'evacuate', 'B'),
    assign('g3', 'evacuate', 'F'),
    tick(91),
    { type: 'CALL_119' },
    { type: 'ANNOUNCE' },
    tick(600),
  ],
  idle: [tick(2000)],
  extinguishNoCall: [assign('g1', 'extinguish', 'D'), { type: 'ANNOUNCE' }, tick(600)],
  lateInvestigate: [{ type: 'CALL_119' }, { type: 'ANNOUNCE' }, tick(150), assign('g1', 'investigate', 'D'), tick(600)],
  dangerousReentry: [
    assign('g1', 'investigate', 'D'),
    { type: 'ANNOUNCE' },
    assign('g2', 'evacuate', 'C'),
    assign('g3', 'evacuate', 'F'),
    tick(100),
    { type: 'CALL_119' },
    tick(140),
    assign('g1', 'extinguish', 'D'),
    tick(41),
    assign('g1', 'extinguish', 'D'),
    tick(600),
  ],
  callDelay100: [assign('g1', 'investigate', 'D'), tick(190), { type: 'CALL_119' }, tick(1000)],
  callDelay300: [assign('g1', 'investigate', 'D'), tick(390), { type: 'CALL_119' }, tick(1000)],
  wrongZoneAndOverrides: [
    assign('g2', 'investigate', 'E'),
    assign('g2', 'investigate', 'D'),
    assign('g3', 'extinguish', 'A'),
    { type: 'PAUSE' },
    tick(30),
    { type: 'RESUME' },
    { type: 'SET_SPEED', speed: 4 },
    tick(120),
    { type: 'ASSIGN', guardId: 'g1', action: 'standby' },
    { type: 'ASSIGN', guardId: 'g3', action: 'return' },
    { type: 'ANNOUNCE' },
    tick(1000),
  ],
  fireDepartmentOnly: [{ type: 'CALL_119' }, tick(400)],
  evacuateOnly: [{ type: 'ANNOUNCE' }, assign('g2', 'evacuate', 'A'), tick(1000)],
  extinguishTooLate: [tick(250), assign('g1', 'extinguish', 'D'), tick(1000)],
};

function play(actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, gameReducer(createInitialState(), { type: 'START' }));
}

function snapshot() {
  return Object.fromEntries(
    Object.entries(SCRIPTS).map(([name, actions]) => {
      const s = play(actions);
      return [
        name,
        {
          time: s.time,
          outcome: s.outcome,
          log: s.log,
          result: evaluateRun({ scenarioId: SCENARIO.id, events: s.events }),
        },
      ];
    }),
  );
}

describe('シナリオ01（従来版）回帰テスト：v0.2.1 の動作・評価結果を維持する', () => {
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, JSON.stringify(snapshot(), null, 1) + '\n');
  }
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ReturnType<typeof snapshot>;
  const current = snapshot();

  it('固定値に全シナリオが含まれる', () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(SCRIPTS).sort());
  });

  for (const name of Object.keys(SCRIPTS)) {
    it(`${name}：時系列ログ・得点・ランク・判定が v0.2.1 と一致する`, () => {
      expect(current[name]).toEqual(golden[name]);
    });
  }

  it('評価ルールのバージョンは scenario-01/1.1.0 のまま', () => {
    expect(current.ideal.result.rulesVersion).toBe('scenario-01/1.1.0');
  });
});
