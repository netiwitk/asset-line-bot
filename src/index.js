// LINE webhook for the asset system: answer at once, then reply to each event in the background.
// Every morning, push the overdue list to whoever asked for it.

import { NotFound, Unavailable, getAsset, getOverdue } from './api.js';
import { assetCard, help, intentOf, notFound, overdueAlert, overdueList, subscribed, subscriptionsFull, unavailable, unsubscribed } from './bot.js';
import { multicast, reply, showLoading, verifySignature } from './line.js';

/**
 * How long to wait for the asset system before saying it is waking up. It must leave room inside both
 * the reply token's life (about 25-30 s) and Cloudflare's 30 s limit on work after the response.
 */
const ANSWER_WITHIN_MS = 15_000;

/** Each subscriber costs one message of LINE's free 300 a month every morning; 8 × 30 days = 240 leaves room. */
const MAX_SUBSCRIBERS = 8;

/** A subscription ends by itself, so a visitor who tried the demo once stops using the quota. */
const SUBSCRIPTION_SECONDS = 3 * 24 * 60 * 60;

/** The free demo server took 45 s to wake once, and may answer 503 quickly meanwhile. Eight tries of up to 20 s, 20 s apart, keep asking for 2.5-5 minutes. */
const WAKE_ATTEMPTS = 8;
const WAKE_ATTEMPT_MS = 20_000;

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

  scheduled(controller, env, ctx) {
    ctx.waitUntil(notifyOverdue(env));
  },
};

/** One multicast with one message, so each subscriber costs one message of the monthly quota. */
export async function notifyOverdue(env, { retryDelayMs = 20_000 } = {}) {
  const { keys } = await env.SUBSCRIBERS.list();
  if (keys.length === 0) return;
  const loans = await overdueOnceAwake(env, retryDelayMs);
  if (loans?.length) await multicast(env, keys.map((key) => key.name), [overdueAlert(loans)]);
}

async function overdueOnceAwake(env, retryDelayMs) {
  for (let attempt = 1; attempt <= WAKE_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    try {
      return await getOverdue(env, AbortSignal.timeout(WAKE_ATTEMPT_MS));
    } catch (error) {
      if (!(error instanceof Unavailable)) throw error;
    }
  }
  console.error(`morning alert skipped: the asset system did not answer in ${WAKE_ATTEMPTS} tries`);
  return null;
}

async function handle(event, env) {
  try {
    if (event.type === 'unfollow') return await env.SUBSCRIBERS.delete(event.source.userId);
    if (!event.replyToken) return;
    if (event.type === 'follow') return await reply(env, event.replyToken, [help()]);
    if (event.type !== 'message') return;

    const text = event.message.type === 'text' ? event.message.text : '';
    if (event.source?.type === 'user') await showLoading(env, event.source.userId);
    await reply(env, event.replyToken, [await answer(text, event.source?.userId, env)]);
  } catch (error) {
    console.error('event failed', error);
  }
}

async function answer(text, userId, env) {
  const intent = intentOf(text);
  if (intent.kind === 'subscribe' && userId) return (await subscribe(env, userId)) ? subscribed() : subscriptionsFull();
  if (intent.kind === 'unsubscribe' && userId) {
    await env.SUBSCRIBERS.delete(userId);
    return unsubscribed();
  }
  // Help, or an alert command from a chat that names no user to alert.
  if (intent.kind !== 'overdue' && intent.kind !== 'asset') return help();

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

// ponytail: KV lists are eventually consistent (about a minute), so a burst of sign-ups can pass the cap by a few.
// Count seats in a Durable Object if that ever matters.
async function subscribe(env, userId) {
  const { keys } = await env.SUBSCRIBERS.list();
  if (keys.length >= MAX_SUBSCRIBERS && !keys.some((key) => key.name === userId)) return false;
  await env.SUBSCRIBERS.put(userId, '', { expirationTtl: SUBSCRIPTION_SECONDS });
  return true;
}
