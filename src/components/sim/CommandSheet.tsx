import { useEffect, useRef, useState, type Dispatch } from 'react';
import { SIM_ACTION_LABELS, simLocationName, simTravelSeconds } from '../../sim/engine';
import { simGuardStatus, zoneMarks } from '../../sim/selectors';
import { commandCaution } from '../../sim/tasks';
import type { SimAction, SimActionType, SimState } from '../../sim/types';
import { IncidentIcon } from './IncidentIcon';

/** 区域を対象とする任務（帰隊・待機は従来の指示画面から） */
const SHEET_ACTIONS: SimActionType[] = ['investigate', 'extinguish', 'evacuate', 'first_aid'];

interface Props {
  state: SimState;
  zoneId: string;
  dispatch: Dispatch<SimAction>;
  onClose: () => void;
  /** 指示を送信した後（モニターへ戻る） */
  onSent: () => void;
}

/**
 * マップ直接指示：区域 → 隊員 → 任務 → 送信。
 * iPhone ではボトムシート、iPad・PC では中央のパネルとして表示する。
 */
export function CommandSheet({ state, zoneId, dispatch, onClose, onSent }: Props) {
  const [guardId, setGuardId] = useState<string | null>(null);
  const [action, setAction] = useState<SimActionType | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const def = state.spec.facility.zones[zoneId];
  const zone = state.zones[zoneId];
  const marks = zoneMarks(state, zoneId);
  const guard = state.guards.find((g) => g.id === guardId) ?? null;
  const caution = commandCaution(state);
  const eta = guard ? simTravelSeconds(state, guard.location, zoneId) : null;
  const disabled = !state.started || state.outcome !== null;

  // 親の再描画（毎秒の時間経過）でフォーカスを奪わないよう、開いたときだけ実行する
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = () => {
    if (!guard || !action || disabled) return;
    dispatch({ type: 'ASSIGN', guardId: guard.id, action, target: zoneId });
    onSent();
  };

  const requestSend = () => {
    if (!guard || !action) return;
    // 実行中の任務がある隊員への指示は、上書きの確認を挟む
    if (guard.task) setConfirming(true);
    else send();
  };

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet__handle" aria-hidden="true" />
        <header className="sheet__head">
          <div>
            <h2 id="sheet-title" className="sheet__title" tabIndex={-1} ref={titleRef}>
              {zoneId}区域への指示
            </h2>
            <p className="sheet__sub">
              {def.floorLabel} {def.name}・在館 <span className="mono">{zone.occupants}</span>/{def.capacity}名
              {marks.map((m, i) => (
                <span key={i} className={`sheet__mark sheet__mark--${m.kind}`}>
                  <IncidentIcon kind={m.kind} size={13} />
                  {m.label}
                </span>
              ))}
            </p>
          </div>
          <button type="button" className="btn btn--ghost sheet__close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>

        <div className="sheet__body">
          {caution && (
            <p className="command__warning" role="alert">
              {caution}
            </p>
          )}

          <h3 className="step__title">1. 隊員</h3>
          <div className="sheet-guards" role="radiogroup" aria-label="隊員">
            {state.guards.map((g) => {
              const t = simTravelSeconds(state, g.location, zoneId);
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={guardId === g.id}
                  className={`sheet-guard ${guardId === g.id ? 'is-selected' : ''} ${g.task ? 'is-busy' : ''}`}
                  onClick={() => {
                    setGuardId(g.id);
                    setConfirming(false);
                  }}
                >
                  <span className="guard__badge">{g.callSign.replace('警備', '')}</span>
                  <span className="sheet-guard__body">
                    <span className="sheet-guard__name">
                      {g.callSign} {g.name}
                      {g.task && <span className="sheet-guard__busy">任務中</span>}
                    </span>
                    <span className="sheet-guard__meta">現在地：{simLocationName(state, g.location)}</span>
                    <span className="sheet-guard__meta">
                      任務：{g.task ? simGuardStatus(state, g) : 'なし（待機中）'}
                    </span>
                  </span>
                  <span className="sheet-guard__eta mono" aria-label={t === 0 ? '現地にいます' : `到着まで約${t}秒`}>
                    {t === 0 ? '現地' : `約${t}秒`}
                  </span>
                </button>
              );
            })}
          </div>

          <h3 className="step__title">2. 任務</h3>
          <div className="actions" role="group" aria-label="任務">
            {SHEET_ACTIONS.map((a) => (
              <button
                key={a}
                type="button"
                className={`chip ${action === a ? 'is-active' : ''}`}
                aria-pressed={action === a}
                onClick={() => {
                  setAction(a);
                  setConfirming(false);
                }}
                disabled={!guard || disabled}
              >
                {SIM_ACTION_LABELS[a]}
              </button>
            ))}
          </div>
        </div>

        <footer className="sheet__foot">
          {confirming && guard ? (
            <div className="sheet-confirm" role="alertdialog" aria-labelledby="sheet-confirm-text">
              <p id="sheet-confirm-text">
                {guard.callSign}は現在「{simGuardStatus(state, guard)}」です。この任務を中止して、
                {zoneId}区域への{SIM_ACTION_LABELS[action!]}に切り替えますか？
              </p>
              <div className="sheet-confirm__actions">
                <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirming(false)}>
                  戻る
                </button>
                <button type="button" className="btn btn--warn btn--block" onClick={send}>
                  上書きして送信
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--block sheet__send"
              onClick={requestSend}
              disabled={!guard || !action || disabled}
            >
              {guard && action
                ? `${guard.callSign} → ${zoneId}区域：${SIM_ACTION_LABELS[action]}（${eta === 0 ? '現地' : `約${eta}秒`}）`
                : '隊員と任務を選択'}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
