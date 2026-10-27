import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateScenario } from '../../sim/scenario';
import type { ScenarioSpec } from '../../sim/types';
import { GeneratedGame } from './GeneratedGame';

const base = generateScenario('hard', 2024);
const floor = base.facility.floors.find((f) => f.zoneIds.length >= 2)!;
const [fireZone, casualtyZone] = floor.zoneIds;
const spec: ScenarioSpec = {
  ...base,
  incidents: [
    { id: 'fire-1', kind: 'fire', zoneId: fireZone, startAt: 0, genuine: true },
    { id: 'casualty-2', kind: 'casualty', zoneId: casualtyZone, reportedZoneId: casualtyZone, startAt: 0 },
  ],
};
const [g1, g2] = spec.guards;

function setup() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<GeneratedGame spec={spec} onNewScenario={() => {}} onExit={() => {}} />);
  return user;
}

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '状況開始' }));
  // 時間経過で状態が変わらないよう一時停止して操作する
  await user.click(screen.getByRole('button', { name: '一時停止' }));
}

const zoneButton = (id: string) => screen.getByRole('button', { name: new RegExp(`^${id}区域 `) });
const logText = () => screen.getByRole('region', { name: '時系列ログ' }).textContent ?? '';

describe('v0.4 マップ直接指示', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('区域をタップすると、その区域を選択した指示シートが開き、隊員の現在地・任務・到着時間を表示する', async () => {
    const user = setup();
    await start(user);
    await user.click(zoneButton(fireZone));
    const sheet = screen.getByRole('dialog', { name: `${fireZone}区域への指示` });
    const guards = within(sheet).getAllByRole('radio');
    expect(guards).toHaveLength(spec.guards.length);
    const first = guards[0];
    expect(first).toHaveTextContent(`${g1.callSign} ${g1.name}`);
    expect(first).toHaveTextContent('現在地：防災センター');
    expect(first).toHaveTextContent('任務：なし（待機中）');
    expect(first).toHaveTextContent(`約${spec.facility.travel[g1.location][fireZone]}秒`);
    expect(within(sheet).getByRole('button', { name: '隊員と任務を選択' })).toBeDisabled();
  });

  it('区域 → 隊員 → 任務 → 送信で指示され、シートが閉じてモニターに戻る', async () => {
    const user = setup();
    await start(user);
    await user.click(zoneButton(fireZone));
    const sheet = screen.getByRole('dialog', { name: `${fireZone}区域への指示` });
    await user.click(within(sheet).getByRole('radio', { name: new RegExp(g1.callSign) }));
    await user.click(within(sheet).getByRole('button', { name: '現場確認' }));
    await user.click(
      within(sheet).getByRole('button', { name: new RegExp(`${g1.callSign} → ${fireZone}区域：現場確認`) }),
    );
    expect(screen.queryByRole('dialog', { name: /区域への指示/ })).not.toBeInTheDocument();
    expect(logText()).toContain(`指令→${g1.callSign}`);
    expect(document.querySelector('.layout')).toHaveAttribute('data-tab', 'map');
  });

  it('任務中の隊員へ指示すると上書きの確認を求め、戻るを選ぶと元の任務を維持する', async () => {
    const user = setup();
    await start(user);
    // 警備2を火災区域へ
    await user.click(zoneButton(fireZone));
    let sheet = screen.getByRole('dialog', { name: `${fireZone}区域への指示` });
    await user.click(within(sheet).getByRole('radio', { name: new RegExp(g2.callSign) }));
    await user.click(within(sheet).getByRole('button', { name: '初期消火' }));
    await user.click(within(sheet).getByRole('button', { name: new RegExp(`${g2.callSign} →`) }));
    const commandsBefore = (logText().match(/指令→/g) ?? []).length;

    // 同じ隊員を傷病者の区域へ → 確認
    await user.click(zoneButton(casualtyZone));
    sheet = screen.getByRole('dialog', { name: `${casualtyZone}区域への指示` });
    const busy = within(sheet).getByRole('radio', { name: new RegExp(g2.callSign) });
    expect(busy).toHaveTextContent('任務中');
    expect(busy).toHaveTextContent('初期消火');
    await user.click(busy);
    await user.click(within(sheet).getByRole('button', { name: '救護' }));
    await user.click(within(sheet).getByRole('button', { name: new RegExp(`${g2.callSign} →`) }));
    const confirm = within(sheet).getByRole('alertdialog');
    expect(confirm).toHaveTextContent(`${g2.callSign}は現在`);
    expect(confirm).toHaveTextContent('この任務を中止して');
    await user.click(within(confirm).getByRole('button', { name: '戻る' }));
    expect((logText().match(/指令→/g) ?? []).length).toBe(commandsBefore);

    // 上書きして送信
    await user.click(within(sheet).getByRole('button', { name: new RegExp(`${g2.callSign} →`) }));
    await user.click(within(sheet).getByRole('button', { name: '上書きして送信' }));
    expect((logText().match(/指令→/g) ?? []).length).toBe(commandsBefore + 1);
    expect(screen.queryByRole('dialog', { name: /区域への指示/ })).not.toBeInTheDocument();
  });

  it('待機中の隊員への指示は確認なしで送信する', async () => {
    const user = setup();
    await start(user);
    await user.click(zoneButton(casualtyZone));
    const sheet = screen.getByRole('dialog', { name: `${casualtyZone}区域への指示` });
    await user.click(within(sheet).getByRole('radio', { name: new RegExp(g1.callSign) }));
    await user.click(within(sheet).getByRole('button', { name: '救護' }));
    await user.click(within(sheet).getByRole('button', { name: new RegExp(`${g1.callSign} →`) }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(logText()).toContain(`指令→${g1.callSign}`);
  });

  it('Esc・背景のタップでシートを閉じられ、時間が進んでも開いたまま操作できる', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: '状況開始' }));
    await user.click(zoneButton(fireZone));
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('dialog', { name: `${fireZone}区域への指示` })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /区域への指示/ })).not.toBeInTheDocument();
    await user.click(zoneButton(fireZone));
    await user.click(document.querySelector('.sheet-backdrop')!);
    expect(screen.queryByRole('dialog', { name: /区域への指示/ })).not.toBeInTheDocument();
  });

  it('従来の指示画面からも指示できる', async () => {
    const user = setup();
    await start(user);
    const panel = screen.getByRole('region', { name: '警備員・指示' });
    await user.click(within(panel).getByRole('radio', { name: new RegExp(g1.callSign) }));
    await user.click(within(panel).getByRole('button', { name: '現場確認' }));
    await user.click(within(panel).getByRole('button', { name: new RegExp(`^${fireZone} `) }));
    await user.click(within(panel).getByRole('button', { name: /指示を送信/ }));
    expect(logText()).toContain(`指令→${g1.callSign}`);
  });
});
