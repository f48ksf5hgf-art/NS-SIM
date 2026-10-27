import { useId, useState } from 'react';
import { HIGHLIGHT_SECONDS } from '../../sim/selectors';
import { PLAYER_PRIORITY_LABELS, TASK_STATUS_LABELS, type BoardTask, type PlayerPriority } from '../../sim/tasks';
import { IncidentIcon } from './IncidentIcon';

interface Props {
  tasks: BoardTask[];
  time: number;
  /** タスクの区域で指示操作を開く */
  onOpen: (zoneId: string) => void;
  onPriority: (id: string, priority: PlayerPriority) => void;
  onManualDone: (id: string, done: boolean) => void;
}

const NEXT_PRIORITY: Record<PlayerPriority, PlayerPriority> = { normal: 'high', high: 'low', low: 'normal' };

function isPhone(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 720px)').matches;
  } catch {
    return false;
  }
}

/** モニター上部の折りたたみ式タスクボード（表示の整理のみ。評価には影響しない） */
export function TaskBoard({ tasks, time, onOpen, onPriority, onManualDone }: Props) {
  // iPhone ではマップを圧迫しないよう、最上位のタスクだけを表示した状態から始める
  const [open, setOpen] = useState(() => !isPhone());
  const listId = useId();
  const openTasks = tasks.filter((t) => t.status !== 'done' && !t.manualDone);
  const todo = openTasks.filter((t) => t.status === 'todo').length;
  const top = openTasks[0];

  return (
    <section className="taskboard" aria-label="タスクボード">
      <button
        type="button"
        className="taskboard__toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <span className="taskboard__heading">タスク</span>
        <span className="taskboard__counts mono">
          {openTasks.length}件{todo > 0 && <span className="taskboard__todo">未着手{todo}</span>}
        </span>
        {!open && (
          <span className="taskboard__peek">
            {top ? `${top.place}：${top.title}` : tasks.length ? 'すべて完了' : '異常なし（通常勤務中）'}
          </span>
        )}
        <span className="taskboard__chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div id={listId}>
          {tasks.length === 0 ? (
            <p className="taskboard__empty">異常なし（通常勤務中）</p>
          ) : (
            <ol className="taskboard__list">
              {tasks.map((t) => {
                const done = t.status === 'done' || t.manualDone;
                const fresh = !done && time - t.since < HIGHLIGHT_SECONDS;
                const statusLabel = t.manualDone && t.status !== 'done' ? '完了（手動）' : TASK_STATUS_LABELS[t.status];
                return (
                  <li
                    key={t.id}
                    className={`task task--${t.manualDone ? 'manual' : t.status} ${fresh ? 'is-new' : ''} ${t.confirmed ? '' : 'is-unconfirmed'}`}
                  >
                    <button
                      type="button"
                      className="task__main"
                      onClick={() => t.zoneId && onOpen(t.zoneId)}
                      disabled={!t.zoneId || done}
                      aria-label={`${t.place} ${t.title} ${statusLabel}${t.zoneId && !done ? '（タップで指示）' : ''}`}
                    >
                      <span className="task__icon">
                        <IncidentIcon kind={t.kind === 'smoke' ? 'fire' : t.kind} size={18} />
                      </span>
                      <span className="task__body">
                        <span className="task__title">
                          <span className="task__place mono">{t.place}</span>
                          {t.title}
                        </span>
                        <span className="task__detail">
                          {t.detail}
                          {t.assignees.length > 0 && (
                            <span className="task__assignees">担当：{t.assignees.join('・')}</span>
                          )}
                        </span>
                      </span>
                      <span className={`task__status task__status--${t.manualDone ? 'manual' : t.status}`}>
                        {statusLabel}
                        {t.statusNote && !t.manualDone && <span className="task__note">{t.statusNote}</span>}
                        {t.manualDone && t.status !== 'done' && (
                          <span className="task__note">事案は未収束の可能性</span>
                        )}
                      </span>
                    </button>
                    {t.status !== 'done' && (
                      <div className="task__tools">
                        <button
                          type="button"
                          className={`task__tool task__tool--${t.priority}`}
                          onClick={() => onPriority(t.id, NEXT_PRIORITY[t.priority])}
                          aria-label={`優先度：${PLAYER_PRIORITY_LABELS[t.priority]}（タップで変更）`}
                        >
                          優先 {PLAYER_PRIORITY_LABELS[t.priority]}
                        </button>
                        <button
                          type="button"
                          className="task__tool"
                          aria-pressed={t.manualDone}
                          onClick={() => onManualDone(t.id, !t.manualDone)}
                        >
                          {t.manualDone ? '戻す' : '完了'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="taskboard__note">
            並び順は目安（評価基準ではありません）。「完了」は表示の整理のみで、事案の収束・評価は変わりません。
          </p>
        </div>
      )}
    </section>
  );
}
