/* eslint-disable react-hooks/set-state-in-effect -- useResource намеренно синхронизирует состояние с запросом */
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Link2,
  LockKeyhole,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { formatDate, shiftDay } from '../../../shared/calendar.js';
export function useResource(path, revision = 0) {
  const [state, set] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    if (!path) {
      set({ data: null, loading: false, error: '' });
      return;
    }
    const controller = new AbortController();
    set({ data: null, loading: true, error: '' });
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) set({ data, loading: false, error: '' });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') set({ data: null, loading: false, error: e.message });
      });
    return () => controller.abort();
  }, [path, revision]);
  return state;
}
export function Failure({ message, retry }) {
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="skeleton-stack" role="status" aria-label="Загрузка данных">
      <span />
      <span />
    </div>
  );
}
export function EmptyState({ title, children, action }) {
  return (
    <div className="empty exp-empty">
      <Link2 size={30} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Metadata({ data, label }) {
  if (!data) return null;
  const source =
    data.source === 'demo'
      ? 'Демонстрационный пример'
      : data.source === 'grsu'
        ? 'Публичный API ГрГУ'
        : data.status === 'disconnected'
          ? 'Источник не подключён'
          : label || 'Данные Kupala Hub';
  return (
    <div className={`exp-source ${data.source === 'demo' ? 'is-demo' : ''}`}>
      <span className="status-dot" />
      <span>{source}</span>
      {data.fetchedAt && (
        <small>
          {data.stale ? 'сохранено' : 'обновлено'}{' '}
          {new Date(data.fetchedAt).toLocaleString('ru-RU', {
            timeZone: 'Europe/Minsk',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </small>
      )}
      {data.stale && <b>Устаревшие данные</b>}
    </div>
  );
}
export function Tabs({ items, value, onChange, label = 'Разделы' }) {
  return (
    <div className="exp-tabs" role="tablist" aria-label={label}>
      {items.map(([id, title]) => (
        <button
          role="tab"
          aria-selected={id === value}
          key={id}
          onClick={() => onChange(id)}
          className={value === id ? 'active' : ''}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
export function Disconnected({
  onDemo,
  description = 'Эти сведения хранятся в закрытых системах университета. Подключение к ним пока не настроено.',
}) {
  return (
    <section className="panel disconnected">
      <div className="disconnected-icon">
        <LockKeyhole size={27} />
      </div>
      <span className="eyebrow">Университетские данные</span>
      <h2>Источник не подключён</h2>
      <p>{description}</p>
      <div className="exp-actions">
        <button className="primary" onClick={onDemo}>
          Посмотреть пример
        </button>
        <a href="https://edu.grsu.by/" target="_blank" rel="noreferrer" className="secondary">
          Открыть портал <ArrowUpRight size={16} />
        </a>
      </div>
      <small>Пароль университета здесь не требуется. Пример содержит вымышленные сведения.</small>
    </section>
  );
}
export function DemoNotice({ onBack }) {
  return (
    <div className="exp-demo-note">
      <span>
        <b>Демо</b> Пример данных, не сведения твоего аккаунта
      </span>
      {onBack && (
        <button className="text-button" onClick={onBack}>
          Вернуться к моим данным
        </button>
      )}
    </div>
  );
}
export function WeekControl({ start, onChange }) {
  return (
    <div className="week-navigation">
      <button
        className="icon-button"
        aria-label="Предыдущая неделя"
        onClick={() => onChange(shiftDay(start, -7))}
      >
        <ChevronLeft size={18} />
      </button>
      <strong>
        {formatDate(start, { day: 'numeric', month: 'short' })} —{' '}
        {formatDate(shiftDay(start, 6), { day: 'numeric', month: 'short' })}
      </strong>
      <button
        className="icon-button"
        aria-label="Следующая неделя"
        onClick={() => onChange(shiftDay(start, 7))}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
export function Table({ headers, rows, empty = 'Записей пока нет', caption }) {
  return (
    <div className="exp-table-wrap">
      <table className="exp-table">
        <caption className="sr-only">{caption || headers.join(', ')}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th scope="col" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j}>{v ?? 'Не указано'}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="table-empty">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Dialog({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть окно">
          <X size={19} />
        </button>
      </header>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
export const displayDate = (value) =>
  value ? formatDate(value, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Не указано';
export function safeLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
