import type { Dispatch } from 'react';
import { ACTIONS_WITH_TARGET, ACTION_LABELS, travelSeconds } from '../game/engine';
import { guardStatusText } from '../game/selectors';
import type { GameAction, GameState, GuardActionType, ZoneId } from '../game/types';

interface Props {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  selectedGuardId: string | null;
  selectedAction: GuardActionType | null;
  selectedZone: ZoneId | null;
  onSelectGuard: (id: string) => void;
  onSelectAction: (action: GuardActionType) => void;
  onSelectZone: (id: ZoneId) => void;
  onIssued: () => void;
}

const ACTION_ORDER: GuardActionType[] = ['investigate', 'extinguish', 'evacuate', 'return', 'standby'];

export function CommandPanel({
  state,
  dispatch,
  selectedGuardId,
  selectedAction,
  selectedZone,
  onSelectGuard,
  onSelectAction,
  onSelectZone,
  onIssued,
}: Props) {
  const disabled = !state.started || state.outcome !== null;
  const guard = state.guards.find((g) => g.id === selectedGuardId) ?? null;
  const needsZone = selectedAction !== null && ACTIONS_WITH_TARGET.includes(selectedAction);
  const canIssue = !disabled && guard !== null && selectedAction !== null && (!needsZone || selectedZone !== null);

  const issue = () => {
    if (!canIssue || !guard || !selectedAction) return;
    dispatch({
      type: 'ASSIGN',
      guardId: guard.id,
      action: selectedAction,
      target: needsZone ? selectedZone! : undefined,
    });
    onIssued();
  };

  const eta =
    guard && selectedAction
      ? selectedAction === 'return'
        ? travelSeconds(state, guard.location, 'HQ')
        : needsZone && selectedZone
          ? travelSeconds(state, guard.location, selectedZone)
          : null
      : null;

  return (
    <section className="panel command" aria-labelledby="command-title">
      <div className="panel__head">
        <h2 id="command-title" className="panel__title">
          警備員・指示
        </h2>
        <span className="panel__sub">隊員を選択 → 指示 → 区域</span>
      </div>

      <div className="guards" role="radiogroup" aria-label="警備員">
        {state.guards.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={selectedGuardId === g.id}
            className={`guard ${selectedGuardId === g.id ? 'is-selected' : ''} ${g.task ? 'is-busy' : ''}`}
            onClick={() => onSelectGuard(g.id)}
          >
            <span className="guard__badge">{g.callSign.replace('警備', '')}</span>
            <span className="guard__body">
              <span className="guard__name">
                {g.callSign} {g.name}
                <span className="guard__role">{g.role}</span>
              </span>
              <span className="guard__status">{guardStatusText(state, g)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="step">
        <h3 className="step__title">指示</h3>
        <div className="actions">
          {ACTION_ORDER.map((a) => (
            <button
              key={a}
              type="button"
              className={`chip ${selectedAction === a ? 'is-active' : ''}`}
              aria-pressed={selectedAction === a}
              onClick={() => onSelectAction(a)}
              disabled={disabled || guard === null}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      {needsZone && (
        <div className="step">
          <h3 className="step__title">対象区域</h3>
          <div className="actions">
            {state.zoneOrder.map((id) => (
              <button
                key={id}
                type="button"
                className={`chip chip--zone ${selectedZone === id ? 'is-active' : ''}`}
                aria-pressed={selectedZone === id}
                onClick={() => onSelectZone(id)}
                disabled={disabled}
              >
                {id} {state.zones[id].floorLabel} {state.zones[id].name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" className="btn btn--primary btn--block" onClick={issue} disabled={!canIssue}>
        指示を送信{eta !== null ? `（移動 約${eta}秒）` : ''}
      </button>

      <div className="step">
        <h3 className="step__title">防災センター指令</h3>
        <div className="global-actions">
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => dispatch({ type: 'CALL_119' })}
            disabled={disabled || state.called119At !== null}
          >
            {state.called119At !== null ? '✓ 119番通報済' : '☎ 119番通報'}
          </button>
          <button
            type="button"
            className="btn btn--warn"
            onClick={() => dispatch({ type: 'ANNOUNCE' })}
            disabled={disabled || state.announcedAt !== null}
          >
            {state.announcedAt !== null ? '✓ 非常放送済' : '📢 非常放送（全館避難）'}
          </button>
        </div>
      </div>
    </section>
  );
}
