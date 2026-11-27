import { normalizeWallet, supabaseRest } from './backend.js';

// Only the deployment reviewed by the operator may supply a public profile serial.
export function profileGenesisDeployment() {
  if (process.env.ARTSOUL_PROFILE_GENESIS_ENABLED !== 'true') return null;
  try {
    const source = JSON.parse(process.env.ARTSOUL_PROFILE_GENESIS_DEPLOYMENT);
    const [genesis, safe, founder] = [source.genesis, source.safe, source.founder].map(normalizeWallet);
    const hash = String(source.genesisCodeHash ?? '').toLowerCase();
    if (source.chainId !== 8453 || [genesis, safe, founder].some(value => !value || /^0x0{40}$/.test(value)) ||
        genesis === safe || !/^0x[0-9a-f]{64}$/.test(hash) || /^0x0{64}$/.test(hash)) return null;
    return { p_genesis: genesis, p_code_hash: hash, p_authority: safe, p_founder: founder };
  } catch { return null; }
}

export async function publicGenesisSerial(wallet) {
  const deployment = profileGenesisDeployment();
  if (!deployment) return null;
  const serial = await supabaseRest('rpc/read_profile_genesis_serial', {
    method: 'POST', body: { ...deployment, p_wallet: wallet }, signal: AbortSignal.timeout(2000)
  });
  return Number.isInteger(serial) && serial >= 0 && serial < 10000 ? serial : null;
}

export async function walletGenesisFrames(page, wallet) {
  const deployment = profileGenesisDeployment();
  if (!deployment || process.env.ARTSOUL_AURA_SOURCES_ENABLED !== 'true' ||
      page?.wallet !== wallet || !Array.isArray(page.items) || page.items.length > 12) return page;
  const basePage = page.chainId === 8453 && page.network === 'Base' && page.view === undefined;
  function serialFor(item) {
    const onBase = basePage ? item.chainId === undefined && item.network === undefined :
      page.view === 'nfts' && item.network === 'base-mainnet' && item.chainId === 8453;
    if (!onBase || item.contractAddress !== deployment.p_genesis || item.tokenType !== 'ERC721' || item.quantity !== '1') return null;
    return typeof item.tokenId === 'string' && /^(0|[1-9]\d{0,3})$/.test(item.tokenId) ? Number(item.tokenId) : null;
  }
  const serials = [...new Set(page.items.map(serialFor).filter(id => id !== null))];
  if (!serials.length) return page;
  try {
    const rows = await supabaseRest('rpc/read_designated_wallet_genesis_frames', { method: 'POST',
      body: { ...deployment, p_wallet: wallet, p_serials: serials }, signal: AbortSignal.timeout(2000) });
    if (!Array.isArray(rows) || rows.length > serials.length ||
        rows.some(row => !serials.includes(row?.token_id) || typeof row.border_text !== 'boolean')) return page;
    const verified = new Map(rows.map(row => [row.token_id, row.border_text]));
    if (!verified.size || verified.size !== rows.length) return page;
    return { ...page, items: page.items.map(item => {
      const id = serialFor(item);
      return verified.has(id) ? { ...item, aura_kind: 'genesis', aura_border_text: verified.get(id) } : item;
    }) };
  } catch { return page; }
}
