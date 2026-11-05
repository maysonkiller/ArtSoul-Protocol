#!/usr/bin/env node
// B36: one-shot ALchemy Portfolio diagnostics. Read-only, no deployments,
// no Vercel or account setting changes, no automatic polling or retries.
// Secrets must only come from the local process environment, never CLI args.
import { pathToFileURL } from 'node:url';

const ADMIN_URL = 'https://admin-api.alchemy.com/v1/usage/summary';
const NFT_URL = 'https://api.g.alchemy.com/data/v1/';
const FREE_LIMIT = 30_000_000n;
const HEADROOM = 100_000n;
const NETWORKS = Object.freeze(new Set([
  'base-mainnet', 'eth-mainnet', 'arb-mainnet', 'opt-mainnet',
  'matic-mainnet', 'linea-mainnet', 'bnb-mainnet', 'avax-mainnet',
  'robinhood-mainnet', 'soneium-mainnet', 'unichain-mainnet',
  'worldchain-mainnet', 'monad-mainnet', 'abstract-mainnet', 'zora-mainnet'
]));

export function parseArgs(args = []) {
  const flags = new Set(args);
  if (args.some(x => !['--dry-run', '--usage', '--probe', '--tokens', '--nfts'].includes(x) &&
      !/^--network=[a-z0-9-]+$/.test(x))) throw new Error('Unknown flag. No request sent.');
  if ([...['--dry-run','--usage','--probe']].filter(x=>flags.has(x)).length !== 1)
    throw new Error('Choose exactly one of --dry-run, --usage or --probe.');
  const n = args.filter(x => x.startsWith('--network='));
  if (n.length > 1) throw new Error('Choose exactly one network.');
  const network = n.length ? n[0].slice('--network='.length) : 'base-mainnet';
  if (!NETWORKS.has(network)) throw new Error('Network not allowed for this probe.');
  if (flags.has('--tokens') && flags.has('--nfts')) throw new Error('Choose tokens OR NFTs.');
  return { mode: flags.has('--dry-run') ? 'dry-run' : flags.has('--usage') ? 'usage' : 'probe',
    network, asset: flags.has('--tokens') ? 'tokens' : 'nfts' };
}

export function projectedCu(asset) {
  return asset === 'nfts' ? 1000 : asset === 'tokens' ? 360 : null;
}

export function requestBody(wallet, network, asset) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet) || /^0x0{40}$/.test(wallet)) throw new Error('Wallet address missing/invalid');
  if (!NETWORKS.has(network)) throw new Error('Network not on the probe allowlist');
  return { addresses: [{ address: wallet.toLowerCase(), networks: [network] }],
    ...(asset === 'nfts' ? { pageSize: 12, withMetadata: true, excludeFilters: ['SPAM'] } :
      asset === 'tokens' ? { withMetadata: true, withPrices: true,
        includeNativeTokens: true, includeErc20Tokens: true } :
      (() => { throw new Error('Unknown asset category'); })())
  };
}

export function verifyFreeHeadroom(data) {
  const usage = data?.data?.usageLimit;
  const limit = String(usage?.limit ?? '');
  const remaining = String(usage?.remaining ?? '');
  if (!/^[0-9]+$/.test(limit) || !/^[0-9]+$/.test(remaining) ||
      BigInt(limit) !== FREE_LIMIT || BigInt(remaining) < HEADROOM) {
    throw new Error('Cannot verify a free 30M-CU account with at least 100K remaining. No portfolio request.');
  }
  return { remainingCU: remaining, usedCU: String(usage?.used ?? ''),
    dataThrough: String(data?.data?.freshness?.dataThrough ?? '') };
}

