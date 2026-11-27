import { normalizeWallet, supabaseRest } from './backend.js';
import { verifiedArtworkAura } from './verified-artwork-aura.js';

function matchesRegistrationId(value, id) {
  return value === id || (Number.isSafeInteger(value) && String(value) === id);
}

function matchesRegistration(event, artwork, core, logIndex) {
  return Number(event?.chain_id) === 84532 && normalizeWallet(event.contract_address) === core &&
    event.event_name === 'ArtworkRegistered' && event.transaction_hash === artwork.transaction_hash &&
    event.log_index === logIndex && event.block_number === artwork.block_number &&
    event.artwork_id === artwork.artwork_id && matchesRegistrationId(event.event_data?.artworkId, artwork.artwork_id) &&
    typeof event.event_data.creator === 'string' && event.event_data.creator.toLowerCase() === artwork.creator.toLowerCase() &&
    event.event_data.metadataURI === artwork.metadata_uri;
}

// A publisher mark may precede minting. Bind it to the confirmed registration
// emitted by this Core, independently of the NFT ownership projection.
export async function confirmedPublisherWorks(candidates, core) {
  const verified = new Set();
  if (!candidates.length || candidates.length > 200) return verified;
  const state = await supabaseRest('indexer_state?select=last_confirmed_block&chain_id=eq.84532' +
    '&contract_address=ilike.' + core + '&limit=2', {signal:AbortSignal.timeout(1800)});
  if (!Array.isArray(state) || state.length !== 1 || !/^[1-9]\d*$/.test(String(state[0]?.last_confirmed_block))) return verified;
  const confirmed = Number(state[0].last_confirmed_block);
  const rows = candidates.filter(c => Number.isSafeInteger(c.block_number) && c.block_number > 0 &&
    c.block_number <= confirmed && Number.isSafeInteger(c.registration_log_index) && c.registration_log_index >= 0 &&
    /^[1-9]\d{0,77}$/.test(c.artwork_id) && /^0x[0-9a-f]{64}$/.test(c.transaction_hash) && typeof c.metadata_uri === 'string');
  await Promise.all(Array.from({length: Math.ceil(rows.length / 20)}, async (_, page) => {
    const batch = rows.slice(page * 20, page * 20 + 20);
    const hashes = [...new Set(batch.map(c => c.transaction_hash))];
    const ids = [...new Set(batch.map(c => c.artwork_id))];
    const events = await supabaseRest('contract_events?select=chain_id,contract_address,event_name,artwork_id::text,event_data,transaction_hash,log_index,block_number' +
      `&chain_id=eq.84532&contract_address=ilike.${core}&event_name=eq.ArtworkRegistered&transaction_hash=in.(${hashes})&artwork_id=in.(${ids})&limit=${batch.length + 1}`,
      {signal:AbortSignal.timeout(1800)});
    if (!Array.isArray(events) || events.length > batch.length) return;
    for (const card of batch) {
      const matches = events.filter(e => matchesRegistration(e, card, core, card.registration_log_index));
      if (matches.length === 1) verified.add(card);
    }
  }));
  return verified;
}

// The deployment and publisher are designated together. Changing the active
// Core cannot carry a previous deployment's visual status into its successor.
export function platformPublisherFor(config) {
  if (config?.chainId !== 84532) return null;
  const designation = process.env.ARTSOUL_PLATFORM_PUBLISHER_BASE_SEPOLIA || '';
  const [core, publisher, ...extra] = designation.toLowerCase().split(':');
  if (extra.length || core !== config.coreAddress ||
      !normalizeWallet(publisher) || /^0x0{40}$/.test(publisher)) return null;
  return publisher;
}

