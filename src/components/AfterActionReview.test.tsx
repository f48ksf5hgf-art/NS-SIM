import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { evaluateRun } from '../evaluation/evaluate';
import { gameReducer } from '../game/engine';
import { SCENARIO, createInitialState } from '../game/scenario';
import type { GameAction } from '../game/types';
import { AfterActionReview } from './AfterActionReview';

function renderResult(...actions: GameAction[]) {
  const s = actions.reduce(gameReducer, gameReducer(createInitialState(), { type: 'START' }));
  const result = evaluateRun({ scenarioId: SCENARIO.id, events: s.events });
  render(
    <AfterActionReview
      result={result}
      history={[]}
      currentId={null}
      saveError={null}
      onReplay={() => {}}
      onClose={() => {}}
    />,
  );
  return { s, result };
}

describe('AAR：119番通報の評価根拠', () => {
  it('初期消火に成功して通報しなかった場合、未実施と根拠のイベントを表示する', () => {
    const { s } = renderResult(
      { type: 'ASSIGN', guardId: 'g1', action: 'extinguish', target: 'D' },
      { type: 'ANNOUNCE' },
      { type: 'TICK', seconds: 600 },
    );
    const card = screen.getByRole('region', { name: '119番通報の評価' });
    const confirmed = s.events.find((e) => e.type === 'fire_confirmed')!;
    expect(within(card).getByTestId('aar-call-verdict')).toHaveTextContent('通報未実施');
    expect(within(card).getByText(`#${confirmed.id} 14:33:10`)).toBeInTheDocument();
    expect(within(card).getByText('未実施')).toBeInTheDocument();
    expect(within(card).getByText('成功（通報とは別に評価）')).toBeInTheDocument();
    expect(within(card).getByText(/NS-SIM独自の訓練基準/)).toBeInTheDocument();
    expect(within(card).getByText(/消防法令上の通報義務/)).toBeInTheDocument();
    // 重大な安全違反として表示され、ランクは上限C
    const violations = screen.getByRole('region', { name: '重大な安全違反' });
    expect(within(violations).getByText(/火災確認後の119番通報の未実施/)).toBeInTheDocument();
    expect(screen.getByTestId('aar-rank')).toHaveTextContent('C');
  });

  it('基準時間内に通報した場合、確認から通報までの秒数を表示する', () => {
    renderResult(
      { type: 'ASSIGN', guardId: 'g1', action: 'extinguish', target: 'D' },
      { type: 'TICK', seconds: 80 },
      { type: 'CALL_119' },
      { type: 'TICK', seconds: 600 },
    );
    const card = screen.getByRole('region', { name: '119番通報の評価' });
    expect(within(card).getByTestId('aar-call-verdict')).toHaveTextContent('基準内に通報');
    expect(within(card).getByText('10秒')).toBeInTheDocument();
    expect(within(card).getByText('10/10')).toBeInTheDocument();
  });
});
