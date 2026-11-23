import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

const PORTAL = 'https://edu.grsu.by';

/** Only a fixed university endpoint receives credentials; redirects are never followed. */
async function post(path, parameters, fetchImpl) {
  const response = await fetchImpl(PORTAL + path, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(parameters),
  });
  if (!response.ok) throw new Error('network');
  const body = await response.text();
  if (body.length > 5_000_000) throw new Error('response');
  let result;
  try { result = JSON.parse(body); } catch { throw new Error('response'); }
  if (!result || typeof result !== 'object') throw new Error('response');
  return result;
}

const knownCodes = new Set([
  'invalidlogin', 'invalidtoken', 'servicenotavailable', 'webservicesdisabled',
  'accessexception', 'requireloginerror', 'nopermissions', 'restricteduser',
  'cannotcreatetoken', 'missingparam', 'invalidparameter', 'wsaccessuserexpired',
  'usernotfullysetup', 'moodle_exception', 'invalidrecord',
]);
const safeCode = value => knownCodes.has(value) ? value : 'unknown_error';
const isError = result => !!(result.error || result.exception || result.errorcode);

/** Returns only metadata and aggregate counts; does not persist credentials or portal content. */
export async function probePortal({ username, password, token, fetchImpl = fetch }) {
  let accessToken = token;
  if (!accessToken) {
    const auth = await post('/login/token.php', { username, password, service: 'moodle_mobile_app' }, fetchImpl);
    if (isError(auth) || typeof auth.token !== 'string' || !auth.token) {
      return { authenticated: false, stage: 'token', errorCode: safeCode(auth.errorcode),
        explanation: 'Токен не получен. Возможны особенности SSO, настройки сервиса или ошибка входа. Один ответ не позволяет различить все причины.' };
    }
    accessToken = auth.token;
  }
  const call = (wsfunction, params = {}) => post('/webservice/rest/server.php', {
    wstoken: accessToken, moodlewsrestformat: 'json', wsfunction, ...params,
  }, fetchImpl);
  const info = await call('core_webservice_get_site_info');
  if (isError(info)) return { authenticated: false, stage: 'site_info', errorCode: safeCode(info.errorcode) };
  if (Array.isArray(info) || !Number.isSafeInteger(Number(info.userid)) || Number(info.userid) <= 0
      || !Array.isArray(info.functions) || info.functions.some(f => !f || typeof f.name !== 'string')) {
    throw new Error('response');
  }
  const functions = new Set(info.functions.map(f => f.name));
  const report = {
    authenticated: true,
    service: 'Moodle Web Services',
    capabilities: {
      ownCourses: functions.has('core_enrol_get_users_courses'),
      courseContents: functions.has('core_course_get_contents'),
      assignments: functions.has('mod_assign_get_assignments'),
      ownSubmissionStatus: functions.has('mod_assign_get_submission_status'),
      courseParticipants: functions.has('core_enrol_get_enrolled_users'),
      gradeOverview: functions.has('gradereport_overview_get_course_grades'),
    },
    notes: [
      'Наличие функции в сервисе не гарантирует доступ ко всем её данным.',
      'Участники курса не равнозначны составу учебной группы. Роль старосты этим не подтверждается.',
      'Пароль, токен, ФИО, идентификаторы и содержимое заданий в отчёт не включены.',
    ],
  };
  if (report.capabilities.ownCourses && (Number.isInteger(info.userid) || /^\d+$/.test(String(info.userid)))) {
    const courses = await call('core_enrol_get_users_courses', { userid: String(info.userid) });
    report.coursesRead = Array.isArray(courses) ? { ok: true, count: courses.length } : { ok: false, errorCode: safeCode(courses.errorcode) };
    const ids = Array.isArray(courses) ? courses.filter(c => Number.isInteger(c.id) && c.id > 0).slice(0, 10).map(c => c.id) : [];
    if (ids.length && report.capabilities.assignments) {
      const params = Object.fromEntries(ids.map((id, i) => [`courseids[${i}]`, String(id)]));
      const assignments = await call('mod_assign_get_assignments', params);
      if (isError(assignments) || !Array.isArray(assignments.courses)) {
        report.assignmentsRead = { ok: false, errorCode: safeCode(assignments.errorcode) };
      } else {
        const rows = assignments.courses.flatMap(c => Array.isArray(c.assignments) ? c.assignments : []);
        report.assignmentsRead = { ok: true, requestedCourses: ids.length, returnedCourses: assignments.courses.length,
          assignments: rows.length, withDeadline: rows.filter(a => Number(a.duedate) > 0).length };
      }
    }
  }
  return report;
}

async function question(label) {
  const rl = createInterface({ input: stdin, output: stdout });
  try { return (await rl.question(label)).trim(); } finally { rl.close(); }
}
async function hiddenQuestion(label) {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) throw new Error('tty');
  stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003' || char === '\u0004') { cleanup(); reject(new Error('cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char >= ' ' && char !== '\u001b') value += char;
      }
    };
    stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
  });
}
async function main() {
  console.log('Проверка собственного аккаунта edu.grsu.by. Запросы только на чтение данных.');
  console.log('1 — логин и пароль; 2 — уже выданный токен. Секреты вводятся скрыто и не сохраняются.');
  console.log('Выдача токена может создать ключ на сервере Moodle. Он может оставаться действующим после проверки; при необходимости отзовите его в настройках портала.');
  const mode = await question('Выберите 1 или 2: ');
  let credentials;
  if (mode === '1') {
    const username = await question('Логин образовательного портала: ');
    const password = await hiddenQuestion('Пароль (ввод скрыт): ');
    if (!username || !password) throw new Error('empty');
    credentials = { username, password };
  } else if (mode === '2') {
    const token = await hiddenQuestion('Токен (ввод скрыт): ');
    if (!token) throw new Error('empty');
    credentials = { token };
  } else throw new Error('cancelled');
  try { console.log(JSON.stringify(await probePortal(credentials), null, 2)); }
  finally { credentials = null; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never echo server messages or transport errors: they may contain secrets.
    const messages = { tty: 'Нужен интерактивный терминал со скрытым вводом.', cancelled: 'Проверка отменена.', empty: 'Логин или секрет не заполнены.' };
    console.error(messages[error.message] || 'Проверка не завершена: сеть, таймаут или неожиданный ответ портала. Секреты не выводились.');
    process.exitCode = 1;
  });
}
