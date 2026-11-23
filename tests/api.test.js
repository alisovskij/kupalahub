import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { normalizeSchedule, createGrsu } from '../server/grsu.js';
import { openDatabase } from '../server/database.js';
import {
  weekStart,
  shiftDay,
  todayInMinsk,
  selectLessons,
  dayGaps,
  lessonStatus,
  validDate,
} from '../shared/calendar.js';
async function client(app) {
  const r = await app.inject({ method: 'POST', url: '/api/session' });
  assert.equal(r.statusCode, 200);
  let cookie = r.headers['set-cookie'].split(';')[0],
    csrf = r.json().csrf;
  return {
    async request(method, url, body) {
      const r = await app.inject({
        method,
        url,
        headers: { cookie, 'x-csrf-token': csrf, origin: 'http://localhost:5173' },
        payload: body,
      });
      if (r.headers['set-cookie']) cookie = r.headers['set-cookie'].split(';')[0];
      if (r.json()?.csrf) csrf = r.json().csrf;
      return r;
    },
    get cookie() {
      return cookie;
    },
  };
}
const appFor = (t) => {
  const app = buildApp({ dbPath: ':memory:', grsuOptions: { spacing: 0 } });
  t.after(() => app.close());
  return app;
};
const raw = {
  count: 1,
  days: [
    {
      date: '2026-11-16',
      count: 2,
      lessons: [
        {
          timeStart: '10:05',
          timeEnd: '11:30',
          title: 'Базы данных',
          type: 'лаб.',
          teacher: { id: '1', fullname: 'Иванов И.И.' },
          room: '214',
          address: 'Ожешко, 22',
          subgroup: { id: '1', title: 'Подгруппа 1' },
        },
        {
          timeStart: '10:05',
          timeEnd: '11:30',
          title: 'Алгоритмы',
          room: '-',
          subgroup: { id: '2', title: 'Подгруппа 2' },
        },
      ],
    },
  ],
};

