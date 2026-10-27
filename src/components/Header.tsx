import { formatClock, formatElapsed } from '../game/engine';
import type { Speed } from '../game/types';

/** シナリオ01・ランダム生成シナリオの両方で使う時計・進行操作 */
export interface HeaderState {
  scenarioTitle: string;
  startClock: number;
  time: number;
  started: boolean;
  running: boolean;
  speed: Speed;
  outcome: string | null;
}

export type HeaderAction =
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SET_SPEED'; speed: Speed }
  | { type: 'RESET' };

interface Props {
  state: HeaderState;
  dispatch: (action: HeaderAction) => void;
}

const SPEEDS: Speed[] = [1, 2, 4];

export function Header({ state, dispatch }: Props) {
  const status = state.outcome
    ? { label: '状況終了', tone: 'muted' }
    : !state.started
      ? { label: '待機', tone: 'muted' }
      : state.running
        ? { label: '対応中', tone: 'live' }
        : { label: '一時停止', tone: 'warn' };

  return (
    <header className="header">
      <div className="header__brand">
        <span className="logo" aria-hidden="true">
          ◆
        </span>
        <div>
          <h1 className="header__title">NS-SIM</h1>
          <p className="header__scenario">{state.scenarioTitle}</p>
        </div>
      </div>

      <div className="header__clock" aria-label="状況時刻">
        <span className="clock" data-testid="clock">
          {formatClock(state.startClock + state.time)}
        </span>
        <span className="elapsed">経過 {formatElapsed(state.time)}</span>
      </div>

      <div className="header__controls">
        <span className={`status-pill status-pill--${status.tone}`} role="status">
          {status.label}
        </span>
        {state.started && !state.outcome && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => dispatch({ type: state.running ? 'PAUSE' : 'RESUME' })}
            aria-label={state.running ? '一時停止' : '再開'}
          >
            {state.running ? '❚❚' : '▶'}
            <span className="btn__text">{state.running ? '一時停止' : '再開'}</span>
          </button>
        )}
        <div className="speed" role="group" aria-label="進行速度">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={`speed__btn ${state.speed === s ? 'is-active' : ''}`}
              aria-pressed={state.speed === s}
              onClick={() => dispatch({ type: 'SET_SPEED', speed: s })}
            >
              ×{s}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => dispatch({ type: 'RESET' })}
          aria-label="最初から"
        >
          ↺<span className="btn__text">最初から</span>
        </button>
      </div>
    </header>
  );
}
