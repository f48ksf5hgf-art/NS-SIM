import { useEffect, useMemo, useReducer, useState } from 'react';
import { evaluateGeneratedRun } from '../../evaluation/generated/evaluate';
import { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS } from '../../sim/difficulty';
import { createSimState, simReducer } from '../../sim/engine';
import type { ScenarioSpec, SimActionType } from '../../sim/types';
import { AfterActionReview } from '../AfterActionReview';
import { CommandSheet } from './CommandSheet';
import { EventLog } from '../EventLog';
import { Header } from '../Header';
import { useResultHistory } from '../useResultHistory';
import { IncidentIcon } from './IncidentIcon';
import { SimCommandPanel } from './SimCommandPanel';
import { SimMap } from './SimMap';

type Tab = 'map' | 'command' | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'モニター' },
  { id: 'command', label: '指示' },
  { id: 'log', label: 'ログ' },
];

const KIND_LABELS = { fire: '火災', earthquake: '地震', casualty: '傷病者' } as const;

interface Props {
  spec: ScenarioSpec;
  onNewScenario: () => void;
  onExit: () => void;
}

function SimBriefing({ spec, onStart, onExit }: { spec: ScenarioSpec; onStart: () => void; onExit: () => void }) {
  const p = DIFFICULTIES[spec.difficulty];
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="sim-briefing-title">
      <div className="dialog">
        <p className="dialog__eyebrow">
          {p.label.toUpperCase()} · SEED {spec.seed}
        </p>
        <h2 id="sim-briefing-title" className="dialog__title">
          {spec.facility.name}
        </h2>
        <p className="dialog__sub">{DIFFICULTY_DESCRIPTIONS[spec.difficulty]}</p>
        <ul className="dialog__list">
          <li>
            {spec.facility.floors.length}フロア・{spec.facility.zoneOrder.length}区域、警備員{spec.guards.length}
            名（隊長は防災センター）
          </li>
          {p.revealIncidents ? (
            <li>
              発生する事案：
              {spec.incidents.map((i) => (
                <span key={i.id} className="dialog__incident">
                  <IncidentIcon kind={i.kind} size={14} />
                  {KIND_LABELS[i.kind]}
                </span>
              ))}
            </li>
          ) : (
            <li>発生する事案の種類・場所・時刻は知らされていません</li>
          )}
          {spec.difficulty === 'expert' && (
            <li>通常勤務から始まります。誤報や、通報者が場所を取り違えることがあります。現場確認で確かめてください</li>
          )}
          <li>119番は火災・救急を区別して通報します。地震の揺れの間は隊員を動かさないでください</li>
        </ul>
        <button type="button" className="btn btn--primary btn--block" onClick={onStart}>
          状況開始
        </button>
        <button type="button" className="btn btn--ghost btn--block" onClick={onExit}>
          モード選択に戻る
        </button>
      </div>
    </div>
  );
}

/** v0.3 ランダム生成シナリオの画面 */
export function GeneratedGame({ spec, onNewScenario, onExit }: Props) {
  const [state, dispatch] = useReducer(simReducer, spec, createSimState);
  const [selectedGuardId, setSelectedGuardId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<SimActionType | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('map');
  const [resultClosed, setResultClosed] = useState(false);
  const [seenLogCount, setSeenLogCount] = useState(0);
  /** マップ直接指示の対象区域（null なら閉じている） */
  const [sheetZone, setSheetZone] = useState<string | null>(null);

  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => dispatch({ type: 'TICK' }), 1000 / state.speed);
    return () => window.clearInterval(id);
  }, [state.running, state.speed]);

  const result = useMemo(
    () => (state.outcome ? evaluateGeneratedRun(spec, state.events) : null),
    [spec, state.outcome, state.events],
  );
  const history = useResultHistory(result, state.events);

  useEffect(() => {
    if (!state.started) {
      setSelectedGuardId(null);
      setSelectedAction(null);
      setSelectedZone(null);
      setResultClosed(false);
      setSeenLogCount(0);
      setTab('map');
      setSheetZone(null);
    }
  }, [state.started]);

  useEffect(() => {
    if (state.outcome) setSheetZone(null);
  }, [state.outcome]);

  useEffect(() => {
    if (tab === 'log') setSeenLogCount(state.log.length);
  }, [tab, state.log.length]);

  // 区域のタップでマップ直接指示を開く（従来の指示画面の区域選択も同期する）
  const openSheet = (id: string | null) => {
    if (id) setSelectedZone(id);
    if (id && state.started && !state.outcome) setSheetZone(id);
  };

  const unread = Math.max(0, state.log.length - seenLogCount);

  return (
    <div className="app">
      <Header state={state} dispatch={dispatch} />

      <main className="layout" data-tab={tab}>
        <div className="layout__map">
          <SimMap state={state} selectedZone={selectedZone} onSelectZone={openSheet} />
        </div>
        <div className="layout__command">
          <SimCommandPanel
            state={state}
            dispatch={dispatch}
            selectedGuardId={selectedGuardId}
            selectedAction={selectedAction}
            selectedZone={selectedZone}
            onSelectGuard={setSelectedGuardId}
            onSelectAction={setSelectedAction}
            onSelectZone={setSelectedZone}
            onIssued={() => setSelectedAction(null)}
          />
        </div>
        <div className="layout__log">
          <EventLog state={state} />
        </div>
      </main>

      <nav className="tabbar" aria-label="画面切替">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tabbar__btn ${tab === t.id ? 'is-active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'log' && unread > 0 && tab !== 'log' && <span className="tabbar__badge">{unread}</span>}
          </button>
        ))}
      </nav>

      {sheetZone && state.started && !state.outcome && (
        <CommandSheet
          state={state}
          zoneId={sheetZone}
          dispatch={dispatch}
          onClose={() => setSheetZone(null)}
          onSent={() => {
            setSheetZone(null);
            setTab('map');
          }}
        />
      )}
      {!state.started && <SimBriefing spec={spec} onStart={() => dispatch({ type: 'START' })} onExit={onExit} />}
      {result && !resultClosed && (
        <AfterActionReview
          result={result}
          history={history.entries}
          currentId={history.currentId}
          saveError={history.error}
          onReplay={() => dispatch({ type: 'RESET' })}
          onClose={() => setResultClosed(true)}
          extraActions={[
            { label: '新しいシナリオ', onClick: onNewScenario },
            { label: 'モード選択へ', onClick: onExit },
          ]}
        />
      )}
      {result && resultClosed && (
        <button type="button" className="btn btn--primary aar-reopen" onClick={() => setResultClosed(false)}>
          訓練結果を表示
        </button>
      )}
    </div>
  );
}
