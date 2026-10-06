// The asset system's API (asset-laravel), read as the demo officer, who may see every department.

export class NotFound extends Error {}

/** No usable answer in time: the free demo server is asleep or waking, or it refused for another reason. */
export class Unavailable extends Error {}

// One per isolate: the demo token route is throttled, and every new token is a row in the database.
// It holds the request, not the token, so events that arrive together share one request.
let token = null;

export async function getAsset(env, tag, signal) {
  return (await call(env, `/api/assets/${encodeURIComponent(tag)}`, signal)).data;
}

export async function getOverdue(env, signal) {
  return (await call(env, '/api/loans/overdue', signal)).data;
}

async function call(env, path, signal, isRetry = false) {
  const used = (token ??= demoToken(env, signal));
  let bearer;
  try {
    bearer = await used;
  } catch (error) {
    if (token === used) token = null;
    throw error;
  }
  const res = await send(env.API_URL + path, { headers: { Authorization: `Bearer ${bearer}` }, signal });
  // The demo server reseeds when it boots, which wipes every token. Only the first caller to notice replaces it.
  if (res.status === 401 && !isRetry) {
    if (token === used) token = null;
    return call(env, path, signal, true);
  }
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Unavailable(`HTTP ${res.status}`);
  return readJson(res);
}

async function demoToken(env, signal) {
  const res = await send(env.API_URL + '/api/tokens/demo/officer', { method: 'POST', signal });
  if (!res.ok) throw new Unavailable(`token HTTP ${res.status}`);
  return (await readJson(res)).token;
}

async function send(url, init) {
  try {
    return await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  } catch (error) {
    throw new Unavailable(error.message);
  }
}

/** The body can still time out, or be a host's HTML page instead of JSON. */
async function readJson(res) {
  try {
    return await res.json();
  } catch (error) {
    throw new Unavailable(error.message);
  }
}

/** For tests: start each one without a cached token. */
export function forgetToken() {
  token = null;
}
