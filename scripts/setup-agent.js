import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
let env = '';
try {
  env = await readFile('.env', 'utf8');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (env && !env.endsWith('\n')) env += '\n';
const has = (name) => new RegExp('^' + name + '=', 'm').test(env);
const tokenLine = env.match(/^AGENT_SERVICE_TOKEN=(.*)$/m);
const tokenValue = tokenLine?.[1].trim() || '';
const tokenIsBlank =
  tokenValue.startsWith('#') || !tokenValue || /^["']{2}(?:\s*#.*)?$/.test(tokenValue);
if (!tokenLine) env += '\nAGENT_SERVICE_TOKEN=' + randomBytes(32).toString('hex') + '\n';
else if (tokenIsBlank)
  env = env.replace(
    /^AGENT_SERVICE_TOKEN=.*$/m,
    'AGENT_SERVICE_TOKEN=' + randomBytes(32).toString('hex'),
  );
// The assistant uses only flash; remove the obsolete model switch from earlier setup.
env = env.replace(/^DEEPSEEK_MODEL=.*(?:\r?\n|$)/gm, '');
for (const [key, value] of Object.entries({
  AI_SERVICE_URL: 'http://127.0.0.1:8001',
  KUPALA_BACKEND_URL: 'http://127.0.0.1:3001',
  DEEPSEEK_BASE_URL: 'https://llm.azati.ai',
  DEEPSEEK_API_KEY: '',
}))
  if (!has(key)) env += key + '=' + value + '\n';
await writeFile('.env', env, { mode: 0o600 });
await chmod('.env', 0o600);
console.log(
  'Настройки агента подготовлены в .env. Добавьте DEEPSEEK_API_KEY; секреты не выводились.',
);
