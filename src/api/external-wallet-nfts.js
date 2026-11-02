import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeWallet } from './backend.js';
import { collectionAssetKey } from '../config/collection-networks.js';

const PAGE_SIZE = 12;
const CACHE_MS = 5 * 60_000;
const CURSOR_MS = 30 * 60_000;
const MAX_BYTES = 512 * 1024;
const MAX_CACHE = 128;
const MAX_WALLETS = 256;
const cache = new Map();
const pending = new Map();
const wallets = new Map();
const budget = { minute: null, day: null };

function fail(code, message, statusCode = 503, retryAfter) {
  return Object.assign(new Error(message), { code, statusCode, retryAfter });
}
const unavailable = () => fail('WALLET_NFTS_UNAVAILABLE', 'Wallet NFTs are temporarily unavailable. Please try again.');
function limited(seconds = 60) {
  return fail('WALLET_NFTS_RATE_LIMITED', 'Please wait before loading more wallet NFTs.', 429, seconds);
}
function config() {
  if (process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED !== 'true') {
    throw fail('WALLET_NFTS_DISABLED', 'External Base NFTs have not been activated.');
  }
  try {
    const key = process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY;
    const secret = process.env.SESSION_SECRET;
    // Inventory has its own credential; it must never inherit an indexer/network RPC key.
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key) || !secret?.trim()) throw new Error();
    return { key, secret, fingerprint: createHash('sha256').update(`${key}\n${secret}`).digest('hex') };
  } catch {
    throw fail('WALLET_NFTS_CONFIG_UNAVAILABLE', 'External Base NFTs are not configured.');
  }
}
function unchanged(expected) {
  if (config().fingerprint !== expected.fingerprint) throw unavailable();
}
function pageKey(value) {
  return typeof value === 'string' && /^[\x21-\x7e]{1,1024}$/.test(value);
}
function sign(payload, settings) {
  return createHmac('sha256', settings.secret).update(`external-base-nfts:${payload}`).digest('base64url');
}
function encodeCursor(page, wallet, settings, now) {
  if (!page) return null;
  const payload = Buffer.from(JSON.stringify({ w: wallet, p: page, e: now + CURSOR_MS, c: settings.fingerprint })).toString('base64url');
  return `${payload}.${sign(payload, settings)}`;
}
function decodeCursor(value, wallet, settings, now) {
  if (value === undefined) return '';
  try {
    if (typeof value !== 'string' || value.length > 3200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw new Error();
    const [payload, signature] = value.split('.');
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload, settings)))) throw new Error();
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || Object.keys(data).sort().join(',') !== 'c,e,p,w' || data.w !== wallet || data.c !== settings.fingerprint ||
        !pageKey(data.p) || !Number.isSafeInteger(data.e) || data.e <= now || data.e > now + CURSOR_MS) throw new Error();
    return data.p;
  } catch {
    throw fail('INVALID_WALLET_NFT_CURSOR', 'Choose a valid wallet NFT page.', 400);
  }
}
function windowCounter(value, now, duration) {
  return value && value.until > now ? value : { count: 0, until: now + duration };
}
function walletBudget(wallet, now) {
  for (const [key, value] of wallets) if (value.upstream.until <= now && value.requests.until <= now) wallets.delete(key);
  let value = wallets.get(wallet);
  if (!value) {
    if (wallets.size >= MAX_WALLETS) throw limited();
    value = { requests: null, upstream: null };
    wallets.set(wallet, value);
  }
  value.requests = windowCounter(value.requests, now, 60_000);
  value.upstream = windowCounter(value.upstream, now, 10 * 60_000);
  if (value.requests.count >= 60) throw limited(Math.ceil((value.requests.until - now) / 1000));
  value.requests.count++;
  return value;
}
function reserveRequest(walletState, now) {
  budget.minute = windowCounter(budget.minute, now, 60_000);
  budget.day = windowCounter(budget.day, now, 24 * 60 * 60_000);
  for (const [counter, limit] of [[walletState.upstream, 6], [budget.minute, 10], [budget.day, 100]]) {
    if (counter.count >= limit) throw limited(Math.ceil((counter.until - now) / 1000));
  }
  if (pending.size >= 4) throw limited(5);
  walletState.upstream.count++;
  budget.minute.count++;
  budget.day.count++;
}
function text(value, max) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) || null;
}
function uint(value) {
  if (typeof value !== 'string' || !/^(?:[0-9]{1,78}|0x[0-9a-fA-F]{1,64})$/.test(value)) return null;
  const number = BigInt(value);
  return number < 2n ** 256n ? number.toString() : null;
}
function imageUrl(image) {
  // Only provider-cached Base images. Never forward metadata URLs or remote-fetch transformations.
  const value = image?.cachedUrl;
  if (typeof value !== 'string' || value.length > 512 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(image.contentType)) return null;
  return /^https:\/\/nft-cdn\.alchemy\.com\/base-mainnet\/[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
}
function normalizeItem(value) {
  const contractAddress = typeof value?.contract?.address === 'string' ? normalizeWallet(value.contract.address) : '';
  const tokenId = uint(value?.tokenId);
  const tokenType = value?.tokenType;
  const quantity = uint(value?.balance);
  if (!contractAddress || /^0x0{40}$/.test(contractAddress) || tokenId === null || !['ERC721', 'ERC1155'].includes(tokenType) ||
      quantity === null || quantity === '0' || (tokenType === 'ERC721' && quantity !== '1')) return null;
  const traits = [];
  const attributes = value.raw?.metadata?.attributes;
  if (Array.isArray(attributes)) {
    for (const attribute of attributes.slice(0, 32)) {
      const name = text(attribute?.trait_type, 80);
      const raw = attribute?.value;
      const val = text(typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw, 160);
      if (name && val) traits.push({ name, value: val });
      if (traits.length === 8) break;
    }
  }
  return { id: collectionAssetKey(8453, contractAddress, tokenId), contractAddress, tokenId, tokenType, quantity,
    name: text(value.name, 160), collection: text(value.contract?.name, 160), imageUrl: imageUrl(value.image), traits };
}
function normalizePage(data, now) {
  if (!data || !Array.isArray(data.ownedNfts) || data.ownedNfts.length > PAGE_SIZE ||
      (data.pageKey != null && !pageKey(data.pageKey)) || !Number.isSafeInteger(data.totalCount) || data.totalCount < data.ownedNfts.length) throw unavailable();
  const items = [], ids = new Set();
  for (const row of data.ownedNfts) {
    const item = normalizeItem(row);
    if (item && !ids.has(item.id)) { ids.add(item.id); items.push(item); }
  }
  const block = data.validAt;
  const validAt = Number.isSafeInteger(block?.blockNumber) && block.blockNumber >= 0 && /^0x[0-9a-fA-F]{64}$/.test(block?.blockHash || '')
    ? { blockNumber: block.blockNumber, blockHash: block.blockHash.toLowerCase() } : null;
  return { items, pageKey: data.pageKey || null, totalCount: data.totalCount, omittedCount: data.ownedNfts.length - items.length,
    fetchedAt: new Date(now).toISOString(), validAt };
}
async function fetchPage(wallet, page, settings) {
  const url = new URL(`https://base-mainnet.g.alchemy.com/nft/v3/${settings.key}/getNFTsForOwner`);
  url.search = new URLSearchParams({ owner: wallet, pageSize: String(PAGE_SIZE), withMetadata: 'true', tokenUriTimeoutInMs: '0', ...(page ? { pageKey: page } : {}) });
  const controller = new AbortController();
  let reader, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, 5000);
  });
  const request = (async () => {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
    controller.signal.throwIfAborted();
    if (response.body) reader = response.body.getReader();
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
        Number(response.headers.get('content-length')) > MAX_BYTES || !reader) throw unavailable();
    const buffer = Buffer.alloc(MAX_BYTES);
    let size = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_BYTES - size) throw unavailable();
      buffer.set(value, size);
      size += value.byteLength;
    }
    return normalizePage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))), Date.now());
  })();
  try {
    return await Promise.race([request, timeout]);
  } catch {
    // Provider responses and fetch errors may contain credentials or hostile metadata.
    throw unavailable();
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

// Process-local safeguards are not an account-wide billing cap. Activation requires
// independent verification of existing provider spending controls; no retries or polling.
export async function readExternalWalletNfts(wallet, cursor) {
  if (!normalizeWallet(wallet) || normalizeWallet(wallet) !== wallet || /^0x0{40}$/.test(wallet)) throw unavailable();
  const settings = config(), now = Date.now();
  const page = decodeCursor(cursor, wallet, settings, now);
  const state = walletBudget(wallet, now);
  const key = createHash('sha256').update(`${settings.fingerprint}:${wallet}:${page}`).digest('hex');
  for (const [id, entry] of cache) if (entry.until <= now) cache.delete(id);
  let entry = cache.get(key);
  if (!entry) {
    let request = pending.get(key);
    if (!request) {
      reserveRequest(state, now);
      request = fetchPage(wallet, page, settings).then(data => ({ data, until: Date.now() + CACHE_MS }), () => ({ error: true, until: Date.now() + 30_000 }))
        .then(result => {
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
          cache.set(key, result);
          return result;
        }).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    entry = await request;
  }
  unchanged(settings);
  if (entry.error) throw unavailable();
  const { pageKey: next, ...data } = entry.data;
  return { wallet, chainId: 8453, network: 'Base', source: 'alchemy', ...data,
    nextCursor: encodeCursor(next, wallet, settings, Date.now()) };
}
