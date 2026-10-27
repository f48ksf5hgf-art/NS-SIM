import { describe, expect, it } from 'vitest';
import { createSimState, simReducer } from './engine';
import { generateScenario } from './scenario';
import { knownIncidents, zoneMarks } from './selectors';
import type { IncidentPlan, ScenarioSpec, SimAction, SimState } from './types';

function run(spec: ScenarioSpec, ...actions: SimAction[]): SimState {
  return actions.reduce(simReducer, simReducer(createSimState(spec), { type: 'START' }));
}

describe('画面表示は入手済みの情報だけを使う（Expert の非公開情報を表示しない）', () => {
  const base = generateScenario('expert', 2024);
  const floor = base.facility.floors.find((f) => f.zoneIds.length >= 2)!;
  const [actual, reported] = floor.zoneIds;
  const zone = base.facility.zoneOrder[3];

  it('誤報と本物の火災は、確認前は同じ「発報」として表示される', () => {
    const plans = (genuine: boolean): IncidentPlan[] => [{ id: 'f', kind: 'fire', zoneId: zone, startAt: 0, genuine }];
    const real = run({ ...base, incidents: plans(true) });
    const fake = run({ ...base, incidents: plans(false) });
    expect(zoneMarks(fake, zone)).toEqual(zoneMarks(real, zone));
    expect(knownIncidents(fake)[0].status).toBe(knownIncidents(real)[0].status);
    expect(zoneMarks(real, zone)[0]).toMatchObject({ kind: 'fire', level: 'alarm' });
  });

  it('区域を取り違えた傷病者通報は、判明するまで通報された区域に表示される', () => {
    const spec = {
      ...base,
      incidents: [
        { id: 'c', kind: 'casualty', zoneId: actual, reportedZoneId: reported, startAt: 0 },
      ] as IncidentPlan[],
    };
    let s = run(spec);
    expect(zoneMarks(s, reported)).toEqual([{ kind: 'casualty', level: 'reported', label: '傷病者通報' }]);
    expect(zoneMarks(s, actual)).toEqual([]);
    const g = base.guards[0];
    s = [
      { type: 'ASSIGN', guardId: g.id, action: 'investigate', target: reported } as SimAction,
      { type: 'TICK', seconds: base.facility.travel[g.location][reported]! + 1 } as SimAction,
    ].reduce(simReducer, s);
    expect(zoneMarks(s, reported)).toEqual([]);
    expect(zoneMarks(s, actual)[0]).toMatchObject({ kind: 'casualty' });
    expect(knownIncidents(s)[0].status).toMatch(/取り違え|確認済|容体/);
  });

  it('発生前の事案は状況ボードに出ない', () => {
    const spec = {
      ...base,
      incidents: [{ id: 'f', kind: 'fire', zoneId: zone, startAt: 60, genuine: true }] as IncidentPlan[],
    };
    expect(knownIncidents(run(spec, { type: 'TICK', seconds: 59 }))).toEqual([]);
    expect(knownIncidents(run(spec, { type: 'TICK', seconds: 60 }))).toHaveLength(1);
  });
});
