import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { forgetToken } from '../src/api.js';
import worker from '../src/index.js';

const env = {
  LINE_CHANNEL_SECRET: 's3cret',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  API_URL: 'https://assets.test',
  APP_URL: 'https://scan.test/',
  LINE_API: 'https://line.test',
};
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const asset = {
  tag: 'AV-67-0037',
  name: 'กล้องถ่ายภาพ Sony A7',
  category: 'โสตทัศนูปกรณ์',
  department: 'กองเทคโนโลยีสารสนเทศ',
  location: null,
  custodian: null,
  condition: { value: 'usable', label: 'ใช้งานได้', tone: 'success' },
  availability: { value: 'available', label: 'ว่าง', tone: 'success' },
  book_value: '12845.84',
  loan: null,
  actions: ['hand_over'],
};

beforeEach(() => forgetToken());
afterEach(() => {
  globalThis.fetch = realFetch;
});

function textMessage(text, n = 1, userId = 'U1') {
  return { type: 'message', replyToken: `reply-${n}`, source: { type: 'user', userId }, message: { type: 'text', text } };
}

/** Workers KV in memory, keeping the expirationTtl each key was last written with. */
function fakeKv(names = []) {
  const ttl = new Map(names.map((name) => [name, undefined]));
  return {
    ttl,
    async get(key) {
      return ttl.has(key) ? '' : null;
    },
    async put(key, value, options) {
      ttl.set(key, options?.expirationTtl);
    },
    async delete(key) {
      ttl.delete(key);
    },
    async list() {
      return { keys: [...ttl.keys()].map((name) => ({ name })), list_complete: true };
    },
  };
}

/** Answers LINE with 200 and everything else with `respond`, recording each request. */
function stubFetch(respond) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body };
    calls.push(call);
    return call.url.startsWith(env.LINE_API) ? json({}) : respond(call);
  };
  return calls;
}

/** Sends a signed webhook, answers outgoing requests with `respond`, and waits for the background work. */
async function deliver(events, respond, { secret = env.LINE_CHANNEL_SECRET, kv = fakeKv() } = {}) {
  const body = JSON.stringify({ destination: 'Ubot', events });
  const signature = createHmac('sha256', secret).update(body).digest('base64');
  const calls = stubFetch(respond);
  const pending = [];
  const res = await worker.fetch(
    new Request('https://bot.test/webhook', { method: 'POST', body, headers: { 'x-line-signature': signature } }),
    { ...env, SUBSCRIBERS: kv },
    { waitUntil: (promise) => pending.push(promise) },
  );
  await Promise.all(pending);
  const replies = calls.filter((c) => c.url.endsWith('/v2/bot/message/reply')).map((c) => JSON.parse(c.body));
  return { res, calls, replies, api: calls.filter((c) => c.url.startsWith(env.API_URL)) };
}

const assets = ({ url, method }) => {
  if (url.endsWith('/api/tokens/demo/officer') && method === 'POST') return json({ token: 'tok-1' });
  if (url.endsWith('/api/assets/AV-67-0037')) return json({ data: asset });
  if (url.endsWith('/api/loans/overdue')) return json({ data: [] });
  return json({ message: 'Not Found' }, 404);
};

