import type { Env } from './types';

const COOKIE_NAME = 'skin_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

/**
 * Interim auth: a single shared password, per Q2. Cloudflare Access replaces
 * this later. Until then it is still built to not be the weak link — the
 * password never leaves a Wrangler secret, comparison is constant-time, the
 * cookie is an HMAC-signed expiry rather than the password itself, and repeated
 * failures lock the admin surface out via the Durable Object.
 */

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64url(new Uint8Array(sig));
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed first so the comparison length never depends on the
 * secret, which keeps this safe even when the two inputs differ in length.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function checkPassword(supplied: string, env: Env): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  return timingSafeEqual(supplied, env.ADMIN_PASSWORD);
}

export async function issueSession(env: Env, now: number): Promise<string> {
  const exp = String(now + SESSION_TTL_MS);
  const sig = await hmac(env.SESSION_SECRET, exp);
  return `${exp}.${sig}`;
}

export async function verifySession(token: string, env: Env, now: number): Promise<boolean> {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(env.SESSION_SECRET, exp);
  if (!(await timingSafeEqual(sig, expected))) return false;
  const expiry = Number(exp);
  return Number.isFinite(expiry) && expiry > now;
}

export function readCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/_',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export const clearedCookie = sessionCookie('', 0);

export async function isAuthed(request: Request, env: Env, now: number): Promise<boolean> {
  const token = readCookie(request);
  return token ? verifySession(token, env, now) : false;
}

/**
 * Token auth for scripts and Shortcuts, from `Authorization: Bearer <token>`.
 *
 * A dedicated token rather than the password, so the thing pasted into a
 * Shortcut can be rotated without changing what you type. Returns null when no
 * bearer was offered, so the caller can fall through to the session cookie.
 */
export async function checkBearer(request: Request, env: Env): Promise<boolean | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!/^bearer /i.test(header)) return null;
  if (!env.API_TOKEN) return false;
  return timingSafeEqual(header.slice(7).trim(), env.API_TOKEN);
}

/**
 * CSRF guard. The session cookie is SameSite=Strict, but a custom header that
 * a cross-origin form post cannot set is the belt to that suspenders — the
 * failure mode here is someone silently repointing the QR code. An
 * Authorization header is such a header too, which is what lets a script skip
 * the panel's own.
 */
export function hasCsrfHeader(request: Request): boolean {
  return request.headers.get('x-skin-request') === '1' || request.headers.has('authorization');
}
