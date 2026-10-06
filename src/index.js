// LINE webhook for the asset system: answer at once, then reply to each event in the background.

import { NotFound, Unavailable, getAsset, getOverdue } from './api.js';
import { assetCard, help, intentOf, notFound, overdueList, unavailable } from './bot.js';
import { reply, showLoading, verifySignature } from './line.js';

/**
 * How long to wait for the asset system before saying it is waking up. It must leave room inside both
 * the reply token's life (about 25-30 s) and Cloudflare's 30 s limit on work after the response.
 */
const ANSWER_WITHIN_MS = 15_000;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/webhook') {
      return new Response('Not found', { status: 404 });
    }
    // The signature covers the raw bytes, so check it before parsing anything.
    const body = await request.text();
    if (!(await verifySignature(env.LINE_CHANNEL_SECRET, body, request.headers.get('x-line-signature')))) {
      return new Response('Bad signature', { status: 401 });
    }
    // The console's "Verify" button sends no events; it only needs the 200.
    const { events = [] } = JSON.parse(body);
    ctx.waitUntil(Promise.all(events.map((event) => handle(event, env))));
    return new Response('OK');
  },
};

async function handle(event, env) {
  try {
    if (!event.replyToken) return;
    if (event.type === 'follow') return await reply(env, event.replyToken, [help()]);
    if (event.type !== 'message') return;

    const text = event.message.type === 'text' ? event.message.text : '';
    if (event.source?.type === 'user') await showLoading(env, event.source.userId);
    await reply(env, event.replyToken, [await answer(text, env)]);
  } catch (error) {
    console.error('event failed', error);
  }
}

async function answer(text, env) {
  const intent = intentOf(text);
  if (intent.kind === 'help') return help();

  const signal = AbortSignal.timeout(ANSWER_WITHIN_MS);
  try {
    if (intent.kind === 'overdue') return overdueList(await getOverdue(env, signal));
    return assetCard(await getAsset(env, intent.tag, signal), env.APP_URL);
  } catch (error) {
    if (error instanceof NotFound) return notFound(intent.tag);
    if (error instanceof Unavailable) return unavailable(text);
    throw error;
  }
}