test('a wrong signature is refused before anything runs', async () => {
  const { res, calls } = await deliver([textMessage('AV-67-0037')], assets, { secret: 'not-the-secret' });

  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('the console Verify button (no events) gets a 200', async () => {
  const { res, calls } = await deliver([], assets);

  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('a tag gets the typing dots, then the asset card on its own reply token', async () => {
  const { res, calls, replies, api } = await deliver([textMessage('av-67-0037')], assets);

  assert.equal(res.status, 200);
  assert.ok(calls[0].url.endsWith('/v2/bot/chat/loading/start'));
  assert.equal(JSON.parse(calls[0].body).chatId, 'U1');
  assert.equal(api[1].headers.Authorization, 'Bearer tok-1');
  assert.equal(replies[0].replyToken, 'reply-1');
  assert.equal(replies[0].messages[0].type, 'flex');
  assert.match(replies[0].messages[0].altText, /กล้องถ่ายภาพ Sony A7/);
});

test('the demo token is reused across messages and fetched again after the server reset it', async () => {
  let assetCalls = 0;
  const { api, replies } = await deliver([textMessage('AV-67-0037', 1), textMessage('AV-67-0037', 2)], (call) => {
    if (call.url.endsWith('/api/assets/AV-67-0037') && ++assetCalls === 2) return json({ message: 'Unauthenticated.' }, 401);
    return assets(call);
  });

  assert.equal(api.filter((c) => c.url.endsWith('/demo/officer')).length, 2);
  assert.deepEqual(replies.map((r) => r.messages[0].type), ['flex', 'flex']);
});

test('a sleeping server gets "ลองใหม่", which resends the same text', async () => {
  for (const respond of [
    () => new Response('<html>waking</html>', { status: 503 }),
    () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    },
  ]) {
    forgetToken();
    const { replies } = await deliver([textMessage('เกินกำหนด')], respond);

    assert.match(replies[0].messages[0].text, /เชื่อมต่อระบบทรัพย์สินไม่ได้/);
    assert.equal(replies[0].messages[0].quickReply.items[0].action.text, 'เกินกำหนด');
  }
});

test('an unknown tag says so, and the overdue word asks for the overdue list', async () => {
  const unknown = await deliver([textMessage('XX-99-9999')], assets);
  assert.match(unknown.replies[0].messages[0].text, /ไม่พบรหัส XX-99-9999/);

  const overdue = await deliver([textMessage('ของเกินกำหนด')], assets);
  assert.ok(overdue.api.some((c) => c.url.endsWith('/api/loans/overdue')));
  assert.equal(overdue.replies[0].messages[0].text, 'ตอนนี้ไม่มีของเกินกำหนดคืน');
});

test('adding the bot as a friend gets the help text without calling the asset system', async () => {
  const { replies, api } = await deliver([{ type: 'follow', replyToken: 'r', source: { type: 'user', userId: 'U1' } }], assets);

  assert.match(replies[0].messages[0].text, /บอทระบบทรัพย์สิน/);
  assert.equal(api.length, 0);
});

const THREE_DAYS = 3 * 24 * 60 * 60;
const asleep = () => new Response('<html>waking</html>', { status: 503 });

test('"รับแจ้งเตือน" signs the user up for 3 days, even while the asset system sleeps', async () => {
  const kv = fakeKv();
  const { replies, api } = await deliver([textMessage('รับแจ้งเตือน')], asleep, { kv });

  assert.equal(kv.ttl.get('U1'), THREE_DAYS);
  assert.equal(api.length, 0);
  assert.match(replies[0].messages[0].text, /ทุกเช้า 08:00/);
  assert.equal(replies[0].messages[0].quickReply.items[0].action.text, 'เลิกแจ้งเตือน');
});

test('with all 8 seats taken a newcomer is turned away, but a subscriber can still renew', async () => {
  const kv = fakeKv(['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8']);

  const newcomer = await deliver([textMessage('รับแจ้งเตือน', 1, 'U9')], assets, { kv });
  assert.equal(await kv.get('U9'), null);
  assert.equal(kv.ttl.size, 8);
  assert.match(newcomer.replies[0].messages[0].text, /เต็มแล้ว/);

  const renewal = await deliver([textMessage('รับแจ้งเตือน', 2, 'U1')], assets, { kv });
  assert.equal(kv.ttl.get('U1'), THREE_DAYS);
  assert.match(renewal.replies[0].messages[0].text, /ทุกเช้า 08:00/);
});

test('"เลิกแจ้งเตือน" removes the user and offers to sign up again', async () => {
  const kv = fakeKv(['U1', 'U2']);
  const { replies, api } = await deliver([textMessage('เลิกแจ้งเตือน')], asleep, { kv });

  assert.deepEqual([...kv.ttl.keys()], ['U2']);
  assert.equal(api.length, 0);
  assert.equal(replies[0].messages[0].quickReply.items[0].action.text, 'รับแจ้งเตือน');
});

test('blocking the bot ends the subscription, and nothing is sent back', async () => {
  const kv = fakeKv(['U1', 'U2']);
  const { calls } = await deliver([{ type: 'unfollow', source: { type: 'user', userId: 'U1' } }], assets, { kv });

  assert.deepEqual([...kv.ttl.keys()], ['U2']);
  assert.equal(calls.length, 0);
});
