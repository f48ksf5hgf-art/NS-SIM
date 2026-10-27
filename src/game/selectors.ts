import { ACTION_LABELS, locationName } from './engine';
import type { GameState, Guard, Zone } from './types';

export type ZoneDisplayStatus = 'normal' | 'alarm' | 'smoke' | 'fire' | 'extinguished' | 'evacuated';

export const ZONE_STATUS_LABELS: Record<ZoneDisplayStatus, string> = {
  normal: '平常',
  alarm: '発報',
  smoke: '煙流入',
  fire: '火災',
  extinguished: '鎮火',
  evacuated: '避難完了',
};

/** 画面表示用の区域状態。未確認の火災は「発報」としてのみ表示する */
export function zoneDisplayStatus(state: GameState, zone: Zone): ZoneDisplayStatus {
  const isFireZone = state.fire.zoneId === zone.id;
  if (isFireZone && zone.confirmed) return state.fire.active ? 'fire' : 'extinguished';
  if (zone.smoke && zone.confirmed) return 'smoke';
  if (zone.alarm) return 'alarm';
  if (zone.evacuated) return 'evacuated';
  return 'normal';
}

export function guardStatusText(state: GameState, guard: Guard): string {
  const task = guard.task;
  if (!task) return `待機中（${locationName(state, guard.location)}）`;
  const dest = locationName(state, task.target);
  if (task.phase === 'moving') {
    return `${dest}へ移動中（残り${task.remaining}秒）`;
  }
  if (task.remaining === null) return `${dest}で${ACTION_LABELS[task.type]}中`;
  return `${dest}で${ACTION_LABELS[task.type]}中（残り${task.remaining}秒）`;
}
