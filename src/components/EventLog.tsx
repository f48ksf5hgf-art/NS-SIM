import { formatClock, formatElapsed } from '../game/engine';
import type { GameState, LogCategory } from '../game/types';

const CATEGORY_LABELS: Record<LogCategory, string> = {
  system: 'SYS',
  alarm: '発報',
  command: '指令',
  report: '報告',
  danger: '危険',
  success: '完了',
};

export function EventLog({ state }: { state: Pick<GameState, 'log' | 'startClock'> }) {
  const entries = [...state.log].reverse();
  return (
    <section className="panel log" aria-labelledby="log-title">
      <div className="panel__head">
        <h2 id="log-title" className="panel__title">
          時系列ログ
        </h2>
        <span className="panel__sub">{state.log.length}件・新しい順</span>
      </div>
      {entries.length === 0 ? (
        <p className="log__empty">状況開始待ち</p>
      ) : (
        <ol className="log__list" aria-live="polite">
          {entries.map((e) => (
            <li key={e.id} className={`log__item log__item--${e.category}`}>
              <span className="log__time mono">
                {formatClock(state.startClock + e.time)}
                <span className="log__elapsed">{formatElapsed(e.time)}</span>
              </span>
              <span className="log__cat">{CATEGORY_LABELS[e.category]}</span>
              <span className="log__msg">{e.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
