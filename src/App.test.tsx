import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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
});