export async function publisherFrameStates(addresses, chain, core) {
  const states = await supabaseRest('rpc/publisher_frame_states',{method:'POST',body:{
    p_chain:chain,p_scope:core,p_addresses:addresses
  },signal:AbortSignal.timeout(2000)});
  if (!Array.isArray(states) || states.length > addresses.length ||
      new Set(states.map(s=>s?.address)).size !== states.length ||
      states.some(s=>!addresses.includes(s?.address) || !['platform','founder'].includes(s.kind) || typeof s.enabled !== 'boolean')) {
    throw new Error('Invalid publisher designation');
  }
  return states;
}

export async function readArtworkAuraKinds(artworks, ownership) {
  const qualified = new Map();
  if (!ownership?.config || !artworks.length) return qualified;
  const publisher = platformPublisherFor(ownership?.config);
  const publishers = new Map(publisher ? [[publisher, 'platform']] : []);
  const core = ownership.config.coreAddress;
  const proven = new Map(ownership.rows.map(row => [row.artwork_id, row]));
  if (process.env.ARTSOUL_AURA_SOURCES_ENABLED === 'true') {
    const addresses = [...new Set(artworks.filter(a => a.minted === true && proven.get(a.artwork_id)?.verified)
      .map(a => normalizeWallet(a.creator)).filter(Boolean))];
    if (!addresses.length || addresses.length > 200) return qualified;
    try {
      const states = await publisherFrameStates(addresses, ownership.config.chainId, core);
      for (const s of states) { if (s.enabled) publishers.set(s.address,s.kind); else publishers.delete(s.address); }
    } catch { return qualified; }
  }
  if (!publishers.size) return qualified;
  const confirmed = Number(ownership.confirmed_through);
  const candidates = artworks.filter(artwork => {
    const proof = proven.get(artwork.artwork_id);
    return Number(artwork.chain_id) === ownership.config.chainId && artwork.minted === true &&
      proof?.verified === true && proof.token_id === artwork.token_id && proof.latest_transfer.block_number <= confirmed &&
      typeof artwork.creator === 'string' && publishers.has(artwork.creator.toLowerCase()) &&
      typeof artwork.metadata_uri === 'string' && Number.isSafeInteger(artwork.block_number) &&
      artwork.block_number > 0 && artwork.block_number <= confirmed && Number.isSafeInteger(artwork.log_index) &&
      artwork.log_index >= 0 && /^0x[0-9a-f]{64}$/.test(artwork.transaction_hash);
  });
  // The ordinary feed is bounded to 200 works. Select only qualifying
  // registration receipts, in small batches using the transaction index.
  const batches = Array.from({ length: Math.ceil(candidates.length / 20) }, (_, index) =>
    candidates.slice(index * 20, (index + 1) * 20));
  await Promise.all(batches.map(async batch => {
    const hashes = [...new Set(batch.map(artwork => artwork.transaction_hash))];
    const ids = batch.map(artwork => artwork.artwork_id);
    let events;
    try {
      events = await supabaseRest('contract_events?select=chain_id,contract_address,event_name,artwork_id::text,event_data,transaction_hash,log_index,block_number' +
        `&chain_id=eq.84532&contract_address=ilike.${core}&event_name=eq.ArtworkRegistered` +
        `&transaction_hash=in.(${hashes.join(',')})&artwork_id=in.(${ids.join(',')})&limit=${batch.length + 1}`,
      { signal: AbortSignal.timeout(2000) });
    } catch {
      return;
    }
    if (!Array.isArray(events) || events.length > batch.length) return;
    for (const artwork of batch) {
      const matches = events.filter(event => matchesRegistration(event, artwork, core, artwork.log_index));
      if (matches.length === 1) {
        const { chainId, nftAddress } = ownership.config;
        const identity = { chainId, nftAddress, tokenId: proven.get(artwork.artwork_id).token_id };
        const kind = verifiedArtworkAura(identity, {
          platformRegistration: { chainId: Number(artwork.chain_id), address: nftAddress, tokenId: artwork.token_id }
        });
        if (kind) qualified.set(artwork.artwork_id, publishers.get(normalizeWallet(artwork.creator)));
      }
    }
  }));
  return qualified;
}
