// B36: gated, explicit, read-only multichain wallet assets. NEVER use for
// ArtSoul provenance, sales, balances owed, chain writes, or contract authority.
// Alchemy Portfolio API is a display source, not a proof of current ownership.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeWallet } from './backend.js';
import { collectionAssetKey } from '../config/collection-networks.js';

export const WALLET_ASSET_NETWORKS = Object.freeze({
  'base-mainnet': { chainId: 8453, name: 'Base', short: 'BASE', explorer: 'https://basescan.org', market: 'base' },
  'eth-mainnet': { chainId: 1, name: 'Ethereum', short: 'ETH', explorer: 'https://etherscan.io', market: 'ethereum' },
  'arb-mainnet': { chainId: 42161, name: 'Arbitrum', short: 'ARB', explorer: 'https://arbiscan.io', market: 'arbitrum' },
  'opt-mainnet': { chainId: 10, name: 'Optimism', short: 'OP', explorer: 'https://optimistic.etherscan.io', market: 'optimism' },
  'matic-mainnet': { chainId: 137, name: 'Polygon', short: 'POL', explorer: 'https://polygonscan.com', market: 'matic' },
  'linea-mainnet': { chainId: 59144, name: 'Linea', short: 'LINEA', explorer: 'https://lineascan.build', market: 'linea' },
  'bnb-mainnet': { chainId: 56, name: 'BNB Chain', short: 'BNB', explorer: 'https://bscscan.com', market: 'bsc' },
  'avax-mainnet': { chainId: 43114, name: 'Avalanche', short: 'AVAX', explorer: 'https://snowtrace.io', market: 'avalanche' }
});
// The "All" preset is limited to five documented Portfolio networks, not every
// chain in the dashboard. Optional networks remain single-network selections.
const MAIN_NETWORKS = ['base-mainnet', 'eth-mainnet', 'arb-mainnet', 'opt-mainnet', 'matic-mainnet'];
const PAGE_SIZE = 12, CACHE_MS = 5 * 60_000, CURSOR_MS = 20 * 60_000;
const MAX_BYTES = 768 * 1024, MAX_CACHE = 96, MAX_USERS = 128;
const cached = new Map(), inflight = new Map(), perWallet = new Map();
const globalBudget = { minute: null, day: null };
function problem(code, message, statusCode = 503, retryAfter) {
  return Object.assign(new Error(message), { code, statusCode, retryAfter });
}
const unavailable = () => problem('WALLET_ASSETS_UNAVAILABLE', 'Wallet assets are temporarily unavailable.');
const limited = (seconds = 60) => problem('WALLET_ASSETS_RATE_LIMITED', 'Wallet asset reads are rate limited.', 429, seconds);

