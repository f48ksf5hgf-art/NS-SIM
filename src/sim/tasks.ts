/**
 * v0.4 タスクボード。プレイヤーが把握している情報（受信盤・内線・隊員の報告・自分の指示）だけから
 * 「対応が必要な状況」を一覧にする。
 *
 * - 未発見の事案・未確認の真の状況（誤報かどうか、傷病者の実際の区域）・将来の事案は使わない
 * - 内容は状況の説明に留め、取るべき手順（正解）は示さない
 * - 並び順は目安（推奨順）であり、評価（AAR）の判定基準とは無関係
 * - プレイヤーの優先度変更・手動完了は画面上の整理にのみ使い、シミュレーションや評価には影響しない
 */
import { isShaking, simZoneLabel } from './engine';
import type { IncidentKind, SimState } from './types';

export type TaskStatus = 'todo' | 'active' | 'waiting' | 'done';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '未着手',
  active: '対応中',
  waiting: '待機',
  done: '完了',
};

export type PlayerPriority = 'high' | 'normal' | 'low';

export const PLAYER_PRIORITY_LABELS: Record<PlayerPriority, string> = { high: '高', normal: '中', low: '低' };

/** 画面上だけで保持するプレイヤーの設定 */
export interface TaskPref {
  priority: PlayerPriority;
  manualDone: boolean;
}

export interface Task {
  id: string;
  kind: IncidentKind | 'smoke';
  /** 指示操作につなげる区域（全館が対象の状況は null） */
  zoneId: string | null;
  /** 区域の表示（「3B区域」「全館」など） */
  place: string;
  title: string;
  detail: string;
  /** この区域へ任務中の隊員（呼出符号） */
  assignees: string[];
  status: TaskStatus;
  /** 待機・完了の理由 */
  statusNote: string | null;
  /** 推奨順の目安（大きいほど上）。評価とは無関係 */
  urgency: number;
  /** 情報を得た時刻 */
  since: number;
  /** 隊員の現場確認などで情報が確定しているか */
  confirmed: boolean;
}

export interface BoardTask extends Task {
  priority: PlayerPriority;
  manualDone: boolean;
}

const DEFAULT_PREF: TaskPref = { priority: 'normal', manualDone: false };

function assigneesFor(state: SimState, zones: string[]): string[] {
  return state.guards
    .filter((g) => g.task && g.task.type !== 'return' && g.task.type !== 'standby' && zones.includes(g.task.target))
    .map((g) => g.callSign);
}

function reportTime(state: SimState, incidentId: string, fallback: number): number {
  return state.events.find((e) => e.type === 'incident_reported' && e.incidentId === incidentId)?.time ?? fallback;
}

function statusFrom(assignees: string[], waitingNote: string | null): Pick<Task, 'status' | 'statusNote'> {
  if (assignees.length > 0) return { status: 'active', statusNote: null };
  if (waitingNote) return { status: 'waiting', statusNote: waitingNote };
  return { status: 'todo', statusNote: null };
}

