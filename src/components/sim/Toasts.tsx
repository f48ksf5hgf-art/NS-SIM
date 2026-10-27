import { useEffect, useRef, useState } from 'react';
import type { SimEventV2, SimState } from '../../sim/types';

/** 簡易通知にする情報イベント（プレイヤーが受け取った報告・発報のみ） */
const URGENT = new Set<SimEventV2['type']>([
  'incident_reported',
  'fire_confirmed',
  'casualty_confirmed',
  'misreport_found',
  'smoke_spread',
  'extinguish_failed',
  'fire_danger',
  'shaking_started',
  'shaking_ended',
  'casualty_deteriorated',
]);
const INFO = new Set<SimEventV2['type']>([
  'false_alarm_confirmed',
  'incident_resolved',
  'fire_dept_arrived',
  'ambulance_arrived',
]);

export const TOAST_MS = 6000;
const MAX_TOASTS = 3;

interface Toast {
  key: number;
  urgent: boolean;
  message: string;
}

/** 緊急の発報・報告を画面上に短時間表示する（タップで閉じる） */
export function Toasts({ state, onOpenLog }: { state: SimState; onOpenLog: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef(0);

  useEffect(() => {
    if (!state.started) {
      seen.current = 0;
      setToasts([]);
      return;
    }
    const fresh = state.events.filter((e) => e.id > seen.current && (URGENT.has(e.type) || INFO.has(e.type)));
    seen.current = state.events.length ? state.events[state.events.length - 1].id : 0;
    const added: Toast[] = [];
    for (const e of fresh) {
      const message = state.log.find((l) => l.id === e.logId)?.message;
      // 同じログに複数のイベントが紐づく場合は1件にまとめる
      if (!message || added.some((t) => t.message === message)) continue;
      added.push({ key: e.id, urgent: URGENT.has(e.type), message });
    }
    if (added.length === 0) return;
    setToasts((cur) => [...added.reverse(), ...cur].slice(0, MAX_TOASTS));
    for (const t of added) {
      window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.key !== t.key)), TOAST_MS);
    }
  }, [state.started, state.events, state.log]);

  useEffect(() => {
    if (state.outcome) setToasts([]);
  }, [state.outcome]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-label="通知">
      {toasts.map((t) => (
        <div key={t.key} className={`toast ${t.urgent ? 'toast--urgent' : ''}`} role={t.urgent ? 'alert' : 'status'}>
          <button
            type="button"
            className="toast__msg"
            onClick={() => setToasts((cur) => cur.filter((x) => x.key !== t.key))}
            aria-label={`${t.message}（タップで閉じる）`}
          >
            {t.urgent && <span className="toast__badge">緊急</span>}
            {t.message}
          </button>
          <button type="button" className="toast__log" onClick={onOpenLog}>
            ログ
          </button>
        </div>
      ))}
    </div>
  );
}
