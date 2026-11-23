/* eslint-disable react-hooks/set-state-in-effect -- загрузка данных намеренно выполняется в эффектах; переход на паттерны React Compiler вне рамок этой задачи */
import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckSquare,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  Settings,
  LogOut,
  User,
  Search,
  Check,
  X,
  MapPin,
  Clock,
  Download,
  AlertCircle,
  Bell,
  GraduationCap,
  Trash2,
  Pencil,
  ArrowRight,
} from 'lucide-react';
import { api, setCsrf, downloadCalendar } from './api.js';
import {
  todayInMinsk,
  weekStart,
  weekDays,
  shiftDay,
  formatDate,
  selectLessons,
  dayGaps,
  lessonStatus,
  minskMinutes,
  minutes,
} from '../../shared/calendar.js';
import { ExpandedNav, ExpandedPage, pageInfo } from './expansion/index.jsx';
import './expansion.css';
const initialSettings = {
  mode: 'live',
  departmentId: '2',
  facultyId: '3',
  course: 2,
  groupId: '',
  groupTitle: '',
  subgroups: [],
};
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}
function ErrorNotice({ message, onRetry }) {
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {onRetry && (
        <button className="text-button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}
function Empty({ icon: Icon = CalendarDays, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={onClose}
      aria-labelledby="dialog-title"
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Закрыть окно" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Source({ data, mode }) {
  if (mode === 'demo') return <span className="source demo">Демонстрационные данные</span>;
  if (!data) return <span className="source">API ГрГУ</span>;
  return (
    <span className={`source ${data.stale ? 'stale' : ''}`}>
      {data.stale ? 'Сохранено' : 'Обновлено'}{' '}
      {new Date(data.fetchedAt).toLocaleString('ru-RU', {
        timeZone: 'Europe/Minsk',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}{' '}
      · ГрГУ
    </span>
  );
}

function GroupPicker({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ ...initialSettings, ...settings, mode: 'live' }),
    [departments, setDepartments] = useState([]),
    [faculties, setFaculties] = useState([]),
    [groups, setGroups] = useState([]),
    [loading, setLoading] = useState(true),
    [groupsLoading, setGroupsLoading] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      api('/catalog/departments', { signal: controller.signal }),
      api('/catalog/faculties', { signal: controller.signal }),
    ])
      .then(([a, b]) => {
        setDepartments(a.items);
        setFaculties(b.items);
        if (a.stale || b.stale)
          setError('Показан сохранённый справочник. Актуальность групп может измениться.');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (loading || !departments.length || !faculties.length) return;
    const controller = new AbortController();
    setGroupsLoading(true);
    setGroups([]);
    api(
      `/catalog/groups?departmentId=${form.departmentId}&facultyId=${form.facultyId}&course=${form.course}`,
      { signal: controller.signal },
    )
      .then((d) => {
        setGroups(d.items);
        if (d.stale) setError('Список групп загружен из сохранённой версии.');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setGroupsLoading(false);
      });
    return () => controller.abort();
  }, [loading, departments, faculties, form.departmentId, form.facultyId, form.course, retry]);
  async function save(demo = false) {
    setBusy(true);
    setError('');
    try {
      const group = groups.find((g) => g.id === form.groupId);
      if (!demo && !group) throw Error('Выберите группу из списка.');
      await onSave(
        demo
          ? { ...initialSettings, mode: 'demo', groupId: 'demo', groupTitle: 'ПО-22 · демо' }
          : { ...form, mode: 'live', groupTitle: group.title, subgroups: [] },
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={settings.groupId ? 'Учебная группа' : 'Добро пожаловать в Kupala Hub'}
      onClose={onClose}
    >
      <div className="modal-content">
        <div className="intro-mark">
          <GraduationCap size={26} />
        </div>
        <p className="intro-copy">
          Выбери свою группу — и расписание будет рядом с личными задачами. Пароль университета не
          нужен.
        </p>
        {error && <ErrorNotice message={error} onRetry={() => setRetry((x) => x + 1)} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset disabled={loading || busy}>
            <label>
              Форма обучения
              <select
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value, groupId: '' })}
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Факультет
              <select
                value={form.facultyId}
                onChange={(e) => setForm({ ...form, facultyId: e.target.value, groupId: '' })}
              >
                {faculties.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Курс
                <select
                  value={form.course}
                  onChange={(e) =>
                    setForm({ ...form, course: Number(e.target.value), groupId: '' })
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((c) => (
                    <option key={c} value={c}>
                      {c} курс
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Группа
                <select
                  value={groups.some((g) => g.id === form.groupId) ? form.groupId : ''}
                  disabled={groupsLoading}
                  onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                >
                  <option value="">{groupsLoading ? 'Загрузка…' : 'Выбрать группу'}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!groupsLoading && !loading && groups.length === 0 && departments.length > 0 && (
              <p className="muted">
                Для этого сочетания группы не найдены. Выбери другой курс или факультет.
              </p>
            )}
            <button
              className="primary full"
              disabled={!groups.some((g) => g.id === form.groupId) || groupsLoading || busy}
            >
              {busy ? 'Сохраняем…' : 'Открыть мой день'}
              <ArrowRight size={17} />
            </button>
          </fieldset>
        </form>
        <div className="divider">
          <span>или</span>
        </div>
        <button className="secondary full" disabled={busy} onClick={() => save(true)}>
          Посмотреть демо
        </button>
        <p className="form-note">
          Демо — отдельное пространство с примером расписания. Его задачи не смешиваются с
          реальными.
        </p>
      </div>
    </Modal>
  );
}

function Account({ session, onSession, onClose }) {
  const [tab, setTab] = useState('register'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const body = { email: f.get('email'), password: f.get('password') };
      if (tab === 'register') body.name = f.get('name');
      const d = await api('/auth/' + tab, { method: 'POST', body });
      onSession(d);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Твой аккаунт" onClose={onClose}>
      <div className="modal-content">
        <div className="segmented">
          <button
            className={tab === 'register' ? 'active' : ''}
            onClick={() => {
              setTab('register');
              setError('');
            }}
          >
            Создать аккаунт
          </button>
          <button
            className={tab === 'login' ? 'active' : ''}
            onClick={() => {
              setTab('login');
              setError('');
            }}
          >
            Войти
          </button>
        </div>
        <p className="intro-copy">
          {tab === 'register'
            ? 'Сохрани задачи этого браузера в аккаунте и открывай их с другого компьютера.'
            : 'После входа откроются задачи выбранного аккаунта. Гостевые задачи автоматически не переносятся.'}
        </p>
        <p className="form-note">
          Это отдельный аккаунт Kupala Hub. Используй новый пароль, а не пароль портала ГрГУ.
        </p>
        {error && <ErrorNotice message={error} />}
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {tab === 'register' && (
              <label>
                Имя
                <input
                  name="name"
                  autoComplete="given-name"
                  required
                  maxLength={80}
                  defaultValue={session.name === 'Студент' ? '' : session.name}
                />
              </label>
            )}
            <label>
              Email
              <input type="email" name="email" autoComplete="email" required maxLength={254} />
            </label>
            <label>
              Пароль
              <input
                type="password"
                name="password"
                autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={tab === 'register' ? 10 : 1}
                maxLength={128}
              />
            </label>
            {tab === 'register' && (
              <p className="form-note">
                Не менее 10 символов. Восстановление пароля по почте в локальной версии пока
                недоступно.
              </p>
            )}
            <button className="primary full">
              {busy ? 'Подождите…' : tab === 'register' ? 'Создать аккаунт' : 'Войти'}
            </button>
          </fieldset>
        </form>
      </div>
    </Modal>
  );
}

function TaskEditor({ task, onSave, onDelete, onClose, subjects = [], date }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await onSave(
        {
          title: f.get('title'),
          subject: f.get('subject'),
          notes: f.get('notes'),
          dueDate: f.get('dueDate'),
          planDate: f.get('planDate'),
          priority: f.get('priority'),
        },
        task?.id,
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await onDelete(task.id);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={task?.id ? 'Редактировать задачу' : 'Новая задача'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-content">
        {error && <ErrorNotice message={error} />}
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <label>
              Что нужно сделать
              <input
                autoFocus
                name="title"
                required
                maxLength={200}
                defaultValue={task?.title || ''}
                placeholder="Например, подготовить отчёт по лабораторной"
              />
            </label>
            <label>
              Дисциплина
              <input
                name="subject"
                list="subjects"
                maxLength={200}
                defaultValue={task?.subject || ''}
                placeholder="Необязательно"
              />
              <datalist id="subjects">
                {subjects.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <div className="form-grid">
              <label>
                Сдать до
                <input type="date" name="dueDate" defaultValue={task?.dueDate || ''} />
              </label>
              <label>
                Сделать в этот день
                <input type="date" name="planDate" defaultValue={task?.planDate ?? date} />
              </label>
            </div>
            <label>
              Приоритет
              <select name="priority" defaultValue={task?.priority || 'normal'}>
                <option value="normal">Обычный</option>
                <option value="high">Важная задача</option>
              </select>
            </label>
            <label>
              Заметки
              <textarea
                name="notes"
                rows={3}
                maxLength={4000}
                defaultValue={task?.notes || ''}
                placeholder="Требования, ссылки, вопросы…"
              />
            </label>
            <div className="form-actions">
              {task?.id && (
                <button type="button" className="danger-button" onClick={() => setConfirm(true)}>
                  <Trash2 size={16} />
                  Удалить
                </button>
              )}
              <button type="button" className="secondary" onClick={onClose}>
                Отмена
              </button>
              <button className="primary">{busy ? 'Сохраняем…' : 'Сохранить задачу'}</button>
            </div>
          </fieldset>
        </form>
        {confirm && (
          <div className="notice delete-confirm" role="alert">
            <span>Удалить задачу без возможности восстановления?</span>
            <button disabled={busy} className="danger-button" onClick={remove}>
              Да, удалить
            </button>
            <button className="text-button" onClick={() => setConfirm(false)}>
              Отмена
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
function TaskRow({ task, onToggle, onEdit, busy, compact = false }) {
  const today = todayInMinsk();
  const overdue = !task.done && task.dueDate && task.dueDate < today;
  return (
    <div className={`task-row ${task.done ? 'completed' : ''} ${compact ? 'compact' : ''}`}>
      <input
        className="task-checkbox"
        type="checkbox"
        checked={task.done}
        disabled={busy}
        onChange={() => onToggle(task)}
        aria-label={`Отметить задачу «${task.title}» ${task.done ? 'невыполненной' : 'выполненной'}`}
      />
      <button className="task-body" onClick={() => onEdit(task)}>
        <strong>{task.title}</strong>
        {task.subject && <span className="muted">{task.subject}</span>}
        <span className="task-labels">
          {task.dueDate && (
            <span className={overdue ? 'overdue' : 'deadline'}>
              {overdue
                ? 'Просрочено · '
                : task.dueDate === today
                  ? 'Сдать сегодня · '
                  : 'Сдать до '}
              {formatDate(task.dueDate, { day: 'numeric', month: 'short' })}
            </span>
          )}
          {task.priority === 'high' && <span className="priority">Важно</span>}
          {!compact && task.planDate && (
            <span>В плане: {formatDate(task.planDate, { day: 'numeric', month: 'short' })}</span>
          )}
        </span>
      </button>
      <button
        className="icon-button edit-task"
        aria-label={`Редактировать: ${task.title}`}
        onClick={() => onEdit(task)}
      >
        <Pencil size={15} />
      </button>
    </div>
  );
}
function Lesson({ lesson, date, now, onOpen, next = false }) {
  const status = lessonStatus(lesson, date, now);
  return (
    <button
      className={`lesson ${next ? 'next' : ''} ${status === 'Завершено' ? 'past' : ''}`}
      onClick={() => onOpen(lesson)}
    >
      <span className="lesson-type">
        {status === 'Сейчас' ? 'Сейчас · ' : next ? 'Следующая · ' : ''}
        {lesson.type || 'Занятие'}
      </span>
      <strong>{lesson.title}</strong>
      <span className="lesson-location">
        {lesson.room ? `Ауд. ${lesson.room}` : 'Аудитория не указана'}
        {lesson.address && ` · ${lesson.address}`}
      </span>
      {lesson.subgroup && <span className="subgroup-label">{lesson.subgroup}</span>}
    </button>
  );
}
function Agenda({ lessons, date, now, onOpen }) {
  const next =
    date === todayInMinsk(now) ? lessons.find((l) => minutes(l.start) > minskMinutes(now)) : null;
  const gaps = dayGaps(lessons);
  return (
    <div className="timeline">
      {lessons.map((l, i) => (
        <React.Fragment key={l.key}>
          <div className="time">
            {l.start}
            <small>{l.end}</small>
          </div>
          <Lesson lesson={l} date={date} now={now} onOpen={onOpen} next={next?.key === l.key} />
          {gaps
            .filter(
              (g) => g.start === l.end && !lessons.slice(i + 1).some((x) => x.end === g.start),
            )
            .map((g) => (
              <React.Fragment key={'gap' + g.start}>
                <div className="time muted">
                  {g.start}
                  <small>{g.end}</small>
                </div>
                <div className="gap">
                  <strong>{g.duration} минут между занятиями</strong>
                  <span>По выбранным подгруппам и загруженному расписанию</span>
                </div>
              </React.Fragment>
            ))}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function App() {
  const now = useClock(),
    today = todayInMinsk(now);
  const [session, setSession] = useState(null),
    [settings, setSettings] = useState(initialSettings),
    [bootError, setBootError] = useState('');
  const [page, setPage] = useState(() =>
      Object.keys(pageInfo).includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
    ),
    [date, setDate] = useState(today),
    [view, setView] = useState('week');
  const [modal, setModal] = useState(null),
    [data, setData] = useState(null),
    [scheduleError, setScheduleError] = useState(''),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [tasks, setTasks] = useState([]),
    [tasksError, setTasksError] = useState(''),
    [tasksLoading, setTasksLoading] = useState(false),
    [taskBusy, setTaskBusy] = useState(''),
    [filter, setFilter] = useState('active'),
    [search, setSearch] = useState(''),
    [toast, setToast] = useState(''),
    [globalError, setGlobalError] = useState(''),
    [settingsBusy, setSettingsBusy] = useState(false);
  const start = weekStart(date),
    mode = settings.mode,
    scope = mode === 'demo' ? 'demo' : 'live';
  async function boot() {
    setBootError('');
    try {
      const d = await api('/session', { method: 'POST' });
      setCsrf(d.csrf);
      setSession(d);
      const s = { ...initialSettings, ...d.settings };
      setSettings(s);
      if (!s.groupId) setModal({ type: 'group' });
    } catch (e) {
      setBootError(e.message);
    }
  }
  useEffect(() => {
    boot();
  }, []);
  useEffect(() => {
    const listener = () => {
      const p = location.hash.slice(1);
      if (Object.keys(pageInfo).includes(p)) setPage(p);
    };
    addEventListener('hashchange', listener);
    return () => removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!session || !settings.groupId) return;
    const c = new AbortController();
    setLoading(true);
    setData(null);
    setScheduleError('');
    api(
      `/schedule?groupId=${encodeURIComponent(settings.groupId)}&start=${start}&mode=${mode}&refresh=${refresh > 0}`,
      { signal: c.signal },
    )
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setScheduleError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [session?.email, settings.groupId, mode, start, refresh]);
  useEffect(() => {
    if (!session || !settings.groupId) return;
    const t = setInterval(() => setRefresh((x) => x + 1), 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [session, settings.groupId]);
  async function loadTasks() {
    setTasksLoading(true);
    setTasksError('');
    try {
      const d = await api(`/tasks?scope=${scope}`);
      setTasks(d.items);
    } catch (e) {
      setTasksError(e.message);
    } finally {
      setTasksLoading(false);
    }
  }
  useEffect(() => {
    if (!session) return;
    let active = true;
    setTasks([]);
    setTasksLoading(true);
    setTasksError('');
    api(`/tasks?scope=${scope}`)
      .then((d) => {
        if (active) setTasks(d.items);
      })
      .catch((e) => {
        if (active) setTasksError(e.message);
      })
      .finally(() => {
        if (active) setTasksLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, scope]);
  function navigate(p) {
    location.hash = p;
    setPage(p);
    if (p === 'today') setDate(today);
  }
  async function saveSettings(s) {
    const saved = await api('/settings', { method: 'PUT', body: s });
    setSettings({ ...initialSettings, ...saved });
    setRefresh(0);
    setToast('Настройки сохранены');
  }
  function updateSession(s) {
    setCsrf(s.csrf);
    setSession(s);
    setSettings({ ...initialSettings, ...s.settings });
    setData(null);
    setToast('Аккаунт подключён');
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      setSession(null);
      setTasks([]);
      setData(null);
      setSettings(initialSettings);
      await boot();
      setToast('Вы вышли из аккаунта');
    } catch (e) {
      setGlobalError(e.message);
    }
  }
  async function saveTask(body, id) {
    const t = await api(`/tasks${id ? '/' + id : ''}?scope=${scope}`, {
      method: id ? 'PATCH' : 'POST',
      body,
    });
    setTasks((old) => (id ? old.map((x) => (x.id === id ? t : x)) : [t, ...old]));
    setToast(id ? 'Задача обновлена' : 'Задача создана');
  }
  async function toggleTask(task) {
    setTaskBusy(task.id);
    setGlobalError('');
    try {
      await saveTask({ done: !task.done }, task.id);
    } catch (e) {
      setGlobalError(e.message);
    } finally {
      setTaskBusy('');
    }
  }
  async function deleteTask(id) {
    await api(`/tasks/${id}?scope=${scope}`, { method: 'DELETE' });
    setTasks((old) => old.filter((t) => t.id !== id));
    setToast('Задача удалена');
  }
  const openTask = (t) => setModal({ type: 'task', task: t });
  const days = weekDays(date),
    allLessons = data?.days.flatMap((d) => d.lessons) || [],
    filteredLessons = selectLessons(allLessons, settings.subgroups),
    lessons = filteredLessons.filter((l) => l.date === date);
  const tasksForToday = tasks
    .filter((t) => !t.done && (t.planDate === today || (t.dueDate && t.dueDate <= today)))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 3);
  const next = date === today ? lessons.find((l) => minutes(l.start) > minskMinutes(now)) : null;
  const current = lessons.filter((l) => lessonStatus(l, date, now) === 'Сейчас');
  const activeTasks = tasks.filter((t) => !t.done),
    doneTasks = tasks.filter((t) => t.done);
  const visibleTasks = tasks
    .filter(
      (t) =>
        (filter === 'all' || filter === 'done'
          ? filter === 'all' || t.done
          : filter === 'today'
            ? !t.done && (t.planDate === today || t.dueDate === today)
            : !t.done) &&
        `${t.title} ${t.subject} ${t.notes}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    );
  const subtitle =
    page === 'today'
      ? date !== today
        ? formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
        : current.length
          ? 'Сейчас по расписанию: ' + current.map((l) => l.title).join(', ')
          : next
            ? `Следующая пара в ${next.start}. До неё — ${minutes(next.start) - minskMinutes(now)} мин.`
            : 'Твой день: занятия и личные задачи рядом.'
      : page === 'schedule'
        ? 'Учебная неделя целиком — с парами, корпусами и подгруппами.'
        : 'Личные учебные дела. Срок сдачи и день работы можно задать отдельно.';
  if (!session)
    return (
      <main className="boot">
        <div className="brand">
          <span className="brandmark">к</span>Kupala Hub
        </div>
        {bootError ? (
          <ErrorNotice message={bootError} onRetry={boot} />
        ) : (
          <p className="muted" role="status">
            Открываем твой учебный день…
          </p>
        )}
      </main>
    );
  function scheduleBody() {
    if (!settings.groupId)
      return (
        <Empty
          title="Выбери учебную группу"
          action={
            <button className="primary" onClick={() => setModal({ type: 'group' })}>
              Выбрать группу
            </button>
          }
        >
          Расписание появится после выбора группы.
        </Empty>
      );
    if (loading)
      return (
        <div className="skeleton-stack" role="status" aria-label="Загрузка расписания">
          <span />
          <span />
          <span />
        </div>
      );
    if (scheduleError)
      return (
        <Empty
          icon={AlertCircle}
          title="Расписание не загрузилось"
          action={
            <button className="secondary" onClick={() => setRefresh((x) => x + 1)}>
              Повторить запрос
            </button>
          }
        >
          {scheduleError}
        </Empty>
      );
    if (!lessons.length)
      return (
        <Empty
          title="На этот день занятий не найдено"
          action={
            <button className="text-button" onClick={() => navigate('schedule')}>
              Посмотреть неделю <ArrowRight size={15} />
            </button>
          }
        >
          Возможно, расписание ещё не опубликовано. Можно проверить другую дату или обновить данные.
        </Empty>
      );
    return (
      <Agenda
        lessons={lessons}
        date={date}
        now={now}
        onOpen={(l) => setModal({ type: 'lesson', lesson: l })}
      />
    );
  }
  return (
    <div className={`app-shell page-${page}`}>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <aside className="sidebar">
        <a className="brand" href="#today" onClick={() => navigate('today')}>
          <span className="brandmark">к</span>Kupala Hub
        </a>
        <button className="group-switch" onClick={() => setModal({ type: 'group' })}>
          <span>ГрГУ им. Янки Купалы</span>
          <strong>{settings.groupTitle || 'Выбрать группу'}</strong>
          <span className="group-link">
            {mode === 'demo' ? 'Демонстрационный режим' : 'Изменить группу'}{' '}
            <ChevronRight size={13} />
          </span>
        </button>
        <ExpandedNav page={page} navigate={navigate} taskCount={activeTasks.length} />
        <div className="sidebar-bottom">
          <button className="quiet-button" onClick={() => setModal({ type: 'group' })}>
            <Settings size={17} />
            Учебная группа
          </button>
          <div className="profile">
            <span className="avatar">{session.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{session.email ? session.name : 'Гостевой профиль'}</strong>
              {session.email ? (
                <small>{session.email}</small>
              ) : (
                <button className="text-button" onClick={() => setModal({ type: 'account' })}>
                  Сохранить в аккаунте
                </button>
              )}
            </div>
            {session.email && (
              <button
                className="icon-button"
                title="Выйти"
                aria-label="Выйти из аккаунта"
                onClick={() => setModal({ type: 'logout' })}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <main id="main" className="main">
        <div className="topline">
          <span>
            {formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <div className="topline-right">
            {['today', 'schedule', 'notifications'].includes(page) && (
              <Source data={data} mode={mode} />
            )}
            <button
              className="icon-button"
              title="Обновить расписание"
              aria-label="Обновить расписание"
              disabled={loading || !settings.groupId}
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
            <button
              className="icon-button"
              title="Уведомления"
              aria-label="Открыть уведомления"
              onClick={() => navigate('notifications')}
            >
              <Bell size={18} />
              {data?.changes.length > 0 && <i className="notification-dot" />}
            </button>
          </div>
        </div>
        <header className="page-head">
          <div>
            <h1>
              {page === 'today'
                ? date === today
                  ? 'Сегодня'
                  : formatDate(date, { day: 'numeric', month: 'long' })
                : page === 'schedule'
                  ? 'Расписание'
                  : page === 'tasks'
                    ? 'Задачи'
                    : pageInfo[page]?.[0]}
            </h1>
            <p>{['today', 'schedule', 'tasks'].includes(page) ? subtitle : pageInfo[page]?.[1]}</p>
          </div>
          {['today', 'schedule', 'tasks'].includes(page) && (
            <button className="primary" onClick={() => openTask(null)}>
              <Plus size={18} />
              Добавить задачу
            </button>
          )}
        </header>
        {globalError && (
          <ErrorNotice message={globalError} onRetry={() => setGlobalError('')} />
        )}{' '}
        {mode === 'demo' && (
          <div className="demo-note">
            Пример расписания · задачи этого режима хранятся отдельно
            <button className="text-button" onClick={() => setModal({ type: 'group' })}>
              Подключить мою группу <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {['today', 'schedule'].includes(page) && data?.stale && (
          <ErrorNotice message={data.warning} onRetry={() => setRefresh((x) => x + 1)} />
        )}
        {['today', 'schedule'].includes(page) && data?.subgroups.length > 0 && (
          <details className="subgroups">
            <summary>
              Подгруппы ·{' '}
              {settings.subgroups.length ? `выбрано ${settings.subgroups.length}` : 'показаны все'}
            </summary>
            <p className="muted">
              Отметь все свои подгруппы. Общие занятия показываются всегда. Без выбора видны и
              параллельные занятия.
            </p>
            <div className="subgroup-options">
              {data.subgroups.map((g) => (
                <label key={g.id}>
                  <input
                    type="checkbox"
                    checked={settings.subgroups.includes(g.id)}
                    disabled={settingsBusy}
                    onChange={async (e) => {
                      setSettingsBusy(true);
                      try {
                        await saveSettings({
                          ...settings,
                          subgroups: e.target.checked
                            ? [...settings.subgroups, g.id]
                            : settings.subgroups.filter((x) => x !== g.id),
                        });
                      } catch (err) {
                        setGlobalError(err.message);
                      } finally {
                        setSettingsBusy(false);
                      }
                    }}
                  />
                  {g.title}
                </label>
              ))}
            </div>
          </details>
        )}
        {page === 'today' && (
          <div className="today-layout">
            <section className="panel agenda-panel">
              <div className="section-head">
                <h2>Твой учебный день</h2>
                <button className="text-button" onClick={() => navigate('schedule')}>
                  Вся неделя <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="date-strip">
                <button
                  className="icon-button"
                  aria-label="Предыдущая неделя"
                  onClick={() => setDate(shiftDay(date, -7))}
                >
                  <ChevronLeft size={17} />
                </button>
                {days.map((d) => (
                  <button
                    key={d}
                    className={d === date ? 'selected' : ''}
                    onClick={() => setDate(d)}
                    aria-pressed={d === date}
                  >
                    <span>{formatDate(d, { weekday: 'short' })}</span>
                    <strong>{Number(d.slice(-2))}</strong>
                    <i className={d === today ? 'today-dot' : ''} />
                  </button>
                ))}
                <button
                  className="icon-button"
                  aria-label="Следующая неделя"
                  onClick={() => setDate(shiftDay(date, 7))}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              {scheduleBody()}
            </section>
            <aside className="today-tasks">
              <div className="section-head">
                <h2>Задачи на сегодня</h2>
                <button className="text-button" onClick={() => navigate('tasks')}>
                  Все <ArrowUpRight size={14} />
                </button>
              </div>
              {tasksError ? (
                <ErrorNotice message={tasksError} onRetry={loadTasks} />
              ) : tasksLoading ? (
                <p role="status" className="muted">
                  Загружаем задачи…
                </p>
              ) : tasksForToday.length ? (
                tasksForToday.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={toggleTask}
                    onEdit={openTask}
                    busy={taskBusy === t.id}
                    compact
                  />
                ))
              ) : (
                <Empty
                  icon={CheckSquare}
                  title="На сегодня всё спокойно"
                  action={
                    <button className="text-button" onClick={() => openTask(null)}>
                      Запланировать задачу <Plus size={14} />
                    </button>
                  }
                >
                  Здесь появятся задачи на сегодня и ближайшие просроченные дела.
                </Empty>
              )}
              <p className="aside-note">
                План работы и срок сдачи — разные даты. Можно готовиться заранее, без спешки.
              </p>
              <div className="upcoming">
                <h3>Ближайший срок</h3>
                {activeTasks
                  .filter((t) => t.dueDate && t.dueDate >= today)
                  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ? (
                  (() => {
                    const t = activeTasks
                      .filter((t) => t.dueDate && t.dueDate >= today)
                      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
                    return (
                      <button className="upcoming-task" onClick={() => openTask(t)}>
                        <span>{formatDate(t.dueDate, { day: 'numeric', month: 'long' })}</span>
                        <strong>{t.title}</strong>
                        <small>{t.subject || 'Личная задача'}</small>
                      </button>
                    );
                  })()
                ) : (
                  <p className="muted">Нет задач с будущим сроком сдачи.</p>
                )}
              </div>
              {!session.email && (
                <div className="account-nudge">
                  <User size={20} />
                  <p>
                    Задачи сохранены для этого браузера. Создай аккаунт, чтобы открывать их с
                    другого компьютера.
                  </p>
                  <button className="text-button" onClick={() => setModal({ type: 'account' })}>
                    Создать аккаунт <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}
        {page === 'schedule' && (
          <>
            <div className="schedule-toolbar">
              <div className="week-navigation">
                <button
                  className="icon-button"
                  aria-label="Предыдущая неделя"
                  onClick={() => setDate(shiftDay(date, -7))}
                >
                  <ChevronLeft size={19} />
                </button>
                <strong>
                  {formatDate(start, { day: 'numeric', month: 'short' })} —{' '}
                  {formatDate(shiftDay(start, 6), {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </strong>
                <button
                  className="icon-button"
                  aria-label="Следующая неделя"
                  onClick={() => setDate(shiftDay(date, 7))}
                >
                  <ChevronRight size={19} />
                </button>
                <button className="secondary" onClick={() => setDate(today)}>
                  Сегодня
                </button>
                <label className="date-picker">
                  <span className="sr-only">Выбрать дату</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => {
                      if (e.target.value) setDate(e.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="toolbar-right">
                <div className="segmented">
                  <button
                    className={view === 'week' ? 'active' : ''}
                    onClick={() => setView('week')}
                  >
                    Неделя
                  </button>
                  <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
                    День
                  </button>
                </div>
                <button
                  className="secondary"
                  disabled={!filteredLessons.length}
                  onClick={() => downloadCalendar(filteredLessons)}
                >
                  <Download size={16} />
                  ICS
                </button>
                <button className="secondary print-schedule-button" onClick={() => window.print()}>
                  Печать
                </button>
              </div>
            </div>
            {view === 'day' ? (
              <section className="panel daily-view">{scheduleBody()}</section>
            ) : loading || scheduleError || !settings.groupId ? (
              <section className="panel">{scheduleBody()}</section>
            ) : (
              <div className="week-grid">
                {days.map((d) => (
                  <section key={d} className={`day-column ${d === today ? 'current-day' : ''}`}>
                    <button
                      className="day-heading"
                      onClick={() => {
                        setDate(d);
                        setView('day');
                      }}
                    >
                      <span>{formatDate(d, { weekday: 'short' })}</span>
                      <strong>{Number(d.slice(-2))}</strong>
                      <small>{d === today ? 'Сегодня' : formatDate(d, { month: 'short' })}</small>
                    </button>
                    <div className="day-events">
                      {filteredLessons
                        .filter((l) => l.date === d)
                        .map((l) => (
                          <button
                            key={l.key}
                            className={`week-event ${/экзам|зачет|защита/i.test(l.type) ? 'exam' : ''}`}
                            onClick={() => setModal({ type: 'lesson', lesson: l })}
                          >
                            <span>
                              {l.start}–{l.end}
                            </span>
                            <strong>{l.title}</strong>
                            <small>{l.type || 'Занятие'}</small>
                            <small>{l.room ? `Ауд. ${l.room}` : 'Аудитория не указана'}</small>
                            {l.subgroup && <small className="subgroup-label">{l.subgroup}</small>}
                          </button>
                        ))}
                      {!filteredLessons.some((l) => l.date === d) && (
                        <p className="no-events">Нет опубликованных занятий</p>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            )}
            <p className="foot-note">
              Пустой день может означать, что расписание ещё не опубликовано. Время занятий указано
              для Минска.
            </p>
          </>
        )}
        {page === 'tasks' && (
          <>
            <div className="task-toolbar">
              <div className="filters">
                {[
                  ['active', `В работе · ${activeTasks.length}`],
                  ['today', 'На сегодня'],
                  ['done', `Готово · ${doneTasks.length}`],
                  ['all', 'Все'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={filter === id ? 'active' : ''}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Поиск задач"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Найти задачу"
                />
              </label>
            </div>
            <section className="panel task-list">
              {tasksError ? (
                <ErrorNotice message={tasksError} onRetry={loadTasks} />
              ) : tasksLoading ? (
                <p className="muted" role="status">
                  Загружаем задачи…
                </p>
              ) : visibleTasks.length ? (
                visibleTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={toggleTask}
                    onEdit={openTask}
                    busy={taskBusy === t.id}
                  />
                ))
              ) : (
                <Empty
                  icon={CheckSquare}
                  title={
                    search
                      ? 'Ничего не найдено'
                      : filter === 'done'
                        ? 'Пока нет выполненных задач'
                        : 'Здесь появятся твои задачи'
                  }
                  action={
                    !search &&
                    filter !== 'done' && (
                      <button className="primary" onClick={() => openTask(null)}>
                        <Plus size={16} />
                        Добавить задачу
                      </button>
                    )
                  }
                >
                  {search
                    ? 'Попробуй другой запрос.'
                    : 'Добавляй свои дела, указывай срок и отмечай готовые.'}
                </Empty>
              )}
            </section>
            <p className="foot-note">
              Это твои личные задачи. Автоматическая загрузка заданий с образовательного портала
              пока не подключена.
            </p>
          </>
        )}
        <ExpandedPage
          key={page + ':' + scope + ':' + session.csrf}
          page={page}
          settings={settings}
          session={session}
          notify={setToast}
          onLesson={(lesson) => setModal({ type: 'lesson', lesson })}
          onGroup={() => setModal({ type: 'group' })}
          onProfile={(value) => setSession((old) => ({ ...old, name: value.name }))}
          tasks={tasks}
          schedule={data}
          navigate={navigate}
          onAddTask={(body) => saveTask(body)}
          onReloadTasks={loadTasks}
        />
        <footer className="page-footer">
          <span>Kupala Hub · учебный день без суеты</span>
          <span>
            {mode === 'demo' ? 'Демо-пространство' : 'Собственные данные и подключённые источники'}
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal?.type === 'group' && (
        <GroupPicker settings={settings} onSave={saveSettings} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'account' && (
        <Account session={session} onSession={updateSession} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'task' && (
        <TaskEditor
          task={modal.task}
          onSave={saveTask}
          onDelete={deleteTask}
          onClose={() => setModal(null)}
          subjects={[...new Set(allLessons.map((l) => l.title))]}
          date={today}
        />
      )}
      {modal?.type === 'lesson' && (
        <Modal title="Занятие" onClose={() => setModal(null)}>
          <div className="modal-content lesson-detail">
            <span className="lesson-type">{modal.lesson.type || 'Занятие'}</span>
            <h2>{modal.lesson.title}</h2>
            <p>
              <CalendarDays size={18} />
              {formatDate(modal.lesson.date, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p>
              <Clock size={18} />
              {modal.lesson.start}–{modal.lesson.end}
            </p>
            <p>
              <MapPin size={18} />
              {[modal.lesson.address, modal.lesson.room && `ауд. ${modal.lesson.room}`]
                .filter(Boolean)
                .join(', ') || 'Место не указано'}
            </p>
            <p>
              <User size={18} />
              {modal.lesson.teacher || 'Преподаватель не указан'}
            </p>
            {modal.lesson.subgroup && (
              <p>
                <GraduationCap size={18} />
                {modal.lesson.subgroup}
              </p>
            )}
            <button
              className="primary full"
              onClick={() =>
                openTask({
                  title: '',
                  subject: modal.lesson.title,
                  planDate: modal.lesson.date,
                  dueDate: modal.lesson.date,
                })
              }
            >
              <Plus size={17} />
              Добавить задачу к занятию
            </button>
            <p className="form-note">
              Дата сдачи будет предложена по дате пары. Её можно изменить.
            </p>
          </div>
        </Modal>
      )}
      {modal?.type === 'changes' && (
        <Modal title="Изменения расписания" onClose={() => setModal(null)}>
          <div className="modal-content">
            <p className="muted">
              Сравнение сохранённых снимков.
              {data.changesAt &&
                ` Обнаружено ${new Date(data.changesAt).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}.`}
            </p>
            {data.changes.map((c, i) => (
              <div className="change-row" key={i}>
                <small>
                  {formatDate(c.date)} · {c.start}
                </small>
                <h3>{c.title}</h3>
                <p>
                  {c.kind === 'added'
                    ? 'Добавлено занятие'
                    : c.kind === 'removed'
                      ? 'Занятие отсутствует в новом снимке'
                      : `${c.before.address}, ${c.before.room || 'ауд. не указана'} → ${c.after.address}, ${c.after.room || 'ауд. не указана'}`}
                </p>
                {c.kind === 'changed' && c.before.teacher !== c.after.teacher && (
                  <p>
                    Преподаватель: {c.before.teacher} → {c.after.teacher}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal?.type === 'logout' && (
        <Modal title="Выйти из аккаунта?" onClose={() => setModal(null)}>
          <div className="modal-content">
            <p>Твои задачи останутся в аккаунте. После выхода откроется новый гостевой профиль.</p>
            <div className="form-actions">
              <button className="secondary" onClick={() => setModal(null)}>
                Остаться
              </button>
              <button
                className="primary"
                onClick={() => {
                  setModal(null);
                  logout();
                }}
              >
                Выйти
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
