import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { openDatabase } from '../server/database.js';
import { createGrsu } from '../server/grsu.js';
import { registerPublicRoutes } from '../server/public-routes.js';

const teachers = {
  items: [
    {
      id: '-220',
      surname: 'Иванов',
      name: 'Павел',
      patronym: 'Иванович',
      post: 'доцент',
      email: '',
      phone: '',
      descr: 'Право',
    },
    {
      id: '14580',
      surname: 'Абрамчик',
      name: 'Лилия',
      patronym: 'Ярославовна',
      post: 'зав. кафедрой',
      email: 'teacher@example.invalid',
      phone: '',
      descr: '',
    },
  ],
};
const teacherWeek = {
  days: [
    {
      date: '2026-11-23',
      lessons: [
        {
          timeStart: '10:05',
          timeEnd: '11:30',
          title: 'Семинар',
          type: '',
          address: 'Ожешко, 22',
          room: '-',
          groups: [],
        },
        {
          timeStart: '12:10',
          timeEnd: '13:35',
          title: 'Право',
          type: 'лек.',
          address: 'Ожешко, 22',
          room: '214',
          groups: [{ id: '123', title: 'ПР-22', students: '24', course: '2' }],
        },
      ],
    },
  ],
};
const groupWeek = {
  days: [
    {
      date: '2026-11-23',
      lessons: [
        'лек.',
        'Зачет (в устной форме)',
        'Зачёт',
        'Экзамен',
        'конс.',
        'Курсовая работа (защита)',
      ].map((type, i) => ({
        timeStart: '10:05',
        timeEnd: '11:30',
        title: `Предмет ${i}`,
        type,
        room: '214',
        subgroup: { id: String(i), title: `Подгруппа ${i}` },
      })),
    },
  ],
};
function setup(t, fetchImpl) {
  const db = openDatabase(':memory:');
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  const grsu = createGrsu(db, { fetchImpl, spacing: 0 });
  registerPublicRoutes(app, { grsu });
  t.after(async () => {
    await app.close();
    db.close();
  });
  return { app, grsu };
}

test('teacher catalogue preserves signed IDs, absent contacts, Unicode search and reuses one upstream snapshot', async (t) => {
  let calls = 0;
  const { app } = setup(t, async (url) => {
    calls++;
    assert.equal(url.pathname, '/1.x/app1/getTeachers');
    assert.equal(url.searchParams.get('extended'), 'true');
    return Response.json(teachers);
  });
  const response = await app.inject('/api/teachers?q=' + encodeURIComponent('ИВАНОВ'));
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, '-220');
  assert.equal(data.items[0].fullname, 'Иванов Павел Иванович');
  assert.equal(data.items[0].email, '');
  assert.equal(data.source, 'grsu');
  const all = await app.inject('/api/teachers');
  assert.equal(all.json().items.length, 2);
  assert.equal(calls, 1);
});
test('teacher schedule accepts negative IDs and events without teacher or groups', async (t) => {
  const calls = [];
  const { app } = setup(t, async (url) => {
    calls.push(String(url));
    return Response.json(url.pathname.endsWith('getTeachers') ? teachers : teacherWeek);
  });
  const response = await app.inject('/api/teachers/-220/schedule?start=2026-11-23');
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.equal(data.teacher.id, '-220');
  assert.equal(data.days[0].lessons[0].teacher, 'Иванов Павел Иванович');
  assert.deepEqual(data.days[0].lessons[0].groups, []);
  assert.equal(data.days[0].lessons[0].room, '');
  assert.equal(data.days[0].lessons[1].groups[0].students, 24);
  const scheduleUrl = new URL(calls[1]);
  assert.equal(scheduleUrl.searchParams.get('teacherId'), '-220');
  assert.equal(scheduleUrl.searchParams.get('dateStart'), '23.11.2026');
  assert.equal(scheduleUrl.searchParams.get('dateEnd'), '29.11.2026');
});
test('session extracts only examination types, retains subgroup fields, reports one-week coverage', async (t) => {
  const { app } = setup(t, async (url) => {
    assert.equal(url.pathname, '/1.x/app1/getGroupSchedule');
    return Response.json(groupWeek);
  });
  const response = await app.inject('/api/exams?groupId=123&start=2026-11-23');
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.equal(data.items.length, 5);
  assert.ok(!data.items.some((l) => l.type === 'лек.'));
  assert.equal(data.items[0].subgroupId, '1');
  assert.deepEqual(data.coverage, {
    start: '2026-11-23',
    end: '2026-11-29',
    groupId: '123',
    complete: false,
  });
});
test('all demo routes stay usable without any external request', async (t) => {
  const { app } = setup(t, async () => {
    throw new Error('Demo must not call university');
  });
  const teachersResponse = await app.inject('/api/teachers?mode=demo');
  const demoTeachers = teachersResponse.json();
  assert.equal(demoTeachers.source, 'demo');
  assert.ok(demoTeachers.items.length >= 3);
  const response = await app.inject(
    `/api/teachers/${demoTeachers.items[0].id}/schedule?mode=demo&start=2026-11-23`,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().source, 'demo');
  const exams = await app.inject('/api/exams?mode=demo&groupId=demo&start=2026-11-23');
  assert.equal(exams.json().items.length, 3);
  assert.equal(exams.json().source, 'demo');
  const unknown = await app.inject('/api/teachers/9999/schedule?mode=demo&start=2026-11-23');
  assert.equal(unknown.statusCode, 404);
});
test('validation rejects invalid dates, non-Monday requests and demo group in live', async (t) => {
  const { app } = setup(t, async () => {
    throw new Error('Must reject before upstream');
  });
  for (const url of [
    '/api/teachers/nope/schedule?start=2026-11-23',
    '/api/teachers/1/schedule?start=2026-11-24',
    '/api/exams?groupId=demo&start=2026-11-23',
    '/api/exams?groupId=1&start=2026-02-30',
    '/api/teachers?mode=invalid',
  ]) {
    assert.equal((await app.inject(url)).statusCode, 400, url);
  }
});
test('teacher outage returns stale snapshot and cannot erase previous teacher week', async (t) => {
  let fail = false;
  let empty = false;
  const { grsu } = setup(t, async (url) => {
    if (fail) throw new Error('offline');
    return Response.json(
      url.pathname.endsWith('getTeachers') ? teachers : empty ? { days: [] } : teacherWeek,
    );
  });
  const initial = await grsu.teacherSchedule('-220', '2026-11-23');
  assert.equal(initial.stale, false);
  fail = true;
  const stale = await grsu.teacherSchedule('-220', '2026-11-23', true);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.days, initial.days);
  fail = false;
  empty = true;
  const suspicious = await grsu.teacherSchedule('-220', '2026-11-23', true);
  assert.equal(suspicious.stale, true);
  assert.deepEqual(suspicious.days, initial.days);
});
test('first upstream failure stays an error and is not silently replaced by demo', async (t) => {
  const { app } = setup(t, async () => {
    throw new Error('offline');
  });
  const response = await app.inject('/api/teachers');
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().source, undefined);
});
