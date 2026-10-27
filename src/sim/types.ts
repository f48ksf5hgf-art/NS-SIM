/**
 * v0.3 ランダム生成シナリオの型。シナリオ01（従来版、src/game）とは独立している。
 */
import type { LogEntry, Speed } from '../game/types';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export type ZoneUse = 'lobby' | 'retail' | 'food' | 'office' | 'cinema' | 'storage' | 'parking' | 'clinic';

export type IncidentKind = 'fire' | 'earthquake' | 'casualty';

/** 防災センター（指令拠点）の所在 ID */
export const HQ = 'HQ';

export interface ZoneDef {
  id: string;
  name: string;
  use: ZoneUse;
  floor: number;
  floorLabel: string;
  /** 初期在館者数 */
  capacity: number;
  /** 階段室に面し、上下階と行き来できる区域 */
  stair: boolean;
}

export interface FloorDef {
  floor: number;
  label: string;
  /** 階段室側から順に並ぶ区域 */
  zoneIds: string[];
}

export interface Facility {
  name: string;
  /** 低い階から順 */
  floors: FloorDef[];
  zones: Record<string, ZoneDef>;
  zoneOrder: string[];
  hqFloor: number;
  /** 移動経路（区域・防災センター間の通路と所要秒数） */
  links: { from: string; to: string; seconds: number }[];
  /** 全地点間の移動秒数（HQ を含む）。経路がなければ null */
  travel: Record<string, Record<string, number | null>>;
}

export interface GuardDef {
  id: string;
  name: string;
  callSign: string;
  role: string;
  location: string;
}

/** 事件の計画（真の状況）。Expert では種類・場所・時刻をプレイヤーに知らせない */
export type IncidentPlan =
  | { id: string; kind: 'fire'; zoneId: string; startAt: number; genuine: boolean }
  | { id: string; kind: 'casualty'; zoneId: string; reportedZoneId: string; startAt: number }
  | { id: string; kind: 'earthquake'; startAt: number; damage: Record<string, 'none' | 'debris'> };

export interface DifficultyParams {
  label: string;
  floors: [number, number];
  zones: [number, number];
  guards: number;
  /** 開始画面で事件を告知するか */
  revealIncidents: boolean;
  fireInitial: number;
  fireGrowth: number;
  /** 傷病者の容体悪化（1秒あたり） */
  casualtyDecline: number;
  /** Easy〜Hard の時間基準の倍率（適応型評価で使用） */
  timeAllowance: number;
}

export interface ScenarioSpec {
  scenarioId: string;
  difficulty: Difficulty;
  seed: number;
  /** クリア可能性検証のため再生成した回数（0 なら初回で採用） */
  attempt: number;
  title: string;
  facility: Facility;
  guards: GuardDef[];
  incidents: IncidentPlan[];
  params: DifficultyParams;
  startClock: number;
  timeLimit: number;
}

// ---------------------------------------------------------------------------
// 実行時の状態

export type SimActionType = 'investigate' | 'extinguish' | 'evacuate' | 'first_aid' | 'return' | 'standby';

export interface SimTask {
  type: SimActionType;
  target: string;
  phase: 'moving' | 'working';
  /** 現フェーズの残り秒数。避難誘導・救護の作業は継続するため null */
  remaining: number | null;
}

export interface SimGuard extends GuardDef {
  task: SimTask | null;
}

export interface ZoneState {
  occupants: number;
  /** 受信盤で発報中（プレイヤーに見える情報） */
  alarm: boolean;
  /** 煙が流入しているか（真の状態） */
  smoke: boolean;
  /** 隊員が煙を確認済み */
  smokeConfirmed: boolean;
  evacuated: boolean;
  /** 地震後の安全確認済み */
  inspected: boolean;
  /** 安全確認で判明した被害 */
  damage: 'none' | 'debris' | null;
}

interface IncidentBase {
  id: string;
  startAt: number;
  status: 'pending' | 'active' | 'resolved' | 'failed';
}

export interface FireIncident extends IncidentBase {
  kind: 'fire';
  zoneId: string;
  genuine: boolean;
  intensity: number;
  confirmed: boolean;
  extinguishedBy: 'guard' | 'fire_department' | null;
  smokeSpreadAt: number | null;
  dangerNotified: boolean;
}

export interface CasualtyIncident extends IncidentBase {
  kind: 'casualty';
  zoneId: string;
  reportedZoneId: string;
  vitality: number;
  confirmed: boolean;
  misreportFound: boolean;
  handedOver: boolean;
}

export interface EarthquakeIncident extends IncidentBase {
  kind: 'earthquake';
  shakingUntil: number;
  damage: Record<string, 'none' | 'debris'>;
}

