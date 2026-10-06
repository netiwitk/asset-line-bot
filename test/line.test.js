import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifySignature } from '../src/line.js';

const sign = (secret, body) => createHmac('sha256', secret).update(body).digest('base64');

test('accepts only a body signed with the channel secret', async () => {
  const body = '{"events":[{"type":"message"}]}';

  assert.equal(await verifySignature('s3cret', body, sign('s3cret', body)), true);
  assert.equal(await verifySignature('s3cret', body.replace('message', 'follow'), sign('s3cret', body)), false);
  assert.equal(await verifySignature('s3cret', body, sign('other', body)), false);
  assert.equal(await verifySignature('s3cret', body, null), false);
  assert.equal(await verifySignature('s3cret', body, 'not base64 !!'), false);
  assert.equal(await verifySignature(undefined, body, sign('s3cret', body)), false);
});
