import crypto from 'node:crypto';
import { supabaseRest } from './backend.js';

export function serviceError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), {code, statusCode});
}

export function requireService(name) {
  if (process.env[name] !== 'true') throw serviceError('SERVICE_UNAVAILABLE', 'This service has not been activated.', 503);
}

export async function readBoundedJson(req, maxBytes = 250000) {
  if (Number(req.headers?.['content-length']) > maxBytes) throw serviceError('BODY_TOO_LARGE', 'Request is too large.', 413);
  let value = req.body;
  if (value === undefined) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk); size += buffer.length;
      if (size > maxBytes) throw serviceError('BODY_TOO_LARGE', 'Request is too large.', 413);
      chunks.push(buffer);
    }
    value = Buffer.concat(chunks).toString('utf8');
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > maxBytes) throw serviceError('BODY_TOO_LARGE', 'Request is too large.', 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw serviceError('INVALID_JSON', 'A JSON object is required.'); }
}

export function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
export function privateDigest(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw serviceError('SERVICE_UNAVAILABLE', 'Service configuration is incomplete.', 503);
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

// Atomic database quota; no cross-instance or restart bypass for these services.
export async function consumeServiceQuota(scope, subject, max = 4, seconds = 3600) {
  const result = await supabaseRest('rpc/consume_launch_service_quota', {
    method: 'POST', body: {p_key: digest(`${scope}:${subject}`), p_max: max, p_seconds: seconds}
  });
  if (result !== true) throw serviceError('RATE_LIMITED', 'Please wait before trying again.', 429);
}

export function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw serviceError('INVALID_EMAIL', 'Enter a valid email address.');
  return email;
}

export async function sendProductEmail({to, subject, text, idempotencyKey}) {
  const key = process.env.ARTSOUL_EMAIL_API_KEY;
  const from = process.env.ARTSOUL_EMAIL_FROM;
  if (!key || !from || /[\r\n]/.test(from)) throw serviceError('EMAIL_UNAVAILABLE', 'Email delivery is not configured.', 503);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey},
    body: JSON.stringify({from, to: [to], subject, text})
  });
  if (!response.ok) throw serviceError('EMAIL_UNAVAILABLE', 'Email delivery is temporarily unavailable.', 503);
  return true;
}

export function publicOrigin() {
  const url = new URL(process.env.ARTSOUL_PUBLIC_ORIGIN || 'https://artsoulprotocol.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw serviceError('SERVICE_UNAVAILABLE', 'Public origin configuration is invalid.', 503);
  }
  return url.origin;
}

export function sendServiceError(res, error) {
  const status = [400, 401, 404, 409, 413, 429, 503].includes(error?.statusCode) ? error.statusCode : 503;
  return res.status(status).json({success: false, error: status === 503 ? 'SERVICE_UNAVAILABLE' : error.code,
    message: status === 503 ? 'This service is unavailable. Please try again later.' : error.message});
}