export type Incident = FireIncident | CasualtyIncident | EarthquakeIncident;

export type SimOutcome = 'resolved' | 'failed' | 'timeout';

export interface SimState {
  spec: ScenarioSpec;
  scenarioTitle: string;
  startClock: number;
  time: number;
  started: boolean;
  running: boolean;
  speed: Speed;
  zones: Record<string, ZoneState>;
  guards: SimGuard[];
  incidents: Incident[];
  calls: { fire: number | null; ambulance: number | null };
  announcements: { evacuate: number | null; shelter: number | null };
  fireDeptArrivedAt: number | null;
  ambulanceArrivedAt: number | null;
  smokeExposure: number;
  log: LogEntry[];
  nextLogId: number;
  events: SimEventV2[];
  nextEventId: number;
  outcome: SimOutcome | null;
}

// ---------------------------------------------------------------------------
// 評価用イベント（情報イベントと真の状況イベントを区別する）

export type SimEventBodyV2 =
  | { type: 'scenario_started'; scenarioId: string; difficulty: Difficulty; seed: number }
  /** 真の状況：事件の発生（プレイヤーには見えない） */
  | { type: 'incident_started'; incidentId: string; kind: IncidentKind; zoneId: string | null; genuine: boolean }
  /** 情報：受信盤・内線・揺れでプレイヤーが知った内容（区域が誤っている場合がある） */
  | {
      type: 'incident_reported';
      incidentId: string;
      kind: IncidentKind;
      source: 'detector' | 'phone' | 'quake';
      reportedZoneId: string | null;
    }
  | {
      type: 'command';
      guardId: string;
      action: SimActionType;
      target: string | null;
      travelSeconds: number;
      replaced: SimActionType | null;
      duringShaking: boolean;
    }
  | { type: 'call_119'; service: 'fire' | 'ambulance' }
  | { type: 'announcement'; mode: 'evacuate' | 'shelter' }
  | { type: 'guard_arrived'; guardId: string; location: string; action: SimActionType }
  | { type: 'guard_idle'; guardId: string; location: string }
  | { type: 'fire_confirmed'; incidentId: string; guardId: string; zoneId: string; intensity: number }
  | { type: 'false_alarm_confirmed'; incidentId: string; by: string; zoneId: string }
  | { type: 'smoke_spread'; incidentId: string; zoneIds: string[] }
  | { type: 'smoke_confirmed'; guardId: string; zoneId: string }
  | { type: 'zone_clear'; guardId: string; zoneId: string }
  | { type: 'extinguish_succeeded'; incidentId: string; guardId: string }
  | { type: 'extinguish_failed'; incidentId: string; guardId: string; intensity: number }
  | { type: 'fire_danger'; incidentId: string; intensity: number }
  | { type: 'shaking_started'; incidentId: string }
  | { type: 'shaking_ended'; incidentId: string }
  | { type: 'zone_inspected'; incidentId: string; guardId: string; zoneId: string; damage: 'none' | 'debris' }
  | { type: 'casualty_confirmed'; incidentId: string; guardId: string; zoneId: string; vitality: number }
  | { type: 'misreport_found'; incidentId: string; guardId: string; reportedZoneId: string; actualZoneId: string }
  | { type: 'first_aid_started'; incidentId: string; guardId: string }
  | { type: 'casualty_deteriorated'; incidentId: string }
  | { type: 'ambulance_arrived' }
  | { type: 'casualty_handed_over'; incidentId: string; withGuard: boolean }
  | { type: 'zone_evacuated'; zoneId: string }
  | { type: 'fire_dept_arrived' }
  | { type: 'fire_dept_extinguished'; incidentId: string }
  | { type: 'incident_resolved'; incidentId: string; kind: IncidentKind }
  | { type: 'incident_failed'; incidentId: string; kind: IncidentKind; reason: string }
  | {
      type: 'scenario_ended';
      outcome: SimOutcome;
      smokeExposure: number;
      zones: { id: string; occupants: number; capacity: number; smoke: boolean }[];
      incidents: { id: string; kind: IncidentKind; status: Incident['status']; genuine: boolean }[];
    };

export type SimEventV2 = SimEventBodyV2 & { id: number; time: number; logId: number | null };

export type SimAction =
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SET_SPEED'; speed: Speed }
  | { type: 'TICK'; seconds?: number }
  | { type: 'ASSIGN'; guardId: string; action: SimActionType; target?: string }
  | { type: 'CALL_119'; service: 'fire' | 'ambulance' }
  | { type: 'ANNOUNCE'; mode: 'evacuate' | 'shelter' }
  | { type: 'RESET' };
