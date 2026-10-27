import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { evaluateRun } from '../evaluation/evaluate';
import { HISTORY_KEY } from '../evaluation/storage';
import { gameReducer } from '../game/engine';
import { SCENARIO, createInitialState } from '../game/scenario';
import type { GameAction } from '../game/types';
import { createScenario } from '../sim/bot';
import { AfterActionReview } from './AfterActionReview';

describe('v0.3 画面', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openGenerated(user: ReturnType<typeof userEvent.setup>, difficulty: string, seed: number) {
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'ランダム生成（v0.3）' }));
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${difficulty}`) }));
    await user.type(screen.getByRole('textbox', { name: /シード/ }), String(seed));
    await user.click(screen.getByRole('button', { name: '生成して開始' }));
  }

  it('開始画面はシナリオ01が既定で、ランダム生成に切り替えられる', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(screen.getByRole('dialog', { name: /自動火災報知設備/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ランダム生成（v0.3）' }));
    const dialog = screen.getByRole('dialog', { name: 'ランダム生成シナリオ' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(4);
    await user.type(screen.getByRole('textbox', { name: /シード/ }), 'abc');
    expect(screen.getByRole('button', { name: '生成して開始' })).toBeDisabled();
  });

  it('Expert：シードを指定して生成し、通常勤務から開始する（事案は非公開）', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const spec = createScenario('expert', 12345);
    await openGenerated(user, 'Expert', 12345);
    const briefing = screen.getByRole('dialog', { name: spec.facility.name });
    expect(within(briefing).getByText(/EXPERT · SEED 12345/)).toBeInTheDocument();
    expect(within(briefing).getByText(/種類・場所・時刻は知らされていません/)).toBeInTheDocument();
    await user.click(within(briefing).getByRole('button', { name: '状況開始' }));
    expect(screen.getByText('異常なし（通常勤務中）')).toBeInTheDocument();
    // 施設の全区域が地図に表示される
    for (const id of spec.facility.zoneOrder) {
      expect(screen.getByRole('button', { name: new RegExp(`^${id}区域 `) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('radio', { name: /警備\d/ })).toHaveLength(spec.guards.length);
  });

  it('Easy：最後までプレイすると評価画面に難易度・シード・評価方式が表示され、履歴に保存される', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openGenerated(user, 'Easy', 42);
    await user.click(screen.getByRole('button', { name: '状況開始' }));
    await user.click(screen.getByRole('button', { name: '×4' }));
    await act(async () => {
      vi.advanceTimersByTime(260_000);
    });
    const aar = screen.getByRole('dialog', { name: '訓練結果' });
    expect(within(aar).getByText(/EASY · SEED 42/)).toBeInTheDocument();
    expect(within(aar).getByText('適応型')).toBeInTheDocument();
    expect(within(aar).getByRole('heading', { name: '発生した事案（実際の状況）' })).toBeInTheDocument();
    expect(within(aar).getByRole('heading', { name: /補助指標/ })).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
    expect(saved[0].result).toMatchObject({ mode: 'generated', difficulty: 'easy', seed: 42 });

    // 同じシードで再挑戦できる
    await user.click(within(aar).getByRole('button', { name: 'もう一度挑戦' }));
    expect(screen.getByRole('dialog', { name: createScenario('easy', 42).facility.name })).toBeInTheDocument();
    // モード選択へ戻ると、シナリオ01も引き続きプレイできる
    await user.click(screen.getByRole('button', { name: 'モード選択に戻る' }));
    expect(screen.getByRole('dialog', { name: /自動火災報知設備/ })).toBeInTheDocument();
  });
});

describe('AAR：評価項目から関連ログへの移動', () => {
  it('評価根拠のイベントを押すと詳細ログタブへ移り、該当行を強調する', async () => {
    const user = userEvent.setup();
    const actions: GameAction[] = [
      { type: 'START' },
      { type: 'ASSIGN', guardId: 'g1', action: 'extinguish', target: 'D' },
      { type: 'ANNOUNCE' },
      { type: 'TICK', seconds: 600 },
    ];
    const s = actions.reduce(gameReducer, createInitialState());
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
    const violation = screen.getByRole('region', { name: '重大な安全違反' });
    const link = within(violation).getAllByRole('button', { name: /詳細ログの #\d+/ })[0];
    const eventId = Number(link.textContent!.match(/#(\d+)/)![1]);
    await user.click(link);
    expect(screen.getByRole('tab', { name: '詳細ログ' })).toHaveAttribute('aria-selected', 'true');
    const row = document.getElementById(`aar-ev-${eventId}`)!;
    expect(row).toHaveClass('is-target');
    expect(row).toHaveTextContent('V3');
  });

  it('タブは左右キーで切り替えられる', async () => {
    const user = userEvent.setup();
    const s = [{ type: 'START' } as GameAction, { type: 'TICK', seconds: 2000 } as GameAction].reduce(
      gameReducer,
      createInitialState(),
    );
    render(
      <AfterActionReview
        result={evaluateRun({ scenarioId: SCENARIO.id, events: s.events })}
        history={[]}
        currentId={null}
        saveError={null}
        onReplay={() => {}}
        onClose={() => {}}
      />,
    );
    screen.getByRole('tab', { name: '総合評価' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /^改善点/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: '詳細ログ' })).toHaveAttribute('aria-selected', 'true');
  });
});
