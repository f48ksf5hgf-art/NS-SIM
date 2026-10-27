import type { Dispatch } from 'react';
import { SCENARIO } from '../game/scenario';
import type { GameAction } from '../game/types';

export function Briefing({ dispatch }: { dispatch: Dispatch<GameAction> }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <div className="dialog">
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
      </div>
    </div>
  );
}