test('calendar handles Minsk midnight, Sundays and overlapping subgroups', () => {
  assert.equal(todayInMinsk(new Date('2026-11-15T22:00:00Z')), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(validDate('2026-02-30'), false);
  const lessons = [
    { start: '08:30', end: '09:55', subgroupId: '0' },
    { start: '10:05', end: '11:30', subgroupId: '1' },
    { start: '10:05', end: '11:30', subgroupId: '2' },
    { start: '12:10', end: '13:35', subgroupId: '0' },
  ];
  assert.equal(selectLessons(lessons, ['1']).length, 3);
  assert.deepEqual(dayGaps(lessons), [{ start: '11:30', end: '12:10', duration: 40 }]);
  assert.equal(
    lessonStatus(lessons[0], '2026-11-16', new Date('2026-11-16T06:55:00Z')),
    'Завершено',
  );
});
test('normalizer retains subgroup, missing room, common fields and rejects malformed times', () => {
  const result = normalizeSchedule(raw, '2026-11-16', '2026-11-22');
  assert.equal(result.subgroups.length, 2);
  assert.equal(result.days[0].lessons[1].room, '');
  assert.throws(() =>
    normalizeSchedule(
      { ...raw, days: [{ date: 'invalid', lessons: [] }] },
      '2026-11-16',
      '2026-11-22',
    ),
  );
  assert.throws(() =>
    normalizeSchedule(
      {
        ...raw,
        days: [
          { date: '2026-11-16', lessons: [{ title: 'Bad', timeStart: '24:00', timeEnd: '25:00' }] },
        ],
      },
      '2026-11-16',
      '2026-11-22',
    ),
  );
});
test('tasks require a session and CSRF, cross-site writes fail', async (t) => {
  const app = appFor(t);
  assert.equal((await app.inject({ url: '/api/tasks' })).statusCode, 401);
  const a = await client(app);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: { cookie: a.cookie },
        payload: { title: 'x' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/session',
        headers: { origin: 'https://attacker.example' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/session',
        headers: { 'sec-fetch-site': 'cross-site' },
      })
    ).statusCode,
    403,
  );
});
test('CRUD is owner-scoped, validates fields and separates demo from live', async (t) => {
  const app = appFor(t),
    a = await client(app),
    b = await client(app);
  const created = await a.request('POST', '/api/tasks', {
    title: 'Отчёт',
    subject: 'Базы данных',
    dueDate: '2026-11-17',
    planDate: '2026-11-16',
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  assert.equal((await b.request('GET', '/api/tasks')).json().items.length, 0);
  assert.equal((await b.request('PATCH', `/api/tasks/${id}`, { title: 'Hacked' })).statusCode, 404);
  assert.equal((await b.request('DELETE', `/api/tasks/${id}`)).statusCode, 404);
  assert.equal((await a.request('GET', '/api/tasks?scope=demo')).json().items.length, 0);
  assert.equal((await a.request('PATCH', `/api/tasks/${id}`, { done: true })).json().done, true);
  assert.equal((await a.request('POST', '/api/tasks', { title: '   ' })).statusCode, 400);
  assert.equal(
    (await a.request('POST', '/api/tasks', { title: 'x', dueDate: '2026-02-30' })).statusCode,
    400,
  );
  assert.equal(
    (await a.request('POST', '/api/tasks', { title: 'x', user_id: 'other' })).statusCode,
    400,
  );
  assert.equal((await a.request('DELETE', `/api/tasks/${id}`)).statusCode, 200);
  assert.equal((await a.request('GET', '/api/tasks')).json().items.length, 0);
});
test('register upgrades guest data, login restores it and logout invalidates cookie', async (t) => {
  const app = appFor(t),
    a = await client(app);
  await a.request('POST', '/api/tasks', { title: 'Сохранить в аккаунте' });
  const before = a.cookie;
  const reg = await a.request('POST', '/api/auth/register', {
    email: 'test@example.org',
    name: 'Артём',
    password: 'long-test-password',
  });
  assert.equal(reg.statusCode, 200);
  assert.notEqual(a.cookie, before);
  assert.equal(
    (await app.inject({ url: '/api/tasks', headers: { cookie: before } })).statusCode,
    401,
  );
  const b = await client(app);
  assert.equal(
    (await b.request('POST', '/api/auth/login', { email: 'test@example.org', password: 'wrong' }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await b.request('POST', '/api/auth/login', {
        email: 'test@example.org',
        password: 'long-test-password',
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await b.request('GET', '/api/tasks')).json().items[0].title,
    'Сохранить в аккаунте',
  );
  const current = b.cookie;
  await b.request('POST', '/api/auth/logout');
  assert.equal(
    (await app.inject({ url: '/api/tasks', headers: { cookie: current } })).statusCode,
    401,
  );
});
test('SQLite survives restart with session, settings and tasks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kupala-test-'));
  const path = join(dir, 'db.sqlite');
  let app = buildApp({ dbPath: path });
  try {
    const a = await client(app);
    await a.request('PUT', '/api/settings', {
      mode: 'live',
      groupId: '18159',
      groupTitle: 'СДП-ПИ-251',
      subgroups: ['1'],
    });
    await a.request('POST', '/api/tasks', { title: 'После перезапуска' });
    const cookie = a.cookie;
    await app.close();
    app = buildApp({ dbPath: path });
    const response = await app.inject({ url: '/api/tasks', headers: { cookie } });
    assert.equal(response.json().items[0].title, 'После перезапуска');
    assert.equal(
      (await app.inject({ url: '/api/session', headers: { cookie } })).json().settings.groupId,
      '18159',
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('demo works without upstream and missing upstream never silently becomes demo', async (t) => {
  const app = buildApp({
    dbPath: ':memory:',
    fetchImpl: async () => {
      throw Error('offline');
    },
    grsuOptions: { spacing: 0 },
  });
  t.after(() => app.close());
  assert.equal(
    (await app.inject({ url: '/api/schedule?mode=demo&groupId=demo&start=2026-11-16' })).json()
      .source,
    'demo',
  );
  const r = await app.inject({ url: '/api/schedule?groupId=18159&start=2026-11-16' });
  assert.equal(r.statusCode, 502);
  assert.equal(r.json().source, undefined);
  assert.equal(
    (await app.inject({ url: '/api/schedule?groupId=18159&start=2026-11-17' })).statusCode,
    400,
  );
});
test('upstream requests use expected params, cache and preserve previous data on outage', async () => {
  const db = openDatabase(':memory:');
  let calls = 0,
    fail = false;
  const provider = createGrsu(db, {
    spacing: 0,
    fetchImpl: async (url) => {
      calls++;
      assert.equal(url.searchParams.get('groupId'), '18159');
      assert.equal(url.searchParams.get('dateStart'), '16.11.2026');
      if (fail) throw Error('offline');
      return new Response(JSON.stringify(raw));
    },
  });
  try {
    const a = await provider.schedule('18159', '2026-11-16');
    assert.equal(a.stale, false);
    await provider.schedule('18159', '2026-11-16');
    assert.equal(calls, 1);
    fail = true;
    const b = await provider.schedule('18159', '2026-11-16', true);
    assert.equal(b.stale, true);
    assert.deepEqual(b.days, a.days);
  } finally {
    db.close();
  }
});
test('changes detect room changes and suspicious empty response does not cancel all lessons', async () => {
  const db = openDatabase(':memory:');
  let data = structuredClone(raw);
  const provider = createGrsu(db, {
    spacing: 0,
    fetchImpl: async () => new Response(JSON.stringify(data)),
  });
  try {
    await provider.schedule('1', '2026-11-16');
    data.days[0].lessons[0].room = '300';
    const updated = await provider.schedule('1', '2026-11-16', true);
    assert.equal(updated.changes[0].before.room, '214');
    assert.equal(updated.changes[0].after.room, '300');
    data = { count: 0, days: [] };
    const empty = await provider.schedule('1', '2026-11-16', true);
    assert.equal(empty.stale, true);
    assert.equal(empty.days[0].lessons.length, 2);
  } finally {
    db.close();
  }
});
test('API JSON cannot inject markup, static traversal is not served and health responds', async (t) => {
  const app = appFor(t),
    a = await client(app);
  const title = '<img src=x onerror=alert(1)>';
  assert.equal((await a.request('POST', '/api/tasks', { title })).json().title, title);
  assert.equal((await app.inject({ url: '/api/health' })).json().status, 'ok');
  assert.notEqual((await app.inject({ url: '/..%2fserver%2fapp.js' })).statusCode, 200);
});
