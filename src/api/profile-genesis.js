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
