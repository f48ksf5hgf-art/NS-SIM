export type ZoneId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** 警備員の所在。HQ は防災センター（1F）を表す */
export type LocationId = ZoneId | 'HQ';

export interface Zone {
  id: ZoneId;
  name: string;
  floorLabel: string;
  /** 移動時間計算用の階数（B1F = -1） */
  floor: number;
  description: string;
  /** 区域内の在館者数 */
  occupants: number;
  initialOccupants: number;
  /** 感知器が発報しているか */
  alarm: boolean;
  /** 煙が流入しているか（実際の状態） */
  smoke: boolean;
  /** 現場確認で火災・煙を確認済みか */
  confirmed: boolean;
  /** 避難完了済みか */
  evacuated: boolean;
}

export type GuardActionType = 'investigate' | 'extinguish' | 'evacuate' | 'return' | 'standby';

export interface GuardTask {
  type: GuardActionType;
  target: LocationId;
  phase: 'moving' | 'working';
  /** 現フェーズの残り秒数。避難誘導の作業フェーズは完了まで継続するため null */
  remaining: number | null;
}

export interface Guard {
  id: string;
  name: string;
  role: string;
  callSign: string;
  location: LocationId;
  task: GuardTask | null;
}

export interface Fire {
  zoneId: ZoneId;
  /** 火勢 0-100。100 で延焼拡大（対応失敗） */
  intensity: number;
  active: boolean;
  /** 誰が消火したか */
  extinguishedBy: 'guard' | 'fire_department' | null;
  discoveredAt: number | null;
  smokeSpreadAt: number | null;
}

export type LogCategory = 'system' | 'alarm' | 'command' | 'report' | 'danger' | 'success';

export interface LogEntry {
  id: number;
  /** 経過秒数 */
  time: number;
  category: LogCategory;
  message: string;
}

/**
 * 評価用の構造化イベント。時系列ログ（表示用の文章）とは別に、判断・状況変化を機械可読な形で記録する。
 * 評価エンジンはこの履歴のみを入力として採点する。
 */
export type SimEventBody =
  | { type: 'scenario_started'; scenarioId: string }
  | { type: 'alarm'; zoneId: ZoneId; stage: 1 | 2 }
  | {
      type: 'command';
      guardId: string;
      action: GuardActionType;
      target: LocationId | null;
      travelSeconds: number;
      /** 実行中の任務を上書きした場合、その任務種別 */
      replaced: GuardActionType | null;
    }
  | { type: 'call_119' }
  | { type: 'announcement' }
  | { type: 'fire_confirmed'; guardId: string; zoneId: ZoneId; intensity: number }
  | { type: 'smoke_confirmed'; guardId: string; zoneId: ZoneId }
  | { type: 'zone_clear'; guardId: string; zoneId: ZoneId }
  | { type: 'extinguish_succeeded'; guardId: string }
  | { type: 'extinguish_failed'; guardId: string; intensity: number }
  | { type: 'fire_danger'; intensity: number }
  | { type: 'guard_idle'; guardId: string; location: LocationId }
  | { type: 'zone_evacuated'; zoneId: ZoneId }
  | { type: 'fire_dept_arrived' }
  | { type: 'fire_dept_extinguished' }
  | {
      type: 'scenario_ended';
      outcome: 'resolved' | 'failed';
      extinguishedBy: 'guard' | 'fire_department' | null;
      smokeExposure: number;
      zones: { id: ZoneId; occupants: number; initialOccupants: number; smoke: boolean }[];
    };

export type SimEvent = SimEventBody & {
  id: number;
  /** 経過秒数 */
  time: number;
  /** 同時に記録された時系列ログの ID */
  logId: number | null;
};

export type Speed = 1 | 2 | 4;

export type Outcome = 'resolved' | 'failed' | null;

export interface GameState {
  scenarioTitle: string;
  /** 状況開始時刻（0時からの秒数） */
  startClock: number;
  /** 経過秒数 */
  time: number;
  started: boolean;
  running: boolean;
  speed: Speed;
  zones: Record<ZoneId, Zone>;
  zoneOrder: ZoneId[];
  guards: Guard[];
  fire: Fire;
  announcedAt: number | null;
  called119At: number | null;
  fireDeptArrivedAt: number | null;
  /** 煙にさらされた在館者の延べ人秒 */
  smokeExposure: number;
  log: LogEntry[];
  nextLogId: number;
  events: SimEvent[];
  nextEventId: number;
  outcome: Outcome;
}

export type GameAction =
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SET_SPEED'; speed: Speed }
  | { type: 'TICK'; seconds?: number }
  | { type: 'ASSIGN'; guardId: string; action: GuardActionType; target?: ZoneId }
  | { type: 'CALL_119' }
  | { type: 'ANNOUNCE' }
  | { type: 'RESET' };
