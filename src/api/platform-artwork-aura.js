import { normalizeWallet, supabaseRest } from './backend.js';

function matchesRegistrationId(value, id) {
  return value === id || (Number.isSafeInteger(value) && String(value) === id);
}

// The deployment and publisher are designated together. Changing the active
// Core cannot carry a previous deployment's visual status into its successor.
export async function readPlatformArtworkIds(artworks, ownership) {
  const qualified = new Set();
  if (!ownership || ownership.config.chainId !== 84532) return qualified;
  const designation = process.env.ARTSOUL_PLATFORM_PUBLISHER_BASE_SEPOLIA || '';
  const [core, publisher, ...extra] = designation.toLowerCase().split(':');
  if (extra.length || core !== ownership.config.coreAddress ||
      !normalizeWallet(publisher) || /^0x0{40}$/.test(publisher)) return qualified;

  const confirmed = Number(ownership.confirmed_through);
  const proven = new Map(ownership.rows.map(row => [row.artwork_id, row]));
  const candidates = artworks.filter(artwork => {
    const proof = proven.get(artwork.artwork_id);
    return Number(artwork.chain_id) === ownership.config.chainId && artwork.minted === true &&
      proof?.verified === true && proof.token_id === artwork.token_id && proof.latest_transfer.block_number <= confirmed &&
      typeof artwork.creator === 'string' && artwork.creator.toLowerCase() === publisher &&
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
        `&chain_id=eq.84532&contract_address=eq.${core}&event_name=eq.ArtworkRegistered` +
        `&transaction_hash=in.(${hashes.join(',')})&artwork_id=in.(${ids.join(',')})&limit=${batch.length + 1}`,
      { signal: AbortSignal.timeout(2000) });
    } catch {
      return;
    }
    if (!Array.isArray(events) || events.length > batch.length) return;
    for (const artwork of batch) {
      const matches = events.filter(event => Number(event?.chain_id) === 84532 && event.contract_address === core &&
        event.event_name === 'ArtworkRegistered' && event.transaction_hash === artwork.transaction_hash &&
        event.log_index === artwork.log_index && event.block_number === artwork.block_number &&
        event.artwork_id === artwork.artwork_id && matchesRegistrationId(event.event_data?.artworkId, artwork.artwork_id) &&
        typeof event.event_data.creator === 'string' && event.event_data.creator.toLowerCase() === publisher &&
        event.event_data.metadataURI === artwork.metadata_uri);
      if (matches.length === 1) qualified.add(artwork.artwork_id);
    }
  }));
  return qualified;
}
