import { useEffect, useReducer } from 'react';
import { gameReducer } from './engine';
import { createInitialState } from './scenario';

/** ゲーム状態と時間経過（実時間1秒 = 速度倍率に応じたゲーム内秒数）を管理する */
export function useGame() {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState);

  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => dispatch({ type: 'TICK' }), 1000 / state.speed);
    return () => window.clearInterval(id);
  }, [state.running, state.speed]);

  return [state, dispatch] as const;
}
