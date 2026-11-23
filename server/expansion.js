import { randomBytes, randomUUID } from 'node:crypto';
import { validDate, weekStart } from '../shared/calendar.js';
import { transaction } from './database.js';
import { demoSchedule } from './demo.js';
import { disconnectedLearning, learningDemo } from './expansion-demo.js';

const string = (max = 200) => ({ type: 'string', maxLength: max });
const object = (properties, required = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const scopeQuery = object({ scope: { type: 'string', enum: ['live', 'demo'], default: 'live' } });
const idSchema = { type: 'string', format: 'uuid' };
const idParams = object({ id: idSchema }, ['id']);
const now = () => new Date().toISOString();
function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
function nonempty(value, label) {
  const result = value.trim();
  if (!result) fail(400, `Заполните поле «${label}».`);
  return result;
}
function date(value = '') {
  if (value && !validDate(value)) fail(400, 'Некорректная дата.');
  return value;
}
function safeLink(value = '') {
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(400, 'Укажите полный HTTPS-адрес.');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    fail(400, 'Разрешены только HTTPS-ссылки без пароля в адресе.');
  return url.href;
}
const decode = (row) => (row ? JSON.parse(row.data) : {});
const basePreferences = {
  lessonReminders: false,
  taskReminders: false,
  reminderMinutes: 15,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  favoriteTeachers: [],
  favoriteGroups: [],
};
const preferenceFields = {
  lessonReminders: { type: 'boolean' },
  taskReminders: { type: 'boolean' },
  reminderMinutes: { type: 'integer', minimum: 5, maximum: 120 },
  quietHoursStart: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  quietHoursEnd: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  favoriteTeachers: {
    type: 'array',
    uniqueItems: true,
    maxItems: 100,
    items: { type: 'string', pattern: '^-?[0-9]{1,12}$' },
  },
  favoriteGroups: {
    type: 'array',
    uniqueItems: true,
    maxItems: 50,
    items: { type: 'string', pattern: '^[0-9]{1,12}$' },
  },
};
const materialFields = {
  title: { ...string(200), minLength: 1 },
  subject: string(200),
  url: string(2000),
  notes: string(4000),
  kind: { type: 'string', enum: ['link', 'note'] },
};
const taskFields = {
  title: { ...string(200), minLength: 1 },
  subject: string(200),
  dueDate: string(10),
  done: { type: 'boolean' },
};

/** Adds owner-scoped local features and explicitly disconnected university modules. */
export function registerExpansion(app, { db, grsu }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_details (user_id TEXT PRIMARY KEY REFERENCES users(id), bio TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), scope TEXT NOT NULL, title TEXT NOT NULL, subject TEXT NOT NULL, url TEXT NOT NULL, notes TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS materials_owner ON materials(user_id,scope);
    CREATE TABLE IF NOT EXISTS communities (id TEXT PRIMARY KEY, scope TEXT NOT NULL, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), invite_code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_members (community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), joined_at TEXT NOT NULL, PRIMARY KEY(community_id,user_id));
    CREATE INDEX IF NOT EXISTS membership_user ON community_members(user_id);
    CREATE TABLE IF NOT EXISTS community_posts (id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_tasks (id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, title TEXT NOT NULL, subject TEXT NOT NULL, due_date TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_polls (id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, question TEXT NOT NULL, options TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_votes (poll_id TEXT NOT NULL REFERENCES community_polls(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), option_id TEXT NOT NULL, PRIMARY KEY(poll_id,user_id));
  `);
  // Encapsulated hook protects reads too; existing parent hook protects CSRF for mutations.
  app.register(async (routes) => {
    routes.addHook('preHandler', async (request) => {
      if (!request.session) fail(401, 'Сессия истекла. Обновите страницу.');
    });
    const uid = (req) => req.session.user_id;
    const scope = (req) => req.query.scope;
    function membership(req, ownerOnly = false) {
      const row = db
        .prepare(
          'SELECT c.* FROM communities c JOIN community_members m ON m.community_id=c.id WHERE c.id=? AND c.scope=? AND m.user_id=?',
        )
        .get(req.params.id, scope(req), uid(req));
      if (!row) fail(404, 'Сообщество не найдено.');
      if (ownerOnly && row.owner_id !== uid(req))
        fail(403, 'Действие доступно организатору сообщества.');
      return row;
    }
    function community(row, userId) {
      return {
        id: row.id,
        name: row.name,
        role: row.owner_id === userId ? 'organizer' : 'member',
        memberCount: db
          .prepare('SELECT COUNT(*) AS n FROM community_members WHERE community_id=?')
          .get(row.id).n,
        inviteCode: row.owner_id === userId ? row.invite_code : undefined,
        createdAt: row.created_at,
        scope: row.scope,
        source: 'kupala',
        official: false,
      };
    }
    const material = (row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject,
      url: row.url,
      notes: row.notes,
      kind: row.kind,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'user',
    });
    const sharedTask = (row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject,
      dueDate: row.due_date,
      done: !!row.done,
      createdAt: row.created_at,
    });
    const routeOptions = (body, params = idParams) => ({
      schema: { querystring: scopeQuery, params, ...(body ? { body } : {}) },
    });

    routes.get(
      '/api/learning',
      {
        schema: {
          querystring: object({
            mode: { type: 'string', enum: ['live', 'demo'], default: 'live' },
            tab: {
              type: 'string',
              enum: ['grades', 'attestation', 'absences', 'materials', 'finance', 'orders'],
              default: 'grades',
            },
          }),
        },
      },
      async (req) =>
        req.query.mode === 'demo'
          ? learningDemo(req.query.tab)
          : disconnectedLearning(req.query.tab),
    );
    routes.get('/api/profile', async (req) => {
      const user = db.prepare('SELECT name,email,settings FROM users WHERE id=?').get(uid(req));
      const details = db
        .prepare('SELECT bio,contact FROM profile_details WHERE user_id=?')
        .get(uid(req)) || { bio: '', contact: '' };
      return {
        name: user.name,
        email: user.email,
        ...details,
        group: JSON.parse(user.settings).groupTitle || '',
        source: 'user',
        universityVerified: false,
      };
    });
    routes.put(
      '/api/profile',
      {
        schema: {
          body: object(
            { name: { ...string(80), minLength: 1 }, bio: string(1000), contact: string(200) },
            ['name'],
          ),
        },
      },
      async (req) => {
        const name = nonempty(req.body.name, 'Имя');
        transaction(db, () => {
          db.prepare('UPDATE users SET name=? WHERE id=?').run(name, uid(req));
          db.prepare(
            'INSERT INTO profile_details VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,contact=excluded.contact',
          ).run(uid(req), req.body.bio || '', req.body.contact || '');
        });
        return {
          name,
          bio: req.body.bio || '',
          contact: req.body.contact || '',
          source: 'user',
          universityVerified: false,
        };
      },
    );
    routes.get('/api/preferences', async (req) => ({
      ...basePreferences,
      ...decode(db.prepare('SELECT data FROM preferences WHERE user_id=?').get(uid(req))),
      deliveryStatus: 'local-preferences-only',
    }));
    routes.put('/api/preferences', { schema: { body: object(preferenceFields) } }, async (req) => {
      const data = {
        ...basePreferences,
        ...decode(db.prepare('SELECT data FROM preferences WHERE user_id=?').get(uid(req))),
        ...req.body,
      };
      db.prepare(
        'INSERT INTO preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
      ).run(uid(req), JSON.stringify(data));
      return { ...data, deliveryStatus: 'local-preferences-only' };
    });
    routes.get('/api/materials', { schema: { querystring: scopeQuery } }, async (req) => ({
      items: db
        .prepare('SELECT * FROM materials WHERE user_id=? AND scope=? ORDER BY created_at DESC')
        .all(uid(req), scope(req))
        .map(material),
      source: 'user',
      scope: scope(req),
    }));
    routes.post(
      '/api/materials',
      { schema: { querystring: scopeQuery, body: object(materialFields, ['title']) } },
      async (req, reply) => {
        if (
          db
            .prepare('SELECT COUNT(*) AS n FROM materials WHERE user_id=? AND scope=?')
            .get(uid(req), scope(req)).n >= 500
        )
          fail(409, 'Можно сохранить не более 500 материалов в одном режиме.');
        const b = req.body,
          id = randomUUID(),
          timestamp = now(),
          url = safeLink(b.url);
        const kind = b.kind || (url ? 'link' : 'note');
        if (kind === 'link' && !url) fail(400, 'Для ссылки нужен HTTPS-адрес.');
        db.prepare('INSERT INTO materials VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          id,
          uid(req),
          scope(req),
          nonempty(b.title, 'Название'),
          b.subject || '',
          url,
          b.notes || '',
          kind,
          timestamp,
          timestamp,
        );
        reply.code(201);
        return material(db.prepare('SELECT * FROM materials WHERE id=?').get(id));
      },
    );
    routes.patch('/api/materials/:id', routeOptions(object(materialFields)), async (req) => {
      const row = db
        .prepare('SELECT * FROM materials WHERE id=? AND user_id=? AND scope=?')
        .get(req.params.id, uid(req), scope(req));
      if (!row) fail(404, 'Материал не найден.');
      const b = { ...material(row), ...req.body };
      b.url = safeLink(b.url);
      if (b.kind === 'link' && !b.url) fail(400, 'Для ссылки нужен HTTPS-адрес.');
      db.prepare(
        'UPDATE materials SET title=?,subject=?,url=?,notes=?,kind=?,updated_at=? WHERE id=?',
      ).run(nonempty(b.title, 'Название'), b.subject, b.url, b.notes, b.kind, now(), row.id);
      return material(db.prepare('SELECT * FROM materials WHERE id=?').get(row.id));
    });
    routes.delete('/api/materials/:id', routeOptions(), async (req) => {
      const result = db
        .prepare('DELETE FROM materials WHERE id=? AND user_id=? AND scope=?')
        .run(req.params.id, uid(req), scope(req));
      if (!result.changes) fail(404, 'Материал не найден.');
      return { ok: true };
    });
    routes.get('/api/communities', { schema: { querystring: scopeQuery } }, async (req) => ({
      items: db
        .prepare(
          'SELECT c.* FROM communities c JOIN community_members m ON m.community_id=c.id WHERE m.user_id=? AND c.scope=? ORDER BY c.created_at DESC LIMIT 50',
        )
        .all(uid(req), scope(req))
        .map((row) => community(row, uid(req))),
      source: 'kupala',
      official: false,
    }));
    routes.post(
      '/api/communities',
      {
        schema: {
          querystring: scopeQuery,
          body: object({ name: { ...string(120), minLength: 1 } }, ['name']),
        },
      },
      async (req, reply) => {
        if (
          db
            .prepare('SELECT COUNT(*) AS n FROM communities WHERE owner_id=? AND scope=?')
            .get(uid(req), scope(req)).n >= 10
        )
          fail(409, 'Можно создать не более десяти сообществ в одном режиме.');
        if (
          db
            .prepare(
              'SELECT COUNT(*) AS n FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.user_id=? AND c.scope=?',
            )
            .get(uid(req), scope(req)).n >= 50
        )
          fail(409, 'Можно участвовать не более чем в 50 сообществах одного режима.');
        const id = randomUUID(),
          code = randomBytes(12).toString('hex'),
          timestamp = now();
        transaction(db, () => {
          db.prepare('INSERT INTO communities VALUES(?,?,?,?,?,?)').run(
            id,
            scope(req),
            nonempty(req.body.name, 'Название'),
            uid(req),
            code,
            timestamp,
          );
          db.prepare('INSERT INTO community_members VALUES(?,?,?)').run(id, uid(req), timestamp);
        });
        reply.code(201);
        return community(db.prepare('SELECT * FROM communities WHERE id=?').get(id), uid(req));
      },
    );
    routes.post(
      '/api/communities/join',
      {
        schema: {
          querystring: scopeQuery,
          body: object({ code: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, ['code']),
        },
      },
      async (req) => {
        const row = db
          .prepare('SELECT * FROM communities WHERE invite_code=? AND scope=?')
          .get(req.body.code.toLowerCase(), scope(req));
        if (!row) fail(404, 'Приглашение не найдено для выбранного режима.');
        const alreadyJoined = db
          .prepare('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?')
          .get(row.id, uid(req));
        if (
          !alreadyJoined &&
          db.prepare('SELECT COUNT(*) AS n FROM community_members WHERE community_id=?').get(row.id)
            .n >= 100
        )
          fail(409, 'В сообществе уже 100 участников.');
        if (
          !alreadyJoined &&
          db
            .prepare(
              'SELECT COUNT(*) AS n FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.user_id=? AND c.scope=?',
            )
            .get(uid(req), scope(req)).n >= 50
        )
          fail(409, 'Можно участвовать не более чем в 50 сообществах одного режима.');
        db.prepare('INSERT OR IGNORE INTO community_members VALUES(?,?,?)').run(
          row.id,
          uid(req),
          now(),
        );
        return community(row, uid(req));
      },
    );
    routes.get('/api/communities/:id', routeOptions(), async (req) => {
      const row = membership(req);
      const members = db
        .prepare(
          'SELECT u.id,u.name FROM users u JOIN community_members m ON m.user_id=u.id WHERE m.community_id=? ORDER BY m.joined_at',
        )
        .all(row.id)
        .map((user) => ({ ...user, role: user.id === row.owner_id ? 'organizer' : 'member' }));
      const posts = db
        .prepare(
          'SELECT p.*,u.name AS author_name FROM community_posts p JOIN users u ON u.id=p.author_id WHERE p.community_id=? ORDER BY p.created_at DESC LIMIT 200',
        )
        .all(row.id)
        .map((p) => ({
          id: p.id,
          title: p.title,
          body: p.body,
          authorId: p.author_id,
          authorName: p.author_name,
          createdAt: p.created_at,
        }));
      const tasks = db
        .prepare(
          'SELECT * FROM community_tasks WHERE community_id=? ORDER BY created_at DESC LIMIT 200',
        )
        .all(row.id)
        .map(sharedTask);
      const polls = db
        .prepare(
          'SELECT * FROM community_polls WHERE community_id=? ORDER BY created_at DESC LIMIT 100',
        )
        .all(row.id)
        .map((p) => ({
          id: p.id,
          question: p.question,
          createdAt: p.created_at,
          options: JSON.parse(p.options).map((option) => ({
            ...option,
            votes: db
              .prepare('SELECT COUNT(*) AS n FROM community_votes WHERE poll_id=? AND option_id=?')
              .get(p.id, option.id).n,
          })),
          myOptionId:
            db
              .prepare('SELECT option_id FROM community_votes WHERE poll_id=? AND user_id=?')
              .get(p.id, uid(req))?.option_id || null,
        }));
      return {
        community: community(row, uid(req)),
        members,
        posts,
        tasks,
        polls,
        source: 'kupala',
        official: false,
      };
    });
    routes.post('/api/communities/:id/invite', routeOptions(object({})), async (req) => {
      const row = membership(req, true),
        code = randomBytes(12).toString('hex');
      db.prepare('UPDATE communities SET invite_code=? WHERE id=?').run(code, row.id);
      return { inviteCode: code };
    });
    routes.delete(
      '/api/communities/:id/members/:memberId',
      routeOptions(undefined, object({ id: idSchema, memberId: idSchema }, ['id', 'memberId'])),
      async (req) => {
        const row = membership(req);
        if (req.params.memberId === row.owner_id)
          fail(400, 'Организатор не может покинуть своё сообщество.');
        if (req.params.memberId !== uid(req) && row.owner_id !== uid(req))
          fail(403, 'Удаление участников доступно организатору.');
        db.prepare('DELETE FROM community_members WHERE community_id=? AND user_id=?').run(
          row.id,
          req.params.memberId,
        );
        db.prepare(
          'DELETE FROM community_votes WHERE user_id=? AND poll_id IN (SELECT id FROM community_polls WHERE community_id=?)',
        ).run(req.params.memberId, row.id);
        return { ok: true };
      },
    );
    routes.post(
      '/api/communities/:id/posts',
      routeOptions(
        object(
          { title: { ...string(200), minLength: 1 }, body: { ...string(4000), minLength: 1 } },
          ['title', 'body'],
        ),
      ),
      async (req, reply) => {
        const row = membership(req, true),
          id = randomUUID(),
          timestamp = now();
        db.prepare('INSERT INTO community_posts VALUES(?,?,?,?,?,?)').run(
          id,
          row.id,
          uid(req),
          nonempty(req.body.title, 'Заголовок'),
          nonempty(req.body.body, 'Текст'),
          timestamp,
        );
        reply.code(201);
        return {
          id,
          title: req.body.title.trim(),
          body: req.body.body.trim(),
          authorId: uid(req),
          authorName: req.session.name,
          createdAt: timestamp,
        };
      },
    );
    routes.delete(
      '/api/communities/:id/posts/:postId',
      routeOptions(undefined, object({ id: idSchema, postId: idSchema }, ['id', 'postId'])),
      async (req) => {
        const row = membership(req, true);
        if (
          !db
            .prepare('DELETE FROM community_posts WHERE id=? AND community_id=?')
            .run(req.params.postId, row.id).changes
        )
          fail(404, 'Объявление не найдено.');
        return { ok: true };
      },
    );
    routes.post(
      '/api/communities/:id/tasks',
      routeOptions(object(taskFields, ['title'])),
      async (req, reply) => {
        const row = membership(req, true),
          id = randomUUID(),
          timestamp = now();
        const b = req.body;
        db.prepare('INSERT INTO community_tasks VALUES(?,?,?,?,?,?,?)').run(
          id,
          row.id,
          nonempty(b.title, 'Задача'),
          b.subject || '',
          date(b.dueDate),
          b.done ? 1 : 0,
          timestamp,
        );
        reply.code(201);
        return sharedTask(db.prepare('SELECT * FROM community_tasks WHERE id=?').get(id));
      },
    );
    routes.patch(
      '/api/communities/:id/tasks/:taskId',
      routeOptions(
        object(taskFields),
        object({ id: idSchema, taskId: idSchema }, ['id', 'taskId']),
      ),
      async (req) => {
        const row = membership(req, true),
          old = db
            .prepare('SELECT * FROM community_tasks WHERE id=? AND community_id=?')
            .get(req.params.taskId, row.id);
        if (!old) fail(404, 'Общая задача не найдена.');
        const b = { ...sharedTask(old), ...req.body };
        db.prepare('UPDATE community_tasks SET title=?,subject=?,due_date=?,done=? WHERE id=?').run(
          nonempty(b.title, 'Задача'),
          b.subject,
          date(b.dueDate),
          b.done ? 1 : 0,
          old.id,
        );
        return sharedTask(db.prepare('SELECT * FROM community_tasks WHERE id=?').get(old.id));
      },
    );
    routes.delete(
      '/api/communities/:id/tasks/:taskId',
      routeOptions(undefined, object({ id: idSchema, taskId: idSchema }, ['id', 'taskId'])),
      async (req) => {
        const row = membership(req, true);
        if (
          !db
            .prepare('DELETE FROM community_tasks WHERE id=? AND community_id=?')
            .run(req.params.taskId, row.id).changes
        )
          fail(404, 'Общая задача не найдена.');
        return { ok: true };
      },
    );
    routes.post(
      '/api/communities/:id/polls',
      routeOptions(
        object(
          {
            question: { ...string(300), minLength: 1 },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 8,
              uniqueItems: true,
              items: { ...string(150), minLength: 1 },
            },
          },
          ['question', 'options'],
        ),
      ),
      async (req, reply) => {
        const row = membership(req, true),
          id = randomUUID();
        const labels = req.body.options.map((option) => nonempty(option, 'Вариант ответа'));
        if (new Set(labels).size !== labels.length)
          fail(400, 'Варианты ответа должны различаться.');
        const options = labels.map((text) => ({ id: randomUUID(), text }));
        db.prepare('INSERT INTO community_polls VALUES(?,?,?,?,?)').run(
          id,
          row.id,
          nonempty(req.body.question, 'Вопрос'),
          JSON.stringify(options),
          now(),
        );
        reply.code(201);
        return {
          id,
          question: req.body.question.trim(),
          options: options.map((o) => ({ ...o, votes: 0 })),
          myOptionId: null,
        };
      },
    );
    routes.post(
      '/api/communities/:id/polls/:pollId/vote',
      routeOptions(
        object({ optionId: idSchema }, ['optionId']),
        object({ id: idSchema, pollId: idSchema }, ['id', 'pollId']),
      ),
      async (req) => {
        const row = membership(req);
        const poll = db
          .prepare('SELECT * FROM community_polls WHERE id=? AND community_id=?')
          .get(req.params.pollId, row.id);
        if (!poll) fail(404, 'Опрос не найден.');
        if (!JSON.parse(poll.options).some((o) => o.id === req.body.optionId))
          fail(400, 'Вариант ответа не найден.');
        db.prepare(
          'INSERT INTO community_votes VALUES(?,?,?) ON CONFLICT(poll_id,user_id) DO UPDATE SET option_id=excluded.option_id',
        ).run(poll.id, uid(req), req.body.optionId);
        return { ok: true, optionId: req.body.optionId };
      },
    );
    routes.get(
      '/api/campus',
      {
        schema: {
          querystring: object(
            {
              mode: { type: 'string', enum: ['live', 'demo'], default: 'live' },
              groupId: { type: 'string', pattern: '^(demo|[0-9]{1,10})$' },
              start: { type: 'string', format: 'date' },
            },
            ['start', 'groupId'],
          ),
        },
      },
      async (req) => {
        if (!validDate(req.query.start) || weekStart(req.query.start) !== req.query.start)
          fail(400, 'Выберите начало учебной недели.');
        if (req.query.mode === 'live' && req.query.groupId === 'demo')
          fail(400, 'Выберите реальную группу.');
        const schedule =
          req.query.mode === 'demo'
            ? { ...demoSchedule(req.query.start), source: 'demo', stale: false, fetchedAt: null }
            : await grsu.schedule(req.query.groupId, req.query.start);
        const map = new Map();
        for (const lesson of schedule.days.flatMap((day) => day.lessons)) {
          if (!lesson.address) continue;
          if (!map.has(lesson.address)) map.set(lesson.address, new Map());
          const rooms = map.get(lesson.address);
          const room = lesson.room || 'Не указана';
          if (!rooms.has(room)) rooms.set(room, []);
          rooms.get(room).push({
            date: lesson.date,
            start: lesson.start,
            end: lesson.end,
            title: lesson.title,
            subgroup: lesson.subgroup || '',
          });
        }
        return {
          source: schedule.source,
          stale: schedule.stale,
          fetchedAt: schedule.fetchedAt,
          warning: schedule.warning,
          coverage: {
            groupId: req.query.groupId,
            start: req.query.start,
            scope: 'one-group-only',
            completeRoomInventory: false,
          },
          message:
            'Показаны только помещения в расписании выбранной группы. Отсутствие занятий не подтверждает свободу аудитории.',
          buildings: [...map].map(([address, rooms]) => ({
            address,
            mapUrl: `https://yandex.by/maps/?text=${encodeURIComponent('Гродно, ' + address)}`,
            rooms: [...rooms].map(([room, lessons]) => ({ room, lessons })),
          })),
        };
      },
    );
  });
}
