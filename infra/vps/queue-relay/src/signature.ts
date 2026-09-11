import { createHash, createHmac } from 'node:crypto';

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

export function signCallback(body: string, destination: string, signingKey: string, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: 'Upstash',
    sub: destination,
    iat: now,
    nbf: now - 5,
    exp: now + 300,
    body: createHash('sha256').update(body).digest('base64url'),
  }));
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', signingKey).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}