async function getAdminUsage(accessKey, fetcher) {
  if (!accessKey) throw new Error('Missing read-only Alchemy Admin Usage access key.');
  const res = await fetcher(ADMIN_URL, { method: 'GET', headers: { Authorization: 'Bearer ' + accessKey,
    Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Admin Usage not available (HTTP ' + res.status + '). No portfolio request.');
  return await res.json();
}

async function safePortfolio(fetcher, apiKey, body, asset) {
  const endpoint = asset === 'nfts' ? 'assets/nfts/by-address' : 'assets/tokens/by-address';
  const res = await fetcher(NFT_URL + apiKey + '/' + endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(10000), body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, ok: false, count: null, partialNetworks: null };
  const bytes = Number(res.headers.get('content-length') || 0);
  if (bytes > 768 * 1024) throw new Error('Portfolio response exceeds 768 KiB; request already counted.');
  const content = await res.text();
  if (Buffer.byteLength(content) > 768 * 1024) throw new Error('Portfolio response exceeds 768 KiB; request already counted.');
  const parsed = JSON.parse(content);
  const items = parsed?.data?.[asset === 'nfts' ? 'ownedNfts' : 'tokens'];
  const partial = parsed?.error?.partialErrors;
  return { status: res.status, ok: Array.isArray(items),
    count: Array.isArray(items) ? items.length : null,
    partialNetworks: Array.isArray(partial) ? partial.map(x => x?.network).filter(x => typeof x === 'string').slice(0, 15) : [] };
}

export async function main(args = process.argv.slice(2), env = process.env, fetcher = fetch) {
  const options = parseArgs(args);
  if (options.mode === 'dry-run') {
    return { mode: 'dry-run', network: options.network, asset: options.asset,
      publishedMethodCU: projectedCu(options.asset),
      note: 'No API calls. Published CU weight is not a measured charge. Actual usage requires Usage readback.' };
  }
  const admin = env.ALCHEMY_ADMIN_USAGE_READ_KEY;
  if (!admin) throw new Error('Missing ALCHEMY_ADMIN_USAGE_READ_KEY; no requests sent.');
  const before = await getAdminUsage(admin, fetcher);
  if (options.mode === 'usage') return { mode: 'usage', usage: verifyFreeHeadroom(before),
    note: 'Read-only Admin Usage snapshot; freshness may lag.' };
  if (env.ARTSOUL_PROBE_FREE_NO_BILLING_CONFIRMED !== 'YES' ||
      env.ARTSOUL_PROBE_ONE_REQUEST_ACK !== 'YES') {
    throw new Error('Free/no-billing confirmation and one-request acknowledgement missing; no portfolio request.');
  }
  const checked = verifyFreeHeadroom(before);
  const wallet = env.ARTSOUL_PROBE_WALLET || '';
  const apiKey = env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY || '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(apiKey)) throw new Error('Missing dedicated server-only NFT key.');
  const body = requestBody(wallet, options.network, options.asset);
  const started = Date.now();
  // Exactly one Portfolio call. No loop, pagination, backoff or reload.
  const outcome = await safePortfolio(fetcher, apiKey, body, options.asset);
  let after;
  try { after = verifyFreeHeadroom(await getAdminUsage(admin, fetcher)); }
  catch { after = null; }
  const fresh = Boolean(after && checked.dataThrough && after.dataThrough > checked.dataThrough);
  return { mode: 'one-request-probe', network: options.network, asset: options.asset,
    publishedMethodCU: projectedCu(options.asset), elapsedMs: Date.now() - started,
    response: outcome, accountBefore: checked, accountAfter: after,
    measuredAccountDeltaCU: fresh && /^[0-9]+$/.test(checked.usedCU) && /^[0-9]+$/.test(after.usedCU)
      ? String(BigInt(after.usedCU) - BigInt(checked.usedCU)) : null,
    note: fresh ? 'Account-wide delta includes any other concurrent Alchemy activity.'
      : 'Admin usage freshness has not advanced. Run --usage later to verify; no additional Portfolio call is required.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => { console.log(JSON.stringify(result, null, 2)); }).catch(error => {
    // Errors may be caused by provider failures; never show raw provider JSON,
    // URLs or environment values that could contain secrets.
    const safe = /^(Unknown flag|Choose |Network |Wallet address |Unknown asset|Cannot verify|Missing |Free\/no-billing)/.test(error.message)
      ? error.message : 'Probe failed; no automatic retry. Verify credentials, access and request status privately.';
    console.error(safe); process.exitCode = 1;
  });
}
