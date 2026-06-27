import crypto from 'node:crypto';

export const SESSION_COOKIE = 'artsoul_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ENV_ERROR_CODES = {
  SESSION_SECRET: 'MISSING_SESSION_SECRET',
  SUPABASE_URL: 'MISSING_SUPABASE_URL',
  SUPABASE_SERVICE_ROLE_KEY: 'MISSING_SERVICE_ROLE_KEY'
};

export function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || '');
}

export function normalizeWallet(value) {
  return isAddress(value) ? value.toLowerCase() : '';
}

function readEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function requireEnv(names, label) {
  const value = readEnv(names);
  if (!value) {
    const err = new Error(`${label} is required`);
    err.statusCode = 500;
    err.code = ENV_ERROR_CODES[label] || 'MISSING_REQUIRED_ENV';
    throw err;
  }
  return value;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function getSupabaseServiceKeyInfo() {
  const key = requireEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'], 'SUPABASE_SERVICE_ROLE_KEY');
  const payload = decodeJwtPayload(key);
  const role = typeof payload?.role === 'string' ? payload.role : '';

  return {
    role,
    isServiceRole: role === 'service_role'
  };
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payload) {
  const secret = requireEnv(['SESSION_SECRET'], 'SESSION_SECRET');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

export function setWalletSession(res, wallet) {
  const payload = base64url(JSON.stringify({
    wallet,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  }));
  const signature = signPayload(payload);
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, `${payload}.${signature}`, {
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'
  }));
}

export function clearWalletSession(res) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'
  }));
}

export function readWalletSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = signPayload(payload);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.wallet || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return normalizeWallet(data.wallet);
  } catch {
    return null;
  }
}

export function requireWallet(req) {
  const wallet = readWalletSession(req);
  if (!wallet) {
    const err = new Error('Please sign in with Ethereum');
    err.statusCode = 401;
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  return wallet;
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export async function supabaseRest(path, options = {}) {
  const supabaseUrl = requireEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'], 'SUPABASE_URL');
  const serviceKey = requireEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'], 'SUPABASE_SERVICE_ROLE_KEY');
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`;
  const method = options.method || 'GET';
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    error.statusCode = 500;
    error.code = 'SUPABASE_REQUEST_FAILED';
    throw error;
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: 'Non-JSON Supabase response' };
  }

  if (!response.ok) {
    const err = new Error(data?.message || data?.hint || `Supabase REST ${response.status}`);
    err.statusCode = 500;
    err.code = classifySupabaseError(path, method, response.status, data);
    err.details = data;
    throw err;
  }

  return data;
}

function encodeStoragePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

export function getPublicStorageUrl(bucket, path) {
  const supabaseUrl = requireEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'], 'SUPABASE_URL');
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = encodeStoragePath(path);
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
}

export function getSupabaseStorageBaseUrl() {
  const supabaseUrl = requireEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'], 'SUPABASE_URL');
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1`;
}

export async function supabaseStorageRest(path, options = {}) {
  const supabaseUrl = requireEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'], 'SUPABASE_URL');
  const serviceKey = requireEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'], 'SUPABASE_SERVICE_ROLE_KEY');
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/${path}`;
  const method = options.method || 'GET';
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    error.statusCode = 500;
    error.code = 'SUPABASE_STORAGE_REQUEST_FAILED';
    throw error;
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: 'Non-JSON Supabase Storage response' };
  }

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Supabase Storage ${response.status}`);
    err.code = classifyStorageError(path, response.status, data);
    err.statusCode = err.code === 'STORAGE_SIGNED_UPLOAD_FAILED'
      ? response.status
      : 500;
    if (err.statusCode < 400 || err.statusCode >= 500) {
      err.statusCode = 500;
    }
    err.supabaseStatus = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

function classifyStorageError(path, status, data) {
  const route = String(path || '').toLowerCase();
  const serialized = JSON.stringify(data || {}).toLowerCase();
  const isSignedUpload = route.includes('object/upload/sign/');

  if (status === 401 || status === 403) {
    return 'SUPABASE_SERVICE_ROLE_AUTH_FAILED';
  }

  if (isSignedUpload && status === 404 && serialized.includes('bucket')) {
    return 'STORAGE_BUCKET_NOT_FOUND';
  }

  if (isSignedUpload && (
    serialized.includes('row-level security') ||
    serialized.includes('rls') ||
    serialized.includes('violates row-level security policy')
  )) {
    return 'STORAGE_SIGNED_UPLOAD_RLS_DENIED';
  }

  if (isSignedUpload) {
    return 'STORAGE_SIGNED_UPLOAD_FAILED';
  }

  return 'SUPABASE_STORAGE_REQUEST_FAILED';
}

function classifySupabaseError(path, method, status, data) {
  const table = String(path || '').split('?')[0];
  const serialized = JSON.stringify(data || {}).toLowerCase();

  if (table === 'siwe_nonces' && (
    serialized.includes('siwe_nonces') &&
    (serialized.includes('does not exist') ||
      serialized.includes('not found') ||
      serialized.includes('42p01') ||
      serialized.includes('pgrst205'))
  )) {
    return 'SIWE_NONCES_TABLE_MISSING';
  }

  if (status === 401 || status === 403) {
    return 'SUPABASE_SERVICE_ROLE_AUTH_FAILED';
  }

  if (method === 'POST') return 'SUPABASE_INSERT_FAILED';
  if (method === 'PATCH' || method === 'PUT') return 'SUPABASE_UPDATE_FAILED';
  return 'SUPABASE_QUERY_FAILED';
}

export function sendError(res, error) {
  const status = error.statusCode || 500;
  res.status(status).json({
    error: error.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
    message: status === 500 ? 'Internal server error' : error.message
  });
}

export function allowMethods(req, res, methods) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', methods.join(', '));
    res.status(204).end();
    return false;
  }
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return false;
  }
  return true;
}

export function validateArtworkId(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z0-9:_-]{1,128}$/.test(text) ? text : '';
}

export function normalizeChainId(value) {
  const parsed = Number(value || 84532);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 84532;
}