function settings() {
  if (process.env.ARTSOUL_MULTICHAIN_ASSETS_ENABLED !== 'true' ||
      process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED !== 'true')
    throw problem('WALLET_ASSETS_DISABLED', 'Multichain wallet viewing is disabled.');
  const key = process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY;
  const secret = process.env.SESSION_SECRET;
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      typeof secret !== 'string' || !secret.trim())
    throw problem('WALLET_ASSETS_CONFIG_UNAVAILABLE', 'Wallet asset provider is not configured.');
  return { key, secret, fingerprint: createHash('sha256').update(key + '\n' + secret).digest('hex') };
}
function selection(value) {
  if (value === 'all') return MAIN_NETWORKS;
  if (typeof value === 'string' && Object.hasOwn(WALLET_ASSET_NETWORKS, value)) return [value];
  throw problem('INVALID_WALLET_ASSET_QUERY', 'Choose a supported network.', 400);
}
function kindOf(value) {
  if (value === 'multichain-nfts') return 'nfts';
  if (value === 'multichain-tokens') return 'tokens';
  throw problem('INVALID_WALLET_ASSET_QUERY', 'Choose a supported asset type.', 400);
}
function nowWindow(previous, now, duration) {
  return previous && previous.until > now ? previous : { count: 0, until: now + duration };
}
function charge(wallet, now) {
  for (const [id, record] of perWallet) if (record.until <= now) perWallet.delete(id);
  let user = perWallet.get(wallet);
  if (!user) {
    if (perWallet.size >= MAX_USERS) throw limited();
    user = { count: 0, until: now + 10 * 60_000 };
    perWallet.set(wallet, user);
  }
  globalBudget.minute = nowWindow(globalBudget.minute, now, 60_000);
  globalBudget.day = nowWindow(globalBudget.day, now, 24 * 60 * 60_000);
  for (const [state, cap] of [[user, 6], [globalBudget.minute, 3], [globalBudget.day, 60]]) {
    if (state.count >= cap) throw limited(Math.max(1, Math.ceil((state.until - now) / 1000)));
  }
  if (inflight.size >= 2) throw limited(5);
  user.count++; globalBudget.minute.count++; globalBudget.day.count++;
}
function signature(payload, s) {
  return createHmac('sha256', s.secret).update('multichain-wallet-assets:v1:' + payload).digest('base64url');
}
function signCursor(next, wallet, kind, network, s, now) {
  if (!next) return null;
  const payload = Buffer.from(JSON.stringify({ w: wallet, k: kind, n: network, p: next,
    e: now + CURSOR_MS, f: s.fingerprint })).toString('base64url');
  return payload + '.' + signature(payload, s);
}
function cursorOf(value, wallet, kind, network, s, now) {
  if (value === undefined) return '';
  try {
    if (typeof value !== 'string' || value.length > 3500 || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]{43}$/.test(value)) throw Error();
    const [payload, sig] = value.split('.');
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(signature(payload, s)))) throw Error();
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!d || Object.keys(d).sort().join(',') !== 'e,f,k,n,p,w' ||
        d.w !== wallet || d.k !== kind || d.n !== network || d.f !== s.fingerprint ||
        typeof d.p !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(d.p) ||
        !Number.isSafeInteger(d.e) || d.e <= now || d.e > now + CURSOR_MS) throw Error();
    return d.p;
  } catch {
    throw problem('INVALID_WALLET_ASSET_CURSOR', 'Choose a valid asset page.', 400);
  }
}
function safeText(x, max = 160) {
  return typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : '';
}
function uint(x) {
  if (typeof x !== 'string' || !/^(?:[0-9]{1,78}|0x[0-9a-fA-F]{1,64})$/.test(x)) return null;
  const n = BigInt(x);
  return n < 2n ** 256n ? n.toString() : null;
}
const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
function cachedImage(image) {
  const url = image?.cachedUrl;
  if (typeof url !== 'string' || url.length > 512 || !RASTER.has(image.contentType)) return null;
  if (/^https:\/\/nft2-cdn\.alchemy\.com\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/.test(url)) return url;
  if (/^https:\/\/nft-cdn\.alchemy\.com\/[a-z0-9-]{1,50}\/[A-Za-z0-9_-]{1,256}$/.test(url)) return url;
  return null;
}
function nftItem(item, wallet) {
  const chain = WALLET_ASSET_NETWORKS[item?.network];
  const contract = normalizeWallet(item?.contract?.address);
  const tokenId = uint(item?.tokenId);
  const type = item?.tokenType || item?.contract?.tokenType;
  if (!chain || !contract || /^0x0{40}$/.test(contract) || tokenId === null ||
      !['ERC721', 'ERC1155'].includes(type) || item?.contract?.isSpam === true ||
      (typeof item.address === 'string' && item.address.toLowerCase() !== wallet)) return null;
  const quantity = uint(item?.balance ?? (type === 'ERC721' ? '1' : ''));
  if (!quantity || quantity === '0' || (type === 'ERC721' && quantity !== '1')) return null;
  const traits = [];
  const attributes = item?.raw?.metadata?.attributes;
  if (Array.isArray(attributes)) for (const attribute of attributes.slice(0, 24)) {
    const name = safeText(attribute?.trait_type, 60);
    const raw = attribute?.value;
    const value = safeText(typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw, 120);
    if (name && value) traits.push({ name, value });
    if (traits.length >= 8) break;
  }
  return { id: collectionAssetKey(chain.chainId, contract, tokenId), network: item.network, chainId: chain.chainId,
    networkName: chain.name, networkShort: chain.short, contractAddress: contract, tokenId, tokenType: type, quantity,
    name: safeText(item.name), collection: safeText(item.collection?.name || item.contract?.name),
    description: safeText(item.description, 600), imageUrl: cachedImage(item.image), traits,
    // External links open exact NFT pages for inspection only: not listings or sale confirmations.
    explorerUrl: chain.explorer + '/token/' + contract + '?a=' + tokenId,
    openseaUrl: 'https://opensea.io/assets/' + chain.market + '/' + contract + '/' + tokenId };
}
function tokenItem(item, wallet) {
  const chain = WALLET_ASSET_NETWORKS[item?.network];
  const contract = item?.tokenAddress === null ? null : normalizeWallet(item?.tokenAddress);
  const balance = uint(item?.tokenBalance);
  const meta = item?.tokenMetadata || {};
  const decimals = meta.decimals ?? (contract === null ? 18 : null);
  if (!chain || (item?.tokenAddress !== null && !contract) || balance === null ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 36 ||
      (typeof item.address === 'string' && item.address.toLowerCase() !== wallet)) return null;
  const value = BigInt(balance), divisor = 10n ** BigInt(decimals);
  const major = (value / divisor).toString();
  const minor = decimals ? (value % divisor).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '') : '';
  const displayBalance = major + (minor ? '.' + minor : '');
  const nativeSymbol = { 137: 'POL', 56: 'BNB', 43114: 'AVAX' }[chain.chainId] || 'ETH';
  const symbol = safeText(meta.symbol, 24) || (contract === null ? nativeSymbol : 'Token');
  const name = safeText(meta.name) || symbol;
  const prices = Array.isArray(item.tokenPrices) ? item.tokenPrices : [];
  const usd = prices.find(p => p?.currency?.toLowerCase() === 'usd' && typeof p.value === 'string' && /^(?:0|[1-9]\d{0,12})(?:\.\d{1,12})?$/.test(p.value));
  return { id: chain.chainId + ':' + (contract || 'native'), network: item.network, chainId: chain.chainId,
    networkName: chain.name, networkShort: chain.short, contractAddress: contract, symbol, name, balance: displayBalance,
    priceUsd: usd ? usd.value : null,
    explorerUrl: contract ? chain.explorer + '/token/' + contract : chain.explorer };
}
function normalized(raw, wallet, kind, nets, now) {
  const data = raw?.data;
  const list = data?.[kind === 'nfts' ? 'ownedNfts' : 'tokens'];
  if (!Array.isArray(list) || list.length > (kind === 'nfts' ? PAGE_SIZE : 100) || !Number.isSafeInteger(data?.totalCount ?? list.length) ||
      (data.pageKey != null && (typeof data.pageKey !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(data.pageKey)))) throw unavailable();
  const partial = raw?.error?.partialErrors;
  if (partial !== undefined && (!Array.isArray(partial) || partial.length > 16)) throw unavailable();
  const failures = [...new Set((partial || []).map(p => p?.network).filter(n => nets.includes(n)))];
  const result = [], keys = new Set();
  for (const row of list) {
    if (!nets.includes(row?.network)) continue;
    const item = kind === 'nfts' ? nftItem(row, wallet) : tokenItem(row, wallet);
    if (item && !keys.has(item.id)) { result.push(item); keys.add(item.id); }
  }
  return { items: result, totalCount: data.totalCount ?? list.length, omittedCount: list.length - result.length,
    partialNetworks: failures, pageKey: data.pageKey || null, fetchedAt: new Date(now).toISOString() };
}
async function readResponse(response, controller) {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
      Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw unavailable();
  const reader = response.body.getReader(); const buffer = Buffer.alloc(MAX_BYTES); let pos = 0;
  try {
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_BYTES - pos) throw unavailable();
      buffer.set(value, pos); pos += value.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, pos)));
  } finally { void reader.cancel().catch(() => {}); }
}
async function fromAlchemy(wallet, kind, nets, page, s) {
  const endpoint = kind === 'nfts' ? 'assets/nfts/by-address' : 'assets/tokens/by-address';
  const url = 'https://api.g.alchemy.com/data/v1/' + s.key + '/' + endpoint;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const body = { addresses: [{ address: wallet, networks: nets }],
      ...(kind === 'nfts' ? { pageSize: PAGE_SIZE, withMetadata: true, excludeFilters: ['SPAM'] } :
        { withMetadata: true, withPrices: true, includeNativeTokens: true, includeErc20Tokens: true }),
      ...(page ? { pageKey: page } : {}) };
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return normalized(await readResponse(response, controller), wallet, kind, nets, Date.now());
  } catch { throw unavailable(); }
  finally { clearTimeout(timer); controller.abort(); }
}
// Only a user clicking "Load" may call this route. No polling, server worker,
// automatic page traversal, contract write, background refresh or token transfers.
export async function readMultichainWalletAssets(wallet, opts = {}) {
  if (!normalizeWallet(wallet) || normalizeWallet(wallet) !== wallet || /^0x0{40}$/.test(wallet)) throw unavailable();
  const kind = kindOf(opts.view), nets = selection(opts.network), s = settings(), now = Date.now();
  const page = cursorOf(opts.cursor, wallet, kind, opts.network, s, now);
  const key = createHash('sha256').update([s.fingerprint, wallet, kind, opts.network, page].join(':')).digest('hex');
  for (const [k,v] of cached) if (v.until <= now) cached.delete(k);
  let entry = cached.get(key);
  if (!entry) {
    let pending = inflight.get(key);
    if (!pending) {
      charge(wallet, now);
      pending = fromAlchemy(wallet, kind, nets, page, s).then(data => ({ data, until: Date.now() + CACHE_MS }),
        () => ({ error: true, until: Date.now() + 30_000 })).then(value => {
        if (cached.size >= MAX_CACHE) cached.delete(cached.keys().next().value);
        cached.set(key, value); return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    entry = await pending;
  }
  if (settings().fingerprint !== s.fingerprint) throw unavailable();
  if (entry.error) throw unavailable();
  const { pageKey, ...result } = entry.data;
  return { wallet, view: kind, selectedNetwork: opts.network, source: 'alchemy', ...result,
    networks: nets, nextCursor: signCursor(pageKey, wallet, kind, opts.network, s, Date.now()) };
}