/** 入手済みの情報からタスクを導く（並び順は sortTasks で決める） */
export function deriveTasks(state: SimState): Task[] {
  const tasks: Task[] = [];
  const zoneName = (id: string) => simZoneLabel(state, id);

  for (const inc of state.incidents) {
    if (inc.status === 'pending') continue;
    const since = reportTime(state, inc.id, inc.startAt);

    if (inc.kind === 'fire') {
      const zones = [inc.zoneId];
      const base = { id: inc.id, kind: 'fire' as const, zoneId: inc.zoneId, place: `${inc.zoneId}区域`, since };
      if (inc.status === 'resolved') {
        tasks.push({
          ...base,
          title: inc.confirmed && !inc.genuine ? '誤報（非火災報）と確認' : '鎮火',
          detail: zoneName(inc.zoneId),
          assignees: [],
          status: 'done',
          statusNote: inc.confirmed && !inc.genuine ? '誤報と判明' : '鎮火を確認',
          urgency: -1,
          confirmed: inc.confirmed,
        });
      } else if (inc.status === 'failed') {
        tasks.push({
          ...base,
          title: '延焼拡大',
          detail: zoneName(inc.zoneId),
          assignees: [],
          status: 'done',
          statusNote: '状況終了',
          urgency: -1,
          confirmed: true,
        });
      } else if (inc.confirmed) {
        // 確認済みの場合のみ本物の火災と分かる（誤報は確認と同時に収束する）
        const assignees = assigneesFor(state, zones);
        tasks.push({
          ...base,
          title: '火災（確認済）',
          detail: `${zoneName(inc.zoneId)}・火勢${Math.round(inc.intensity)}%`,
          assignees,
          ...statusFrom(assignees, state.calls.fire !== null ? '消防隊の到着待ち' : null),
          urgency: 90,
          confirmed: true,
        });
      } else {
        const assignees = assigneesFor(state, zones);
        tasks.push({
          ...base,
          title: '火災発報（未確認）',
          detail: `${zoneName(inc.zoneId)}・受信盤の発報のみ`,
          assignees,
          ...statusFrom(assignees, state.calls.fire !== null ? '消防隊の到着待ち' : null),
          urgency: 60,
          confirmed: false,
        });
      }
    } else if (inc.kind === 'casualty') {
      // 傷病者の実際の区域は、隊員が確認するか取り違えが判明するまで使わない
      const known = inc.confirmed || inc.misreportFound;
      const zone = known ? inc.zoneId : inc.reportedZoneId;
      const base = { id: inc.id, kind: 'casualty' as const, zoneId: zone, place: `${zone}区域`, since };
      if (inc.status !== 'active') {
        tasks.push({
          ...base,
          title: inc.status === 'resolved' ? '傷病者（救急隊へ引継ぎ済）' : '傷病者（容体急変）',
          detail: zoneName(zone),
          assignees: [],
          status: 'done',
          statusNote: inc.status === 'resolved' ? '引継ぎ済' : '容体急変',
          urgency: -1,
          confirmed: inc.confirmed,
        });
        continue;
      }
      const assignees = assigneesFor(state, [zone]);
      const waiting = state.calls.ambulance !== null ? '救急隊の到着待ち' : null;
      tasks.push({
        ...base,
        title: inc.confirmed
          ? '傷病者（確認済）'
          : inc.misreportFound
            ? '傷病者（通報区域の取り違えが判明）'
            : '傷病者通報（未確認）',
        detail: inc.confirmed
          ? `${zoneName(zone)}・容体${Math.round(inc.vitality)}%`
          : inc.misreportFound
            ? `${zoneName(zone)}・現場の店員からの情報`
            : `${zoneName(zone)}・内線通報のみ`,
        assignees,
        ...statusFrom(assignees, waiting),
        urgency: inc.confirmed ? 100 : 80,
        confirmed: inc.confirmed,
      });
    } else {
      const zones = state.spec.facility.zoneOrder;
      const total = zones.length;
      const checked = zones.filter((z) => state.zones[z].inspected).length;
      const base = { id: inc.id, kind: 'earthquake' as const, place: '全館', since };
      if (inc.status !== 'active') {
        tasks.push({
          ...base,
          zoneId: null,
          title: '地震後の安全確認',
          detail: `${checked}/${total}区域 確認済`,
          assignees: [],
          status: 'done',
          statusNote: '全区域の確認完了',
          urgency: -1,
          confirmed: true,
        });
      } else if (state.time < inc.shakingUntil) {
        tasks.push({
          ...base,
          zoneId: null,
          title: '地震（揺れ継続中）',
          detail: `残り約${inc.shakingUntil - state.time}秒`,
          assignees: [],
          status: 'waiting',
          statusNote: '揺れの収束待ち',
          urgency: 95,
          confirmed: true,
        });
      } else {
        const unchecked = zones.filter((z) => !state.zones[z].inspected);
        const assignees = assigneesFor(state, unchecked);
        const targeted = new Set(state.guards.map((g) => g.task?.target));
        const next = unchecked.find((z) => !targeted.has(z)) ?? unchecked[0] ?? null;
        tasks.push({
          ...base,
          zoneId: next,
          place: `未確認 ${unchecked.length}区域`,
          title: '地震後の安全確認',
          detail: `${checked}/${total}区域 確認済${next ? `・未確認の例：${next}区域` : ''}`,
          assignees,
          ...statusFrom(assignees, null),
          urgency: 40,
          confirmed: true,
        });
      }
    }
  }

  // 第2報（煙感知器）で知った区域
  for (const e of state.events) {
    if (e.type !== 'smoke_spread') continue;
    const fire = state.incidents.find((i) => i.id === e.incidentId);
    for (const z of e.zoneIds) {
      const zone = state.zones[z];
      const done = zone.evacuated || zone.occupants === 0 || fire?.status !== 'active';
      const assignees = done ? [] : assigneesFor(state, [z]);
      tasks.push({
        id: `smoke:${z}`,
        kind: 'smoke',
        zoneId: z,
        place: `${z}区域`,
        title: zone.smokeConfirmed ? '煙の流入（確認済）' : '煙感知（第2報）',
        detail: `${zoneName(z)}・在館${zone.occupants}名`,
        assignees,
        ...(done
          ? { status: 'done' as const, statusNote: zone.occupants === 0 ? '在館者なし' : '火災の収束' }
          : statusFrom(assignees, null)),
        urgency: done ? -1 : 70,
        since: e.time,
        confirmed: zone.smokeConfirmed,
      });
    }
  }
  return tasks;
}

const PRIORITY_RANK: Record<PlayerPriority, number> = { high: 2, normal: 1, low: 0 };

/**
 * 表示順：未完了 → 完了（手動完了を含む）。未完了の中は プレイヤー優先度 → 推奨の目安 → 情報を得た順。
 */
export function buildBoard(tasks: Task[], prefs: Record<string, TaskPref>): BoardTask[] {
  return tasks
    .map((t) => ({ ...t, ...DEFAULT_PREF, ...prefs[t.id] }))
    .sort((a, b) => {
      const doneA = a.status === 'done' || a.manualDone;
      const doneB = b.status === 'done' || b.manualDone;
      return (
        Number(doneA) - Number(doneB) ||
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        b.urgency - a.urgency ||
        a.since - b.since ||
        a.id.localeCompare(b.id)
      );
    });
}

/** 揺れの最中など、移動を伴う指示に注意が必要な状況 */
export function commandCaution(state: SimState): string | null {
  return isShaking(state) ? '揺れが続いています。移動を伴う指示は隊員を危険にさらします' : null;
}
