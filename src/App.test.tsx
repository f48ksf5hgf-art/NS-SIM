import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { HISTORY_KEY } from './evaluation/storage';

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ブリーフィングから状況を開始し、指示とログが機能する', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    expect(screen.getByRole('dialog', { name: /自動火災報知設備/ })).toBeInTheDocument();
    expect(screen.getByTestId('clock')).toHaveTextContent('14:32:00');

    await user.click(screen.getByRole('button', { name: '状況開始' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const log = screen.getByRole('region', { name: '時系列ログ' });
    expect(within(log).getByText(/自動火災報知設備 発報（第1報）/)).toBeInTheDocument();

    // 6区域が表示される
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${id}区域`) })).toBeInTheDocument();
    }

    // 警備1 → 現場確認 → D区域
    await user.click(screen.getByRole('radio', { name: /警備1 田中/ }));
    await user.click(screen.getByRole('button', { name: '現場確認' }));
    await user.click(screen.getByRole('button', { name: /^D 2F 倉庫/ }));
    await user.click(screen.getByRole('button', { name: /指示を送信/ }));
    expect(within(log).getByText(/指令→警備1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '☎ 119番通報' }));
    expect(screen.getByRole('button', { name: '✓ 119番通報済' })).toBeDisabled();

    // 時間経過
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('clock')).not.toHaveTextContent('14:32:00');
  });

  async function playToEnd(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: '状況開始' }));
    await user.click(screen.getByRole('button', { name: '×4' }));
    await user.click(screen.getByRole('radio', { name: /警備1 田中/ }));
    await user.click(screen.getByRole('button', { name: '初期消火' }));
    await user.click(screen.getByRole('button', { name: /^D 2F 倉庫/ }));
    await user.click(screen.getByRole('button', { name: /指示を送信/ }));
    await user.click(screen.getByRole('button', { name: '☎ 119番通報' }));
    await user.click(screen.getByRole('button', { name: '📢 非常放送（全館避難）' }));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
  }

  it('状況終了後に訓練結果（AAR）を表示・保存し、再プレイできる', async () => {
    localStorage.clear();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await playToEnd(user);

    const aar = screen.getByRole('dialog', { name: '訓練結果' });
    expect(within(aar).getByTestId('aar-score')).toHaveTextContent(/^\d+$/);
    expect(within(aar).getByTestId('aar-rank')).toHaveTextContent('S');
    // v0.3：総合評価・改善点・詳細ログの3タブに分けて表示する
    const sections: Record<string, string[]> = {
      総合評価: ['項目別スコア', '重大な安全違反'],
      改善点: ['良かった判断', '改善が必要な判断', '次回の改善目標'],
      詳細ログ: ['主要イベントの時系列', '評価根拠一覧'],
    };
    for (const [tabName, headings] of Object.entries(sections)) {
      await user.click(within(aar).getByRole('tab', { name: new RegExp(`^${tabName}`) }));
      for (const name of headings) expect(within(aar).getByRole('heading', { name })).toBeInTheDocument();
    }
    await user.click(within(aar).getByRole('tab', { name: '総合評価' }));
    expect(within(aar).getAllByRole('meter')).toHaveLength(5);
    expect(within(aar).getAllByText('鎮火（警備員の初期消火）').length).toBeGreaterThanOrEqual(1);
    expect(within(aar).queryByRole('alert')).not.toBeInTheDocument();

    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
    expect(saved).toHaveLength(1);

    // ログ確認 → 結果の再表示
    await user.click(within(aar).getByRole('button', { name: 'ログを確認する' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '訓練結果を表示' }));
    expect(screen.getByRole('dialog', { name: '訓練結果' })).toBeInTheDocument();

    // 再プレイ：ブリーフィングに戻り、2回目は前回と比較できる
    await user.click(screen.getByRole('button', { name: 'もう一度挑戦' }));
    expect(screen.getByRole('dialog', { name: /自動火災報知設備/ })).toBeInTheDocument();
    expect(screen.getByTestId('clock')).toHaveTextContent('14:32:00');
    await playToEnd(user);
    expect(screen.getByText(/前回/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toHaveLength(2);
  });

  it('履歴の保存に失敗した場合は警告を表示する', async () => {
    localStorage.clear();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App />);
      await playToEnd(user);
      const aar = screen.getByRole('dialog', { name: '訓練結果' });
      expect(within(aar).getByRole('alert')).toHaveTextContent('訓練結果を保存できませんでした');
      // 保存に失敗しても評価結果は表示される
      expect(within(aar).getByTestId('aar-rank')).toHaveTextContent('S');
    } finally {
      spy.mockRestore();
    }
  });
});
