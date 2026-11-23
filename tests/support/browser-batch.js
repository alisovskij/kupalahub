// Local-only bridge for browser QA in environments that prohibit listening on TCP ports.
// The browser supplies HTTP requests in a temporary JSON file; Fastify handles each request.
import { readFile, writeFile } from 'node:fs/promises';
import { buildApp } from '../../server/app.js';
const [input, output, dbPath] = process.argv.slice(2);
if (!input || !output || !dbPath)
  throw new Error('Expected input JSON, output JSON and temporary SQLite path');
const requests = JSON.parse(await readFile(input, 'utf8'));
if (!Array.isArray(requests) || requests.length > 100) throw new Error('Invalid request batch');
const app = buildApp({
  dbPath,
  allowedOrigins: ['http://kupala-app.test'],
  grsuOptions: { spacing: 0 },
});
try {
  const results = [];
  for (const { id, request } of requests) {
    const response = await app.inject(request);
    results.push({
      id,
      status: response.statusCode,
      headers: response.headers,
      body: response.body,
    });
  }
  await writeFile(output, JSON.stringify(results), { mode: 0o600 });
} finally {
  await app.close();
}
