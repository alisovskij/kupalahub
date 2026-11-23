import { validDate, weekStart, shiftDay, weekDays } from '../shared/calendar.js';

const modeField = { type: 'string', enum: ['live', 'demo'], default: 'live' };
const startField = { type: 'string', format: 'date', maxLength: 10 };
const query = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const groupField = { type: 'string', pattern: '^(demo|[0-9]{1,10})$' };
const teacherIdField = { type: 'string', pattern: '^-?[0-9]{1,10}$' };
const examType = /экзам|зач[её]т|конс|защит/i;

const demoTeachers = [
  { id: '-101', fullname: 'Соколова Анна Сергеевна', post: 'доцент', email: 'teacher@example.invalid', phone: '', description: 'Базы данных и информационные системы · демонстрационный профиль' },
  { id: '-102', fullname: 'Миронов Павел Андреевич', post: 'старший преподаватель', email: '', phone: '', description: 'Алгоритмы и структуры данных · демонстрационный профиль' },
  { id: '-103', fullname: 'Романова Елена Викторовна', post: 'преподаватель', email: '', phone: '', description: 'Иностранный язык · демонстрационный профиль' },
];
const metadata = mode => ({ source: mode === 'demo' ? 'demo' : 'grsu', status: 'ready', fetchedAt: new Date().toISOString(), stale: false });
function requireMonday(start) {
  if (!validDate(start) || weekStart(start) !== start) {
    const error = new Error('Выберите понедельник нужной недели.'); error.statusCode = 400; throw error;
  }
}
function demoTeacherSchedule(id, start) {
  const teacher = demoTeachers.find(t => t.id === id);
  if (!teacher) { const error = new Error('Преподаватель не найден в демо.'); error.statusCode = 404; throw error; }
  const dates = weekDays(start);
  const lessons = [
    { key: `teacher-demo-${id}-1`, date: dates[0], start: '10:05', end: '11:30', title: id === '-101' ? 'Базы данных' : id === '-102' ? 'Алгоритмы и структуры данных' : 'Английский язык', type: 'лек.', room: '214', address: 'Ожешко, 22', groups: [{ id: 'demo', title: 'ПО-22 · демо', students: 24, course: '2', faculty: 'ФМИ', department: 'дневная форма' }] },
    { key: `teacher-demo-${id}-2`, date: dates[2], start: '12:10', end: '13:35', title: 'Консультация по дисциплине', type: 'конс.', room: '310', address: 'Ожешко, 22', groups: [] },
  ].map(l => ({ ...l, teacher: teacher.fullname, teacherId: id, subgroupId: '0', subgroup: '' }));
  return { ...metadata('demo'), teacher, days: dates.map(date => ({ date, lessons: lessons.filter(l => l.date === date) })), subgroups: [], changes: [], coverage: { start, end: shiftDay(start, 6), teacherId: id, complete: false } };
}
function demoExams(start) {
  return [
    { title: 'Базы данных', type: 'Экзамен', day: 2, start: '10:05', end: '11:30', room: '214' },
    { title: 'Алгоритмы и структуры данных', type: 'Зачёт', day: 4, start: '12:10', end: '13:35', room: '310' },
    { title: 'Базы данных', type: 'Консультация', day: 1, start: '13:30', end: '14:55', room: '214' },
  ].map((l, i) => ({ key: `exam-demo-${start}-${i}`, date: shiftDay(start, l.day), start: l.start, end: l.end, title: l.title, type: l.type, room: l.room, address: 'Ожешко, 22', teacher: demoTeachers[i % demoTeachers.length].fullname, teacherId: demoTeachers[i % demoTeachers.length].id, subgroupId: '0', subgroup: '' })).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/** Public university data, explicitly isolated from illustrative data. */
export function registerPublicRoutes(app, { grsu }) {
  app.get('/api/teachers', { schema: { querystring: query({ mode: modeField, q: { type: 'string', maxLength: 120 } }) } }, async request => {
    const { mode, q = '' } = request.query;
    const result = mode === 'demo' ? { ...metadata(mode), items: demoTeachers } : await grsu.teachers();
    const search = q.trim().toLocaleLowerCase('ru-RU');
    return { ...result, status: result.stale ? 'partial' : 'ready', items: result.items.filter(t => !search || `${t.fullname} ${t.post} ${t.description}`.toLocaleLowerCase('ru-RU').includes(search)) };
  });
  app.get('/api/teachers/:id/schedule', { schema: { params: query({ id: teacherIdField }, ['id']), querystring: query({ mode: modeField, start: startField }, ['start']) } }, async request => {
    const { mode, start } = request.query; requireMonday(start);
    const result = mode === 'demo' ? demoTeacherSchedule(request.params.id, start) : await grsu.teacherSchedule(request.params.id, start);
    return { ...result, status: result.stale ? 'partial' : 'ready' };
  });
  app.get('/api/exams', { schema: { querystring: query({ mode: modeField, groupId: groupField, start: startField }, ['groupId', 'start']) } }, async request => {
    const { mode, groupId, start } = request.query; requireMonday(start);
    if (mode === 'demo') return { ...metadata(mode), items: demoExams(start), coverage: { start, end: shiftDay(start, 6), groupId: 'demo', complete: false }, subgroups: [] };
    if (groupId === 'demo') { const error = new Error('Выберите реальную группу.'); error.statusCode = 400; throw error; }
    const result = await grsu.schedule(groupId, start);
    return { source: result.source, status: result.stale ? 'partial' : 'ready', fetchedAt: result.fetchedAt, stale: result.stale, ...(result.warning ? { warning: result.warning } : {}), items: result.days.flatMap(day => day.lessons).filter(l => examType.test(l.type)), subgroups: result.subgroups, coverage: { start, end: shiftDay(start, 6), groupId, complete: false } };
  });
}
