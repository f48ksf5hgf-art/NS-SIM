import type { Difficulty, DifficultyParams } from './types';

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

export const DIFFICULTIES: Record<Difficulty, DifficultyParams> = {
  easy: {
    label: 'Easy',
    floors: [2, 3],
    zones: [4, 6],
    guards: 3,
    revealIncidents: true,
    fireInitial: 12,
    fireGrowth: 0.1,
    casualtyDecline: 0.15,
    timeAllowance: 1.5,
  },
  normal: {
    label: 'Normal',
    floors: [3, 4],
    zones: [6, 9],
    guards: 4,
    revealIncidents: true,
    fireInitial: 15,
    fireGrowth: 0.13,
    casualtyDecline: 0.2,
    timeAllowance: 1.25,
  },
  hard: {
    label: 'Hard',
    floors: [4, 5],
    zones: [9, 12],
    guards: 5,
    revealIncidents: false,
    fireInitial: 15,
    fireGrowth: 0.15,
    casualtyDecline: 0.25,
    timeAllowance: 1.1,
  },
  expert: {
    label: 'Expert',
    floors: [5, 6],
    zones: [12, 16],
    guards: 6,
    revealIncidents: false,
    fireInitial: 15,
    fireGrowth: 0.15,
    casualtyDecline: 0.25,
    timeAllowance: 1,
  },
};

export const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, string> = {
  easy: '小規模施設・事案1件・発生内容を事前告知',
  normal: '中規模施設・事案1〜2件',
  hard: '大規模施設・事案2〜3件（同時発生あり）',
  expert: '通常勤務から開始・事案は非公開・誤報や誤った通報あり',
};

/** 共通の物理パラメータ（秒） */
export const SIM_CONSTANTS = {
  startClock: 10 * 3600 + 5 * 60,
  timeLimit: 900,
  investigateSeconds: 20,
  extinguishSeconds: 40,
  extinguishLimit: 50,
  smokeSpreadThreshold: 45,
  dangerThreshold: 80,
  fireDeptResponse: 300,
  fireDeptExtinguish: 60,
  ambulanceResponse: 240,
  /** 隊員が付き添っていない場合、救急隊が傷病者を見つけるまでの追加秒数 */
  ambulanceSearch: 60,
  /** 救護中の容体悪化（1秒あたり） */
  casualtyDeclineWithAid: 0.05,
  shakeSeconds: 20,
  evacuationAnnouncementRate: 3,
  evacuationGuideRate: 6,
  /** 同一階の隣接区域間・防災センター出入りの移動秒数 */
  corridorSeconds: 15,
  /** 1階分の階段移動秒数 */
  stairSeconds: 40,
  /** 移動開始の準備秒数 */
  departSeconds: 15,
} as const;
