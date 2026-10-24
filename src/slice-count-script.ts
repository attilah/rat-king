export const sliceCountScript = `
const workerData = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(workerData.path);
url.searchParams.set('mode', 'ro');
const db = new DatabaseSync(url, { readOnly: true, allowExtension: false });
try {
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=1000;');
  const rows = db.prepare(
    'WITH matched AS (SELECT runs.conversation_id, min(chunks.started_at) AS first_at ' +
    'FROM chunks JOIN runs ON chunks.run_id=runs.run_id ' +
    'WHERE chunks.started_at >= ? AND instr(chunks.text, ?) > 0 AND (? IS NULL OR chunks.role=?) ' +
    'GROUP BY runs.conversation_id) ' +
    "SELECT strftime('%Y-%m-%d', first_at/1000, 'unixepoch') AS day, count(*) AS conversations " +
    'FROM matched GROUP BY day ORDER BY day'
  ).all(workerData.since, workerData.literal, workerData.role, workerData.role);
  let conversations = 0;
  for (const row of rows) conversations += row.conversations;
  process.stdout.write(JSON.stringify({ conversations, by_day: rows }));
} finally {
  db.close();
}
`;
