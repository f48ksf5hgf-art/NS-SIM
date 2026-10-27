import { ZONE_STATUS_LABELS, zoneDisplayStatus } from '../game/selectors';
import type { GameState, LocationId, ZoneId } from '../game/types';

interface Props {
  state: GameState;
  selectedZone: ZoneId | null;
  onSelectZone: (id: ZoneId) => void;
}

/** 階ごとのレイアウト（上階から表示） */
const FLOORS: { label: string; zones: ZoneId[]; hq?: boolean }[] = [
  { label: '3F', zones: ['E'] },
  { label: '2F', zones: ['C', 'D'] },
  { label: '1F', zones: ['A', 'B'], hq: true },
  { label: 'B1F', zones: ['F'] },
];

function GuardMarkers({ state, loc }: { state: GameState; loc: LocationId }) {
  const here = state.guards.filter((g) => g.location === loc);
  if (here.length === 0) return null;
  return (
    <div className="markers">
      {here.map((g) => (
        <span
          key={g.id}
          className={`marker ${g.task?.phase === 'moving' ? 'marker--moving' : ''}`}
          title={`${g.callSign} ${g.name}`}
        >
          {g.callSign.replace('警備', '')}
        </span>
      ))}
    </div>
  );
}

export function FacilityMap({ state, selectedZone, onSelectZone }: Props) {
  const fireKnown = state.zones[state.fire.zoneId].confirmed;

  return (
    <section className="panel map" aria-labelledby="map-title">
      <div className="panel__head">
        <h2 id="map-title" className="panel__title">
          施設監視モニター
        </h2>
        <span className="panel__sub">NSショッピングプラザ（架空）</span>
      </div>

      {fireKnown && state.fire.active && (
        <div className="fire-gauge" aria-label="火勢">
          <span>火勢</span>
          <div className="gauge">
            <div className="gauge__bar" style={{ width: `${state.fire.intensity}%` }} />
          </div>
          <span className="mono">{Math.round(state.fire.intensity)}%</span>
        </div>
      )}

      <div className="floors">
        {FLOORS.map((floor) => (
          <div className="floor" key={floor.label}>
            <div className="floor__label">{floor.label}</div>
            <div className="floor__zones">
              {floor.zones.map((id) => {
                const zone = state.zones[id];
                const status = zoneDisplayStatus(state, zone);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`zone zone--${status} ${selectedZone === id ? 'is-selected' : ''}`}
                    onClick={() => onSelectZone(id)}
                    aria-pressed={selectedZone === id}
                    aria-label={`${id}区域 ${zone.name} ${ZONE_STATUS_LABELS[status]}`}
                  >
                    <div className="zone__top">
                      <span className="zone__id">{id}</span>
                      <span className="zone__status">{ZONE_STATUS_LABELS[status]}</span>
                    </div>
                    <div className="zone__name">{zone.name}</div>
                    <div className="zone__meta">
                      在館 <span className="mono">{zone.occupants}</span>/{zone.initialOccupants}名
                    </div>
                    <GuardMarkers state={state} loc={id} />
                  </button>
                );
              })}
              {floor.hq && (
                <div className="zone zone--hq">
                  <div className="zone__top">
                    <span className="zone__id">HQ</span>
                    <span className="zone__status">指令</span>
                  </div>
                  <div className="zone__name">防災センター</div>
                  <div className="zone__meta">受信盤・放送設備</div>
                  <GuardMarkers state={state} loc="HQ" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <ul className="legend" aria-label="凡例">
        {(['normal', 'alarm', 'smoke', 'fire', 'extinguished', 'evacuated'] as const).map((s) => (
          <li key={s} className={`legend__item legend__item--${s}`}>
            {ZONE_STATUS_LABELS[s]}
          </li>
        ))}
      </ul>
    </section>
  );
}
