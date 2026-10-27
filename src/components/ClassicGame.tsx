import { useEffect, useMemo, useState } from 'react';
import { evaluateRun } from '../evaluation/evaluate';
import { ACTIONS_WITH_TARGET } from '../game/engine';
import { SCENARIO } from '../game/scenario';
import type { GuardActionType, ZoneId } from '../game/types';
import { useGame } from '../game/useGame';
import type { Difficulty } from '../sim/types';
import { AfterActionReview } from './AfterActionReview';
import { CommandPanel } from './CommandPanel';
import { EventLog } from './EventLog';
import { FacilityMap } from './FacilityMap';
import { Header } from './Header';
import { Briefing } from './Overlays';
import { useResultHistory } from './useResultHistory';

type Tab = 'map' | 'command' | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'モニター' },
  { id: 'command', label: '指示' },
  { id: 'log', label: 'ログ' },
];

/** シナリオ01（従来版）。v0.2.1 の画面と動作をそのまま維持する */
export function ClassicGame({
  onStartGenerated,
}: {
  onStartGenerated?: (difficulty: Difficulty, seed: number | null) => void;
}) {
  const [state, dispatch] = useGame();
  const [selectedGuardId, setSelectedGuardId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<GuardActionType | null>(null);
  const [selectedZone, setSelectedZone] = useState<ZoneId | null>(null);
  const [tab, setTab] = useState<Tab>('map');
  const [resultClosed, setResultClosed] = useState(false);
  const [seenLogCount, setSeenLogCount] = useState(0);

  // 状況終了時に、記録されたイベント履歴から評価する
  const result = useMemo(
    () => (state.outcome ? evaluateRun({ scenarioId: SCENARIO.id, events: state.events }) : null),
    [state.outcome, state.events],
  );

  // 1回の訓練につき1度だけ履歴へ保存する
  const history = useResultHistory(result, state.events);

  // リセット時に画面上の選択状態も初期化する
  useEffect(() => {
    if (!state.started) {
      setSelectedGuardId(null);
      setSelectedAction(null);
      setSelectedZone(null);
      setResultClosed(false);
      setSeenLogCount(0);
      setTab('map');
    }
  }, [state.started]);

  useEffect(() => {
    if (tab === 'log') setSeenLogCount(state.log.length);
  }, [tab, state.log.length]);

  const handleZoneFromMap = (id: ZoneId) => {
    setSelectedZone(id);
    // スマートフォンでは、隊員と区域指定が必要な指示を選択済みなら指示画面へ戻す
    if (selectedGuardId && selectedAction && ACTIONS_WITH_TARGET.includes(selectedAction)) {
      setTab('command');
    }
  };

  const unread = Math.max(0, state.log.length - seenLogCount);

  return (
    <div className="app">
      <Header state={state} dispatch={dispatch} />

      <main className="layout" data-tab={tab}>
        <div className="layout__map">
          <FacilityMap state={state} selectedZone={selectedZone} onSelectZone={handleZoneFromMap} />
        </div>
        <div className="layout__command">
          <CommandPanel
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

      {!state.started && <Briefing dispatch={dispatch} onStartGenerated={onStartGenerated} />}
      {result && !resultClosed && (
        <AfterActionReview
          result={result}
          history={history.entries}
          currentId={history.currentId}
          saveError={history.error}
          onReplay={() => dispatch({ type: 'RESET' })}
          onClose={() => setResultClosed(true)}
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
