import { buildApp } from './app.js';
const app = buildApp();
try {
  await app.listen({
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '127.0.0.1',
  });
  console.log(`Kupala Hub: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3001}`);
} catch (e) {
  console.error(`Не удалось запустить сервер: ${e.code || e.message}`);
  process.exitCode = 1;
  await app.close();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
