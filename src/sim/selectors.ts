/**
 * 画面表示用の変換。プレイヤーが知り得た情報だけを返し、Expert の非公開情報
 * （誤報かどうか・傷病者の実際の区域など）は確認されるまで表示しない。
 */
import { SIM_ACTION_LABELS, isShaking, simLocationName } from './engine';
import type { IncidentKind, SimGuard, SimState } from './types';

export type ZoneMark =
  | { kind: 'fire'; level: 'alarm' | 'confirmed' | 'smoke'; label: string }
  | { kind: 'casualty'; level: 'reported' | 'confirmed' | 'aid'; label: string }
  | { kind: 'earthquake'; level: 'unchecked' | 'checked' | 'damage'; label: string };

/** 区域に表示する事案マーク（情報ベース） */
export function zoneMarks(state: SimState, zoneId: string): ZoneMark[] {
  const marks: ZoneMark[] = [];
  const zone = state.zones[zoneId];
  for (const inc of state.incidents) {
    if (inc.status !== 'active') continue;
    if (inc.kind === 'fire' && inc.zoneId === zoneId) {
      if (inc.genuine && inc.confirmed) marks.push({ kind: 'fire', level: 'confirmed', label: '火災' });
      else if (zone.alarm) marks.push({ kind: 'fire', level: 'alarm', label: '発報' });
    }
    if (inc.kind === 'casualty') {
      const shownZone = inc.confirmed || inc.misreportFound ? inc.zoneId : inc.reportedZoneId;
      if (shownZone === zoneId) {
        const aiding = state.guards.some(
          (g) => g.task?.type === 'first_aid' && g.task.phase === 'working' && g.task.target === zoneId,
        );
        marks.push(
          aiding
            ? { kind: 'casualty', level: 'aid', label: '救護中' }
            : inc.confirmed
              ? { kind: 'casualty', level: 'confirmed', label: '傷病者' }
              : { kind: 'casualty', level: 'reported', label: '傷病者通報' },
        );
      }
    }
    if (inc.kind === 'earthquake' && !isShaking(state)) {
      marks.push(
        zone.inspected
          ? zone.damage === 'debris'
            ? { kind: 'earthquake', level: 'damage', label: '被害あり' }
            : { kind: 'earthquake', level: 'checked', label: '確認済' }
          : { kind: 'earthquake', level: 'unchecked', label: '未確認' },
      );
    }
  }
  if (zone.smokeConfirmed || (zone.smoke && zone.alarm && !marks.some((m) => m.kind === 'fire'))) {
    marks.push({ kind: 'fire', level: 'smoke', label: zone.smokeConfirmed ? '煙流入' : '煙感知' });
  }
  return marks;
}

export interface IncidentSummary {
  id: string;
  kind: IncidentKind;
  title: string;
  /** 情報上の区域（地震は null） */
  zoneId: string | null;
  status: string;
  tone: 'alarm' | 'danger' | 'ok' | 'muted';
  /** 情報を得た時刻（強調表示用） */
  since: number;
}

/** 状況ボードに表示する事案（プレイヤーが知った事案のみ） */
export function knownIncidents(state: SimState): IncidentSummary[] {
  const out: IncidentSummary[] = [];
  for (const inc of state.incidents) {
    if (inc.status === 'pending') continue;
    const report = state.events.find((e) => e.type === 'incident_reported' && e.incidentId === inc.id);
    const since = report?.time ?? inc.startAt;
    if (inc.kind === 'fire') {
      const status =
        inc.status === 'resolved'
          ? inc.genuine
            ? '鎮火'
            : '誤報と確認'
          : inc.status === 'failed'
            ? '延焼拡大'
            : inc.confirmed
              ? `火災確認（火勢${Math.round(inc.intensity)}%）`
              : '発報・未確認';
      out.push({
        id: inc.id,
        kind: 'fire',
        title: `火災発報 ${inc.zoneId}区域`,
        zoneId: inc.zoneId,
        status,
        tone: inc.status === 'resolved' ? 'ok' : inc.confirmed || inc.status === 'failed' ? 'danger' : 'alarm',
        since,
      });
    } else if (inc.kind === 'casualty') {
      const zone = inc.confirmed || inc.misreportFound ? inc.zoneId : inc.reportedZoneId;
      const status =
        inc.status === 'resolved'
          ? '救急隊へ引継ぎ済'
          : inc.status === 'failed'
            ? '容体急変'
            : inc.confirmed
              ? `確認済（容体${Math.round(inc.vitality)}%）`
              : inc.misreportFound
                ? '通報区域の取り違えが判明'
                : '通報・未確認';
      out.push({
        id: inc.id,
        kind: 'casualty',
        title: `傷病者 ${zone}区域`,
        zoneId: zone,
        status,
        tone: inc.status === 'resolved' ? 'ok' : inc.status === 'failed' || inc.confirmed ? 'danger' : 'alarm',
        since,
      });
    } else {
      const total = state.spec.facility.zoneOrder.length;
      const done = state.spec.facility.zoneOrder.filter((z) => state.zones[z].inspected).length;
      const status =
        inc.status === 'resolved'
          ? '全区域の安全確認完了'
          : state.time < inc.shakingUntil
            ? `揺れ継続中（残り約${inc.shakingUntil - state.time}秒）`
            : `安全確認 ${done}/${total}区域`;
      out.push({
        id: inc.id,
        kind: 'earthquake',
        title: '地震',
        zoneId: null,
        status,
        tone: inc.status === 'resolved' ? 'ok' : state.time < inc.shakingUntil ? 'danger' : 'alarm',
        since,
      });
    }
  }
  return out;
}

export function simGuardStatus(state: SimState, guard: SimGuard): string {
  const task = guard.task;
  if (!task) return `待機中（${simLocationName(state, guard.location)}）`;
  const dest = simLocationName(state, task.target);
  if (isShaking(state)) return `身の安全を確保中（${simLocationName(state, guard.location)}）`;
  if (task.phase === 'moving') return `${dest}へ移動中（残り${task.remaining}秒）`;
  if (task.remaining === null) return `${dest}で${SIM_ACTION_LABELS[task.type]}中`;
  return `${dest}で${SIM_ACTION_LABELS[task.type]}中（残り${task.remaining}秒）`;
}

/** 情報を得てから強調表示する秒数 */
export const HIGHLIGHT_SECONDS = 8;
