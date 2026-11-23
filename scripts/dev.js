import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
try {
  process.loadEnvFile('.env');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    stdio: 'inherit',
  }),
];
const python =
  process.env.PYTHON_BIN ||
  (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (existsSync(python))
  children.push(
    spawn(
      python,
      [
        '-m',
        'uvicorn',
        'ai_service.app:app',
        '--host',
        '127.0.0.1',
        '--port',
        '8001',
        '--no-access-log',
      ],
      { stdio: 'inherit' },
    ),
  );
else
  console.log(
    'Python-сервис не запущен: установите ai_service/requirements.txt в .venv. Основное приложение доступно без ассистента.',
  );
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((p) => p.kill());
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code || 0));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
