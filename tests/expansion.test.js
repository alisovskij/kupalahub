import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/database.js';
import { registerExpansion } from '../server/expansion.js';

function harness(t) {
  const db = openDatabase(':memory:'); const alice = randomUUID(), bob = randomUUID(), other = randomUUID();
  for (const [id, name] of [[alice, 'Алиса'], [bob, 'Борис'], [other, 'Другой']]) db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run(id, name);
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  app.addHook('onRequest', async req => { const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.headers['x-user'] || ''); if (user) req.session = { user_id: user.id, name: user.name }; });
  registerExpansion(app, { db, grsu: { schedule: async () => ({ source: 'grsu', fetchedAt: '2026-11-22T08:00:00Z', stale: false, days: [{ date: '2026-11-16', lessons: [{ date: '2026-11-16', start: '08:30', end: '09:55', title: 'Лекция', address: 'Ожешко, 22', room: '301' }] }] }) } });
  t.after(async () => { await app.close(); db.close(); });
  const request = (user, method, url, payload) => app.inject({ method, url, headers: user ? { 'x-user': user } : {}, payload });
  return { db, alice, bob, other, request };
}

test('closed modules stay disconnected in live and demo has explicit fictional source', async t => {
  const { request, alice } = harness(t);
  assert.equal((await request(null, 'GET', '/api/learning')).statusCode, 401);
  for (const tab of ['grades', 'attestation', 'absences', 'materials', 'finance', 'orders']) {
    const live = await request(alice, 'GET', `/api/learning?tab=${tab}`); assert.equal(live.statusCode, 200); assert.equal(live.json().status, 'disconnected'); assert.deepEqual(live.json().items, []); assert.equal(live.json().source, null);
    const demo = await request(alice, 'GET', `/api/learning?mode=demo&tab=${tab}`); assert.equal(demo.json().source, 'demo'); assert.equal(demo.json().fictional, true); assert.ok(demo.json().items.length > 0);
  }
});
test('profile and preferences are owner scoped and never claim university verification', async t => {
  const { request, alice, bob } = harness(t);
  const profile = await request(alice, 'PUT', '/api/profile', { name: 'Новое имя', bio: 'Заметка', contact: '@contact' }); assert.equal(profile.statusCode, 200); assert.equal(profile.json().universityVerified, false);
  assert.equal((await request(bob, 'GET', '/api/profile')).json().name, 'Борис');
  const prefs = await request(alice, 'PUT', '/api/preferences', { favoriteTeachers: ['-220'], taskReminders: true, quietHoursStart: '23:00' }); assert.equal(prefs.statusCode, 200); assert.equal(prefs.json().deliveryStatus, 'local-preferences-only');
  assert.deepEqual((await request(bob, 'GET', '/api/preferences')).json().favoriteTeachers, []);
  assert.equal((await request(alice, 'PUT', '/api/preferences', { favoriteTeachers: ['javascript:alert(1)'] })).statusCode, 400);
  assert.equal((await request(alice, 'PUT', '/api/profile', { name: '   ' })).statusCode, 400);
});
test('personal materials validate links and protect ownership and demo scope', async t => {
  const { request, alice, bob } = harness(t);
  for (const url of ['javascript:alert(1)', 'http://example.org', 'https://secret:password@example.org']) assert.equal((await request(alice, 'POST', '/api/materials', { title: 'Bad', url })).statusCode, 400);
  const created = await request(alice, 'POST', '/api/materials', { title: 'Конспект', subject: 'Алгоритмы', kind: 'note', notes: 'Текст' }); assert.equal(created.statusCode, 201); const id = created.json().id;
  assert.equal((await request(bob, 'GET', '/api/materials')).json().items.length, 0); assert.equal((await request(alice, 'GET', '/api/materials?scope=demo')).json().items.length, 0);
  assert.equal((await request(bob, 'PATCH', `/api/materials/${id}`, { title: 'Чужое' })).statusCode, 404);
  assert.equal((await request(alice, 'PATCH', `/api/materials/${id}`, { title: 'Обновлённый конспект' })).json().title, 'Обновлённый конспект');
  assert.equal((await request(alice, 'DELETE', `/api/materials/${id}?scope=demo`)).statusCode, 404);
  assert.equal((await request(alice, 'DELETE', `/api/materials/${id}`)).statusCode, 200);
});
test('community invitations enforce membership, roles, private codes, and mode isolation', async t => {
  const { request, alice, bob, other } = harness(t);
  const made = await request(alice, 'POST', '/api/communities', { name: 'Наша учебная группа' }); assert.equal(made.statusCode, 201); const { id, inviteCode } = made.json(); assert.equal(made.json().official, false); assert.equal(made.json().role, 'organizer');
  assert.equal((await request(bob, 'GET', `/api/communities/${id}`)).statusCode, 404);
  assert.equal((await request(bob, 'POST', '/api/communities/join?scope=demo', { code: inviteCode })).statusCode, 404);
  assert.equal((await request(bob, 'POST', '/api/communities/join', { code: inviteCode })).statusCode, 200);
  const member = (await request(bob, 'GET', `/api/communities/${id}`)).json(); assert.equal(member.members.length, 2); assert.equal(member.community.role, 'member'); assert.equal(member.community.inviteCode, undefined);
  assert.equal((await request(bob, 'POST', `/api/communities/${id}/posts`, { title: 'x', body: 'y' })).statusCode, 403);
  assert.equal((await request(alice, 'POST', `/api/communities/${id}/posts`, { title: 'Объявление', body: 'Встречаемся после пары' })).statusCode, 201);
  assert.equal((await request(other, 'GET', '/api/communities')).json().items.length, 0);
  const shared = await request(alice, 'POST', `/api/communities/${id}/tasks`, { title: 'Подготовить вопросы', dueDate: '2026-11-30' }); assert.equal(shared.statusCode, 201);
  assert.equal((await request(bob, 'PATCH', `/api/communities/${id}/tasks/${shared.json().id}`, { done: true })).statusCode, 403);
  assert.equal((await request(alice, 'PATCH', `/api/communities/${id}/tasks/${shared.json().id}`, { done: true })).json().done, true);
  assert.equal((await request(alice, 'POST', `/api/communities/${id}/tasks`, { title: 'Bad', dueDate: '2026-02-30' })).statusCode, 400);
  const rotated = (await request(alice, 'POST', `/api/communities/${id}/invite`, {})).json().inviteCode;
  assert.notEqual(rotated, inviteCode); assert.equal((await request(other, 'POST', '/api/communities/join', { code: inviteCode })).statusCode, 404);
  assert.equal((await request(alice, 'DELETE', `/api/communities/${id}/members/${bob}`)).statusCode, 200);
  assert.equal((await request(bob, 'GET', `/api/communities/${id}`)).statusCode, 404);
});
test('poll voting is membership scoped, options checked and replacement does not duplicate vote', async t => {
  const { request, alice, bob, other } = harness(t);
  const { id, inviteCode } = (await request(alice, 'POST', '/api/communities', { name: 'Опросы' })).json(); await request(bob, 'POST', '/api/communities/join', { code: inviteCode });
  const poll = (await request(alice, 'POST', `/api/communities/${id}/polls`, { question: 'Когда встречаемся?', options: ['В понедельник', 'Во вторник'] })).json();
  const url = `/api/communities/${id}/polls/${poll.id}/vote`;
  assert.equal((await request(other, 'POST', url, { optionId: poll.options[0].id })).statusCode, 404);
  assert.equal((await request(bob, 'POST', url, { optionId: randomUUID() })).statusCode, 400);
  await request(bob, 'POST', url, { optionId: poll.options[0].id }); await request(bob, 'POST', url, { optionId: poll.options[1].id });
  const result = (await request(bob, 'GET', `/api/communities/${id}`)).json().polls[0]; assert.equal(result.myOptionId, poll.options[1].id); assert.deepEqual(result.options.map(o => o.votes), [0, 1]);
});
test('campus reports one-group coverage, valid map link and never guarantees free rooms', async t => {
  const { request, alice } = harness(t);
  const result = await request(alice, 'GET', '/api/campus?groupId=18159&start=2026-11-16'); assert.equal(result.statusCode, 200); assert.equal(result.json().coverage.completeRoomInventory, false); assert.equal(result.json().coverage.scope, 'one-group-only'); assert.equal(result.json().buildings[0].rooms[0].lessons[0].title, 'Лекция'); assert.ok(result.json().buildings[0].mapUrl.startsWith('https://yandex.by/maps/'));
  assert.equal((await request(alice, 'GET', '/api/campus?groupId=demo&start=2026-11-16')).statusCode, 400);
  assert.equal((await request(alice, 'GET', '/api/campus?groupId=18159&start=2026-11-17')).statusCode, 400);
});

test('registered expansion in full app inherits session, CSRF and origin guards', async t => {
  const { buildApp } = await import('../server/app.js');
  const app = buildApp({ dbPath: ':memory:' }); t.after(() => app.close());
  const session = await app.inject({ method: 'POST', url: '/api/session' });
  const cookie = session.headers['set-cookie'].split(';')[0], csrf = session.json().csrf;
  assert.equal((await app.inject({ url: '/api/profile' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/communities', headers: { cookie }, payload: { name: 'x' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/communities', headers: { cookie, 'x-csrf-token': csrf, origin: 'https://attacker.example' }, payload: { name: 'x' } })).statusCode, 403);
  const made = await app.inject({ method: 'POST', url: '/api/communities', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'Рабочая группа' } });
  assert.equal(made.statusCode, 201); assert.equal(made.json().official, false);
  const read = await app.inject({ url: `/api/communities/${made.json().id}`, headers: { cookie } }); assert.equal(read.statusCode, 200); assert.equal(read.json().members.length, 1);
});
