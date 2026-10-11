// Runs the Worker in the real Workers runtime (`wrangler dev`) against a running asset-laravel,
// with a stand-in LINE API that records every reply. Sends signed webhooks and checks the answers,
// then runs the 08:00 cron once and checks the morning alert.
//
// usage:  node tool/e2e.mjs [apiUrl]
//   apiUrl   asset-laravel with APP_DEMO=true and freshly seeded data (default http://127.0.0.1:8000)
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_URL = process.argv[2] ?? 'http://127.0.0.1:8000';
const SECRET = 'local-e2e-secret';
const LINE_PORT = 9911;
const WORKER = 'http://127.0.0.1:8799';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Local KV outlives the dev server, and old subscribers would get the alert too.
const STATE = mkdtempSync(join(tmpdir(), 'asset-line-bot-e2e-'));

const lineCalls = [];
const line = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    lineCalls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
}).listen(LINE_PORT, '127.0.0.1');

const worker = spawn(
  'npx',
  ['wrangler', 'dev', '--port', '8799', '--ip', '127.0.0.1', '--show-interactive-dev-session=false', '--test-scheduled', '--persist-to', STATE,
    '--var', `LINE_API:http://127.0.0.1:${LINE_PORT}`, '--var', `API_URL:${API_URL}`,
    '--var', `LINE_CHANNEL_SECRET:${SECRET}`, '--var', 'LINE_CHANNEL_ACCESS_TOKEN:local-e2e-token'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
let workerLog = '';
worker.stdout.on('data', (d) => (workerLog += d));
worker.stderr.on('data', (d) => (workerLog += d));

for (let i = 0; i < 120 && (await fetch(`${WORKER}/`).then((r) => r.status, () => 0)) !== 404; i++) await sleep(500);

let replyToken = 0;
/** Posts one signed event and returns what the bot replied to it. */
async function send(event, { secret = SECRET } = {}) {
  const token = `reply-${++replyToken}`;
  const body = JSON.stringify({ destination: 'Ubot', events: event ? [{ replyToken: token, ...event }] : [] });
  const res = await fetch(`${WORKER}/webhook`, {
    method: 'POST',
    body,
    headers: { 'x-line-signature': createHmac('sha256', secret).update(body).digest('base64') },
  });
  for (let i = 0; i < 80; i++) {
    const answer = lineCalls.find((c) => c.path === '/v2/bot/message/reply' && c.body.replyToken === token);
    if (answer || !event || res.status !== 200) return { status: res.status, messages: answer?.body.messages };
    await sleep(250);
  }
  return { status: res.status, messages: undefined };
}
const userText = (text) => ({ type: 'message', source: { type: 'user', userId: 'U-e2e' }, message: { type: 'text', text } });

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`ok    ${name}`);
  } catch (error) {
    results.push(`FAIL  ${name}: ${error.message}`);
  }
}
const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};

await check('a wrong signature is refused', async () => {
  const { status } = await send(userText('AV-67-0037'), { secret: 'wrong' });
  expect(status === 401, `status ${status}`);
});

await check('Verify (no events) gets 200', async () => {
  const { status } = await send(null);
  expect(status === 200, `status ${status}`);
});

await check('a tag gets the asset card with the typing dots first', async () => {
  const { messages } = await send(userText('av-67-0037'));
  const card = messages?.[0];
  expect(card?.type === 'flex', `got ${JSON.stringify(messages)?.slice(0, 200)}`);
  expect(card.altText.includes('กล้องถ่ายภาพ Sony A7'), card.altText);
  expect(card.contents.footer.contents[0].action.uri.endsWith('#/a/AV-67-0037'), 'scanner link');
  expect(lineCalls.some((c) => c.path === '/v2/bot/chat/loading/start' && c.body.chatId === 'U-e2e'), 'no loading call');
  expect(lineCalls.every((c) => c.auth === 'Bearer local-e2e-token'), 'LINE calls carry the channel token');
});

await check('"เกินกำหนด" lists the seeded overdue projector', async () => {
  const { messages } = await send(userText('เกินกำหนด'));
  const json = JSON.stringify(messages);
  expect(messages?.[0]?.type === 'flex', json?.slice(0, 200));
  expect(json.includes('AV-67-0034') && json.includes('เกิน '), json.slice(0, 300));
});

await check('an unknown tag says it was not found', async () => {
  const { messages } = await send(userText('XX-00-0000'));
  expect(messages?.[0]?.text?.includes('ไม่พบรหัส XX-00-0000'), JSON.stringify(messages));
});

await check('a greeting gets the help text with quick replies, the alert among them', async () => {
  const { messages } = await send(userText('สวัสดีครับ'));
  expect(messages?.[0]?.quickReply?.items.some((item) => item.action.text === 'รับแจ้งเตือน'), JSON.stringify(messages)?.slice(0, 200));
});

await check('"รับแจ้งเตือน", then the 08:00 cron, sends that user one alert in one multicast', async () => {
  const { messages } = await send(userText('รับแจ้งเตือน'));
  expect(messages?.[0]?.text?.includes('08:00'), JSON.stringify(messages));
  const res = await fetch(`${WORKER}/__scheduled?cron=0+1+*+*+*`);
  expect(res.ok, `__scheduled ${res.status}`);
  const multicasts = () => lineCalls.filter((c) => c.path === '/v2/bot/message/multicast');
  for (let i = 0; i < 960 && multicasts().length === 0; i++) await sleep(250);
  await sleep(2000);
  const sent = multicasts();
  expect(sent.length === 1, `${sent.length} multicasts`);
  expect(JSON.stringify(sent[0].body.to) === '["U-e2e"]', `to ${JSON.stringify(sent[0].body.to)}`);
  expect(sent[0].body.messages.length === 1, `${sent[0].body.messages.length} messages`);
  expect(sent[0].body.messages[0].altText.startsWith('แจ้งเตือนเช้านี้'), sent[0].body.messages[0].altText);
});

results.forEach((r) => console.log(r));
if (results.some((r) => r.startsWith('FAIL'))) console.log(`\nworker log:\n${workerLog.slice(-3000)}`);
worker.kill();
line.close();
rmSync(STATE, { recursive: true, force: true });
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
