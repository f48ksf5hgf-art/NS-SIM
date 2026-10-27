import type { Dispatch } from 'react';
import { SIM_ACTIONS_WITH_TARGET, SIM_ACTION_LABELS, isShaking, simTravelSeconds } from '../../sim/engine';
import { simGuardStatus } from '../../sim/selectors';
import { HQ, type SimAction, type SimActionType, type SimState } from '../../sim/types';

interface Props {
  state: SimState;
  dispatch: Dispatch<SimAction>;
  selectedGuardId: string | null;
  selectedAction: SimActionType | null;
  selectedZone: string | null;
  onSelectGuard: (id: string) => void;
  onSelectAction: (action: SimActionType) => void;
  onSelectZone: (id: string) => void;
  onIssued: () => void;
}

const ACTION_ORDER: SimActionType[] = ['investigate', 'extinguish', 'evacuate', 'first_aid', 'return', 'standby'];

export function SimCommandPanel({
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
  const needsZone = selectedAction !== null && SIM_ACTIONS_WITH_TARGET.includes(selectedAction);
  const canIssue = !disabled && guard !== null && selectedAction !== null && (!needsZone || selectedZone !== null);
  const shaking = isShaking(state);
  const { facility } = state.spec;

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
        ? simTravelSeconds(state, guard.location, HQ)
        : needsZone && selectedZone
          ? simTravelSeconds(state, guard.location, selectedZone)
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

      {shaking && (
        <p className="command__warning" role="alert">
          揺れが続いています。隊員は身の安全を確保中です（移動を伴う指示は危険です）
        </p>
      )}

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
              <span className="guard__status">{simGuardStatus(state, g)}</span>
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
              {SIM_ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      {needsZone && (
        <div className="step">
          <h3 className="step__title">対象区域</h3>
          {[...facility.floors].reverse().map((f) => (
            <div className="actions actions--floor" key={f.floor} role="group" aria-label={f.label}>
              <span className="actions__floor mono">{f.label}</span>
              {f.zoneIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`chip chip--zone ${selectedZone === id ? 'is-active' : ''}`}
                  aria-pressed={selectedZone === id}
                  onClick={() => onSelectZone(id)}
                  disabled={disabled}
                >
                  {id} {facility.zones[id].name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn btn--primary btn--block" onClick={issue} disabled={!canIssue}>
        指示を送信{eta !== null ? `（移動 約${eta}秒）` : ''}
      </button>

      <div className="step">
        <h3 className="step__title">防災センター指令</h3>
        <div className="global-actions global-actions--sim">
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => dispatch({ type: 'CALL_119', service: 'fire' })}
            disabled={disabled || state.calls.fire !== null}
          >
            {state.calls.fire !== null ? '✓ 119番（火災）通報済' : '☎ 119番通報（火災）'}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => dispatch({ type: 'CALL_119', service: 'ambulance' })}
            disabled={disabled || state.calls.ambulance !== null}
          >
            {state.calls.ambulance !== null ? '✓ 119番（救急）通報済' : '☎ 119番通報（救急）'}
          </button>
          <button
            type="button"
            className="btn btn--warn"
            onClick={() => dispatch({ type: 'ANNOUNCE', mode: 'evacuate' })}
            disabled={disabled || state.announcements.evacuate !== null}
          >
            {state.announcements.evacuate !== null ? '✓ 全館避難 放送済' : '📢 非常放送（全館避難）'}
          </button>
          <button
            type="button"
            className="btn btn--warn"
            onClick={() => dispatch({ type: 'ANNOUNCE', mode: 'shelter' })}
            disabled={disabled || state.announcements.shelter !== null}
          >
            {state.announcements.shelter !== null ? '✓ 安全確保 放送済' : '📢 館内放送（その場で安全確保）'}
          </button>
        </div>
      </div>
    </section>
  );
}
