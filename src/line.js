// The LINE platform: proving a webhook came from LINE, and talking back.

/**
 * LINE signs each webhook body with the channel secret (HMAC-SHA256, base64 in `x-line-signature`).
 * crypto.subtle.verify compares in constant time, so the check leaks nothing about the expected value.
 */
export async function verifySignature(secret, body, signature) {
  if (!secret || !signature) return false;
  let expected;
  try {
    expected = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, expected, new TextEncoder().encode(body));
}

/** Answers one event. A reply is free (it does not use the monthly message quota) but its token expires in seconds. */
export async function reply(env, replyToken, messages) {
  const res = await lineApi(env, '/v2/bot/message/reply', { replyToken, messages });
  if (!res.ok) console.error('LINE reply failed', res.status, await res.text());
}

/** Sends the same messages to up to 500 users. Each user counts against the monthly message quota. */
export async function multicast(env, to, messages) {
  const res = await lineApi(env, '/v2/bot/message/multicast', { to, messages });
  if (!res.ok) console.error('LINE multicast failed', res.status, await res.text());
}

/** The "typing" dots while the answer is fetched. One-to-one chats only; it disappears when the reply arrives. */
export async function showLoading(env, userId) {
  const res = await lineApi(env, '/v2/bot/chat/loading/start', { chatId: userId, loadingSeconds: 20 });
  if (!res.ok) console.error('LINE loading animation failed', res.status);
}

function lineApi(env, path, body) {
  return fetch(env.LINE_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
}
