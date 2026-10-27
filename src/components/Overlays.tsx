import { useState, type Dispatch } from 'react';
import { SCENARIO } from '../game/scenario';
import type { GameAction } from '../game/types';
import { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS, DIFFICULTY_ORDER } from '../sim/difficulty';
import { parseSeed } from '../sim/rng';
import type { Difficulty } from '../sim/types';

interface BriefingProps {
  dispatch: Dispatch<GameAction>;
  /** ランダム生成シナリオを開始する（シード未指定なら新規） */
  onStartGenerated?: (difficulty: Difficulty, seed: number | null) => void;
}

export function Briefing({ dispatch, onStartGenerated }: BriefingProps) {
  const [mode, setMode] = useState<'classic' | 'generated'>('classic');
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [seedText, setSeedText] = useState('');
  const seed = seedText.trim() === '' ? null : parseSeed(seedText);
  const seedInvalid = seedText.trim() !== '' && seed === null;

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={mode === 'classic' ? 'briefing-title' : 'generated-title'}
    >
      <div className="dialog">
        {onStartGenerated && (
          <div className="mode-switch" role="group" aria-label="モード">
            <button
              type="button"
              className={`mode-switch__btn ${mode === 'classic' ? 'is-active' : ''}`}
              aria-pressed={mode === 'classic'}
              onClick={() => setMode('classic')}
            >
              シナリオ01（従来版）
            </button>
            <button
              type="button"
              className={`mode-switch__btn ${mode === 'generated' ? 'is-active' : ''}`}
              aria-pressed={mode === 'generated'}
              onClick={() => setMode('generated')}
            >
              ランダム生成（v0.3）
            </button>
          </div>
        )}

        {mode === 'classic' ? (
          <>
            <p className="dialog__eyebrow">SCENARIO 01</p>
            <h2 id="briefing-title" className="dialog__title">
              {SCENARIO.title}
            </h2>
            <p>
              平日 14:32、{SCENARIO.facilityName}
              の防災センター受信盤が発報しました。あなたは防災センターの指令担当として、警備員3名に指示を出し事態に対応してください。
            </p>
            <ul className="dialog__list">
              <li>警備員を選び、指示と対象区域を選んで送信します</li>
              <li>119番通報・非常放送は防災センターから実施できます</li>
              <li>時間は自動で進行します（×1〜×4、一時停止可）</li>
              <li>経過はすべて時系列ログに記録されます</li>
            </ul>
            <button type="button" className="btn btn--primary btn--block" onClick={() => dispatch({ type: 'START' })}>
              状況開始
            </button>
          </>
        ) : (
          <>
            <p className="dialog__eyebrow">RANDOM SCENARIO</p>
            <h2 id="generated-title" className="dialog__title">
              ランダム生成シナリオ
            </h2>
            <p>難易度に応じて施設と事案（火災・地震・傷病者）を生成します。すべて架空の施設・訓練データです。</p>
            <div className="difficulty-list" role="radiogroup" aria-label="難易度">
              {DIFFICULTY_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === d}
                  className={`difficulty ${difficulty === d ? 'is-selected' : ''} difficulty--${d}`}
                  onClick={() => setDifficulty(d)}
                >
                  <span className="difficulty__name">{DIFFICULTIES[d].label}</span>
                  <span className="difficulty__desc">{DIFFICULTY_DESCRIPTIONS[d]}</span>
                  <span className="difficulty__meta mono">
                    {DIFFICULTIES[d].floors.join('〜')}フロア・{DIFFICULTIES[d].zones.join('〜')}区域・隊員
                    {DIFFICULTIES[d].guards}名
                  </span>
                </button>
              ))}
            </div>
            <label className="seed-field">
              <span>シード（任意・同じ施設と事案を再現）</span>
              <input
                className="seed-field__input mono"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="空欄なら新しく生成"
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                aria-invalid={seedInvalid}
              />
              {seedInvalid && <span className="seed-field__error">0〜4294967295 の数字で入力してください</span>}
            </label>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={seedInvalid}
              onClick={() => onStartGenerated?.(difficulty, seed)}
            >
              生成して開始
            </button>
          </>
        )}
      </div>
    </div>
  );
}
