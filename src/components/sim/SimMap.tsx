import { HIGHLIGHT_SECONDS, knownIncidents, zoneMarks, type ZoneMark } from '../../sim/selectors';
import { HQ, type SimState } from '../../sim/types';
import { IncidentIcon } from './IncidentIcon';

interface Props {
  state: SimState;
  selectedZone: string | null;
  onSelectZone: (id: string) => void;
}

function zoneTone(marks: ZoneMark[], evacuated: boolean): string {
  if (marks.some((m) => m.kind === 'fire' && m.level === 'confirmed')) return 'fire';
  if (marks.some((m) => m.kind === 'casualty' && m.level !== 'reported')) return 'casualty';
  if (
    marks.some((m) => (m.kind === 'fire' && m.level === 'alarm') || (m.kind === 'casualty' && m.level === 'reported'))
  )
    return 'alarm';
  if (marks.some((m) => m.kind === 'fire' && m.level === 'smoke')) return 'smoke';
  if (marks.some((m) => m.kind === 'earthquake' && m.level === 'damage')) return 'damage';
  if (evacuated) return 'evacuated';
  if (marks.some((m) => m.kind === 'earthquake' && m.level === 'unchecked')) return 'unchecked';
  return 'normal';
}

function Markers({ state, loc }: { state: SimState; loc: string }) {
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

export function SimMap({ state, selectedZone, onSelectZone }: Props) {
  const { facility } = state.spec;
  const incidents = knownIncidents(state);
  const floors = [...facility.floors].reverse();
  const fresh = (since: number) => state.time - since < HIGHLIGHT_SECONDS;

  return (
    <section className="panel map" aria-labelledby="map-title">
      <div className="panel__head">
        <h2 id="map-title" className="panel__title">
          施設監視モニター
        </h2>
        <span className="panel__sub">
          {facility.name}・{facility.floors.length}フロア {facility.zoneOrder.length}区域
        </span>
      </div>

      <ul className="incident-board" aria-label="事案の状況" aria-live="polite">
        {incidents.length === 0 ? (
          <li className="incident-board__empty">異常なし（通常勤務中）</li>
        ) : (
          incidents.map((i) => (
            <li
              key={i.id}
              className={`incident-board__item incident-board__item--${i.tone} ${fresh(i.since) && i.tone !== 'ok' ? 'is-new' : ''}`}
            >
              <IncidentIcon kind={i.kind} size={20} />
              <span className="incident-board__title">{i.title}</span>
              <span className="incident-board__status">{i.status}</span>
            </li>
          ))
        )}
      </ul>

      <div className="floors">
        {floors.map((floor) => (
          <div className="floor" key={floor.floor}>
            <div className="floor__label">{floor.label}</div>
            <div className="floor__zones">
              {floor.zoneIds.map((id) => {
                const def = facility.zones[id];
                const zone = state.zones[id];
                const marks = zoneMarks(state, id);
                const tone = zoneTone(marks, zone.evacuated);
                const isNew = incidents.some((i) => fresh(i.since) && i.tone !== 'ok' && i.zoneId === id);
                const statusText = marks.map((m) => m.label).join('・') || (zone.evacuated ? '避難完了' : '平常');
                return (
                  <button
                    key={id}
                    type="button"
                    className={`zone zone--${tone} ${selectedZone === id ? 'is-selected' : ''} ${isNew ? 'is-new' : ''}`}
                    onClick={() => onSelectZone(id)}
                    aria-pressed={selectedZone === id}
                    aria-label={`${id}区域 ${def.name} ${statusText}`}
                  >
                    <div className="zone__top">
                      <span className="zone__id">{id}</span>
                      <span className="zone__status">
                        {marks.map((m, i) => (
                          <IncidentIcon key={i} kind={m.kind} size={13} />
                        ))}
                        {statusText}
                      </span>
                    </div>
                    <div className="zone__name">
                      {def.name}
                      {def.stair && (
                        <span className="zone__stair" title="階段室">
                          {' '}
                          ⇅
                        </span>
                      )}
                    </div>
                    <div className="zone__meta">
                      在館 <span className="mono">{zone.occupants}</span>/{def.capacity}名
                    </div>
                    <Markers state={state} loc={id} />
                  </button>
                );
              })}
              {floor.floor === facility.hqFloor && (
                <div className="zone zone--hq">
                  <div className="zone__top">
                    <span className="zone__id">HQ</span>
                    <span className="zone__status">指令</span>
                  </div>
                  <div className="zone__name">防災センター</div>
                  <div className="zone__meta">受信盤・放送設備</div>
                  <Markers state={state} loc={HQ} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <ul className="legend" aria-label="凡例">
        <li className="legend__item legend__item--alarm">発報・通報（未確認）</li>
        <li className="legend__item legend__item--fire">火災・傷病者（確認済）</li>
        <li className="legend__item legend__item--smoke">煙</li>
        <li className="legend__item legend__item--damage">地震被害</li>
        <li className="legend__item legend__item--evacuated">避難完了</li>
        <li className="legend__item">⇅ 階段室</li>
      </ul>
    </section>
  );
}
