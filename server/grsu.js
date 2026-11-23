import { createHash } from 'node:crypto';
import { validDate, shiftDay } from '../shared/calendar.js';
const BASE = 'https://api.grsu.by/1.x/app1/';
const text = (x, max = 1000) =>
  typeof x === 'string' ? x.slice(0, max) : typeof x === 'number' ? String(x) : '';
const time = (x) => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
export function normalizeSchedule(raw, start, end, options = {}) {
  if (!raw || !Array.isArray(raw.days) || raw.days.length > 40) throw new Error('Invalid schedule');
  const groups = new Map();
  const seen = new Set();
  const days = raw.days.map((day) => {
    if (
      !validDate(day.date) ||
      day.date < start ||
      day.date > end ||
      seen.has(day.date) ||
      !Array.isArray(day.lessons)
    )
      throw new Error('Invalid day');
    seen.add(day.date);
    return {
      date: day.date,
      lessons: day.lessons
        .map((l, index) => {
          if (!time(l.timeStart) || !time(l.timeEnd) || l.timeEnd <= l.timeStart || !text(l.title))
            throw new Error('Invalid lesson');
          const subgroupId = text(l.subgroup?.id) || '0';
          const subgroup = text(l.subgroup?.title);
          if (subgroupId !== '0') groups.set(subgroupId, subgroup || subgroupId);
          const result = {
            date: day.date,
            start: l.timeStart,
            end: l.timeEnd,
            title: text(l.title),
            type: text(l.type),
            room: text(l.room) === '-' ? '' : text(l.room),
            address: text(l.address),
            teacher: text(l.teacher?.fullname, 3000) || text(options.teacher?.fullname, 3000),
            teacherId: text(l.teacher?.id) || text(options.teacher?.id),
            subgroupId,
            subgroup,
          };
          if (options.includeGroups) {
            if (l.groups !== undefined && !Array.isArray(l.groups))
              throw new Error('Invalid teacher groups');
            result.groups = (l.groups || []).map((g) => ({
              id: text(g.id),
              title: text(g.title),
              students: Number.isFinite(Number(g.students)) ? Number(g.students) : null,
              course: text(g.course),
              faculty: text(g.faculty?.title),
              department: text(g.department?.title),
            }));
          }
          return {
            ...result,
            key: createHash('sha256')
              .update(JSON.stringify(result) + index)
              .digest('hex')
              .slice(0, 20),
          };
        })
        .sort((a, b) => a.start.localeCompare(b.start)),
    };
  });
  return {
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    subgroups: [...groups].map(([id, title]) => ({ id, title })),
  };
}
function difference(previous, next) {
  const key = (l) => [l.date, l.start, l.end, l.title, l.subgroupId].join('|');
  const old = new Map(previous.days.flatMap((d) => d.lessons).map((l) => [key(l), l]));
  const changes = [];
  for (const l of next.days.flatMap((d) => d.lessons)) {
    const before = old.get(key(l));
    if (before) {
      if (before.room !== l.room || before.address !== l.address || before.teacher !== l.teacher)
        changes.push({
          date: l.date,
          title: l.title,
          start: l.start,
          kind: 'changed',
          before: { room: before.room, address: before.address, teacher: before.teacher },
          after: { room: l.room, address: l.address, teacher: l.teacher },
        });
      old.delete(key(l));
    } else changes.push({ date: l.date, title: l.title, start: l.start, kind: 'added' });
  }
  for (const l of old.values())
    changes.push({ date: l.date, title: l.title, start: l.start, kind: 'removed' });
  return changes.slice(0, 150);
}
export function createGrsu(
  db,
  { fetchImpl = fetch, now = () => new Date(), ttl = 15 * 60 * 1000, spacing = 500 } = {},
) {
  const pending = new Map();
  let queue = Promise.resolve();
  let last = 0;
  async function request(method, params = {}) {
    const task = queue
      .catch(() => {})
      .then(async () => {
        const wait = Math.max(0, last + spacing - Date.now());
        if (wait) await new Promise((r) => setTimeout(r, wait));
        last = Date.now();
        const url = new URL(method, BASE);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(10000),
          headers: { Accept: 'application/json' },
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`Upstream ${response.status}`);
        const content = await response.text();
        if (content.length > 4_000_000) throw new Error('Oversized upstream');
        return JSON.parse(content);
      });
    queue = task;
    return task;
  }
  async function cached(key, loader, cacheTtl = ttl, refresh = false) {
    const row = db.prepare('SELECT * FROM cache WHERE key=?').get(key);
    const saved = row ? JSON.parse(row.data) : null;
    if (row && !refresh && now() - new Date(row.fetched_at) < cacheTtl)
      return { ...saved, source: 'grsu', fetchedAt: row.fetched_at, stale: false };
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      try {
        const data = await loader(saved);
        const fetchedAt = now().toISOString();
        db.prepare(
          'INSERT INTO cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at',
        ).run(key, JSON.stringify(data), fetchedAt);
        return { ...data, source: 'grsu', fetchedAt, stale: false };
      } catch {
        if (saved)
          return {
            ...saved,
            source: 'grsu',
            fetchedAt: row.fetched_at,
            stale: true,
            warning: 'Не удалось обновить данные ГрГУ. Показана сохранённая версия.',
          };
        const e = new Error('Сервис ГрГУ временно недоступен. Попробуйте позже или откройте демо.');
        e.statusCode = 502;
        throw e;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, job);
    return job;
  }
  const teachers = () =>
    cached(
      'teachers:extended',
      async () => {
        const raw = await request('getTeachers', { extended: 'true' });
        if (
          !Array.isArray(raw.items) ||
          raw.items.length > 20000 ||
          raw.items.some((t) => !text(t.id))
        )
          throw new Error('Invalid teachers');
        return {
          items: raw.items.map((t) => ({
            id: text(t.id),
            fullname:
              [text(t.surname), text(t.name), text(t.patronym)].filter(Boolean).join(' ') ||
              text(t.fullname) ||
              'Имя не указано',
            post: text(t.post),
            email: text(t.email, 254),
            phone: text(t.phone, 100),
            description: text(t.descr, 3000),
          })),
        };
      },
      86400000,
    );
  return {
    teachers,
    async teacherSchedule(teacherId, start, refresh = false) {
      const catalog = await teachers();
      const teacher = catalog.items.find((t) => t.id === teacherId) || {
        id: teacherId,
        fullname: 'Преподаватель',
        post: '',
        email: '',
        phone: '',
        description: '',
      };
      const end = shiftDay(start, 6);
      return cached(
        `teacher-schedule:${teacherId}:${start}`,
        async (previous) => {
          const fmt = (d) => d.split('-').reverse().join('.');
          const raw = await request('getTeacherSchedule', {
            teacherId,
            dateStart: fmt(start),
            dateEnd: fmt(end),
          });
          const next = normalizeSchedule(raw, start, end, { teacher, includeGroups: true });
          if (
            previous?.days.some((d) => d.lessons.length) &&
            !next.days.some((d) => d.lessons.length)
          )
            throw new Error('Suspicious empty teacher week');
          return {
            ...next,
            teacher,
            changes: [],
            coverage: { start, end, teacherId, complete: false },
          };
        },
        ttl,
        refresh,
      );
    },
    catalog(kind, params = {}) {
      const method = {
        departments: 'getDepartments',
        faculties: 'getFaculties',
        groups: 'getGroups',
      }[kind];
      return cached(
        kind + JSON.stringify(params),
        async () => {
          const raw = await request(method, params);
          if (!Array.isArray(raw.items) || raw.items.some((i) => !text(i.id) || !text(i.title)))
            throw new Error('Invalid catalog');
          return { items: raw.items.map((i) => ({ id: text(i.id), title: text(i.title) })) };
        },
        86400000,
      );
    },
    schedule(groupId, start, refresh = false) {
      const end = shiftDay(start, 6);
      return cached(
        `schedule:${groupId}:${start}`,
        async (previous) => {
          const fmt = (d) => d.split('-').reverse().join('.');
          const raw = await request('getGroupSchedule', {
            groupId,
            dateStart: fmt(start),
            dateEnd: fmt(end),
          });
          const next = normalizeSchedule(raw, start, end);
          // An empty upstream response cannot safely remove a previously populated week.
          if (
            previous?.days.some((d) => d.lessons.length) &&
            !next.days.some((d) => d.lessons.length)
          )
            throw new Error('Suspicious empty week');
          const changes = previous ? difference(previous, next) : [];
          return {
            ...next,
            changes: changes.length ? changes : previous?.changes || [],
            changesAt: changes.length ? now().toISOString() : previous?.changesAt || null,
          };
        },
        ttl,
        refresh,
      );
    },
  };
}
