import { isDeepStrictEqual } from 'node:util';
import { getPublicStorageUrl, normalizeWallet, supabaseRest, supabaseStorageRest } from './backend.js';
import { allowedArtworkUrl, fetchArtworkResource } from './safe-artwork-fetch.js';
import { uploadedMediaUrl, verifyUploadedMedia } from './upload-media-identity.js';
import { verifyArtworkRegistration } from './upload-registration-evidence.js';
import { buildStoragePath, buildMetadataStoragePath, createSignedArtworkUpload } from './routes/upload/file.js';
import { ARTWORK_MIME_EXTENSIONS, MAX_ARTWORK_UPLOAD_BYTES, MAX_METADATA_BYTES } from '../config/upload-policy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/;
const METADATA_FILENAME = /^\d{13}-[0-9a-f-]{36}-[\w.-]{1,101}\.json$/;
const MEDIA_FIELDS = ['image', 'image_url', 'animation_url', 'media_url', 'file_url', 'poster_url', 'thumbnail_url'];
const fail = (code, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });
const rpc = (name, body) => supabaseRest(`rpc/${name}`, { method: 'POST', body, signal: AbortSignal.timeout(15000) });

export function publicationId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('INVALID_PUBLICATION_ID', 400);
  return value;
}

export function preparationDeployment() {
  // Preparation is not submission authorization. Do not enable this route
  // until its private schema and the remaining rollout prerequisites are verified.
  if (process.env.ARTSOUL_MEDIA_PREPARATION_ENABLED !== 'true') throw fail('MEDIA_PREPARATION_DISABLED', 503);
  const core = normalizeWallet(process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA);
  if (!core || /^0x0{40}$/.test(core)) throw fail('MEDIA_PREPARATION_UNAVAILABLE', 503);
  return { chainId: 84532, core };
}

function assertIssuance(row, wallet, deployment) {
  if (!row || row.creator_wallet !== wallet || Number(row.chain_id) !== deployment.chainId || row.core_address !== deployment.core) {
    throw fail('MEDIA_UPLOAD_NOT_FOUND', 404);
  }
  uploadedMediaUrl(wallet, row.media_path);
  const prefix = `metadata/${wallet}/`;
  if (typeof row.metadata_path !== 'string' || !row.metadata_path.startsWith(prefix) ||
      !METADATA_FILENAME.test(row.metadata_path.slice(prefix.length))) throw fail('MEDIA_PREPARATION_UNAVAILABLE', 503);
  const uri = getPublicStorageUrl('artworks', row.metadata_path);
  if (!allowedArtworkUrl(uri)) throw fail('MEDIA_PREPARATION_UNAVAILABLE', 503);
  return uri;
}

export async function issuePublication(wallet, body, deployment) {
  const id = publicationId(body.publication_id);
  const type = body.content_type;
  const size = body.size;
  if (!Object.hasOwn(ARTWORK_MIME_EXTENSIONS, type) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ARTWORK_UPLOAD_BYTES) {
    throw fail('INVALID_UPLOAD_PAYLOAD', 400);
  }
  const row = await rpc('issue_artwork_media_upload', {
    p_publication_id: id, p_chain_id: deployment.chainId, p_core_address: deployment.core,
    p_creator_wallet: wallet, p_media_path: buildStoragePath(wallet, body.file_name, type),
    p_metadata_path: buildMetadataStoragePath(wallet, 'metadata.json'), p_content_type: type, p_declared_size: size
  });
  assertIssuance(row, wallet, deployment);
  // Persist first; a lost signing response must not allocate a different path.
  const result = { publication_id: id, chain_id: deployment.chainId, core_address: deployment.core, can_submit: false };
  try {
    const upload = await createSignedArtworkUpload(row.media_path, row.declared_content_type, 'media', {
      signal: AbortSignal.timeout(15000)
    });
    return { ...result, upload, upload_complete: false };
  } catch (error) {
    // Supabase may reject non-upsert authorization once the object exists.
    // A lost PUT response is recovered from actual bytes, never by overwriting.
    let media;
    try { media = await verifyUploadedMedia(wallet, row.media_path); } catch { throw error; }
    if (media.size !== Number(row.declared_size) || media.contentType !== row.declared_content_type ||
        (row.media_sha256 && row.media_sha256 !== media.sha256)) throw fail('MEDIA_PREPARATION_MISMATCH');
    return { ...result, upload: null, upload_complete: true,
      media: { path: row.media_path, url: media.mediaUrl, sha256: media.sha256, size: media.size, content_type: media.contentType } };
  }
}

export function validatePublicationMetadata(input, row, media) {
  let metadata;
  try {
    const serialized = JSON.stringify(input);
    if (!serialized || Buffer.byteLength(serialized) > MAX_METADATA_BYTES) throw Error();
    metadata = JSON.parse(serialized);
  } catch { throw fail('INVALID_PUBLICATION_METADATA', 400); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      typeof metadata.name !== 'string' || !metadata.name.trim() ||
      !metadata.properties || typeof metadata.properties !== 'object' || Array.isArray(metadata.properties) ||
      !Array.isArray(metadata.attributes)) throw fail('INVALID_PUBLICATION_METADATA', 400);
  const owner = row.creator_wallet;
  const matchesOwner = value => normalizeWallet(value) === owner;
  if (!matchesOwner(metadata.creator) || !matchesOwner(metadata.properties.creator) ||
      metadata.media_url !== media.mediaUrl || metadata.properties.media_url !== media.mediaUrl ||
      metadata.media_type !== media.contentType || metadata.properties.media_type !== media.contentType) {
    throw fail('PUBLICATION_METADATA_MISMATCH');
  }
  // The projection can prioritize image or animation_url. Checking media_url
  // alone would let a second, unverified file appear as the published artwork.
  for (const scope of [metadata, metadata.properties]) {
    for (const key of MEDIA_FIELDS) {
      if (Object.hasOwn(scope, key) && scope[key] !== media.mediaUrl) throw fail('PUBLICATION_METADATA_MISMATCH');
    }
    for (const key of ['creator_address', 'creator_wallet']) {
      if (Object.hasOwn(scope, key) && !matchesOwner(scope[key])) throw fail('PUBLICATION_METADATA_MISMATCH');
    }
    for (const key of ['file_type', 'mime_type']) {
      if (Object.hasOwn(scope, key) && scope[key] !== media.contentType) throw fail('PUBLICATION_METADATA_MISMATCH');
    }
    if (Object.hasOwn(scope, 'files')) {
      if (!Array.isArray(scope.files) || scope.files.some(file => !file ||
          (file.uri || file.url) !== media.mediaUrl ||
          (file.uri !== undefined && file.uri !== media.mediaUrl) ||
          (file.url !== undefined && file.url !== media.mediaUrl) ||
          (file.type !== undefined && file.type !== media.contentType))) throw fail('PUBLICATION_METADATA_MISMATCH');
    }
  }
  const primaryField = media.contentType.startsWith('image/') ? 'image' : 'animation_url';
  if (metadata[primaryField] !== media.mediaUrl) throw fail('PUBLICATION_METADATA_MISMATCH');
  const creatorAttributes = metadata.attributes.filter(a => String(a?.trait_type || '').toLowerCase() === 'creator');
  if (!creatorAttributes.length || creatorAttributes.some(a => !matchesOwner(a.value))) throw fail('PUBLICATION_METADATA_MISMATCH');
  const mediaAttributes = metadata.attributes.filter(a => String(a?.trait_type || '').toLowerCase() === 'media type');
  if (mediaAttributes.some(a => a.value !== media.contentType)) throw fail('PUBLICATION_METADATA_MISMATCH');
  return metadata;
}

async function storePreparedMetadata(row, uri) {
  const encodedPath = row.metadata_path.split('/').map(encodeURIComponent).join('/');
  // A conflict or lost response is resolved by reading the fixed object and
  // comparing it with the durable pin. Never switch path or overwrite an object.
  try {
    await supabaseStorageRest(`object/artworks/${encodedPath}`, {
      method: 'POST', body: row.metadata_json, headers: { 'x-upsert': 'false' },
      signal: AbortSignal.timeout(15000)
    });
  } catch { /* Verify the actual object below, without exposing storage errors. */ }
  await verifyPreparedMetadata(row, uri);
}

async function verifyPreparedMetadata(row, uri) {
  const stored = await fetchArtworkResource(uri, {
    maxBytes: MAX_METADATA_BYTES, timeoutMs: 10000, acceptContentType: type => type === 'application/json'
  });
  if (!stored) throw fail('PUBLICATION_METADATA_UNAVAILABLE', 503);
  let parsed;
  try { parsed = JSON.parse(stored.data.toString('utf8')); } catch { throw fail('PUBLICATION_METADATA_CONFLICT'); }
  if (!isDeepStrictEqual(parsed, row.metadata_json)) throw fail('PUBLICATION_METADATA_CONFLICT');
}

async function readPreparation(wallet, id, deployment) {
  const rows = await supabaseRest(`artwork_media_preparations?publication_id=eq.${id}&creator_wallet=eq.${wallet}&select=*&limit=1`, {
    signal: AbortSignal.timeout(15000)
  });
  const row = rows?.[0];
  const metadataUri = assertIssuance(row, wallet, deployment);
  return { row, metadataUri };
}

export async function preparePublication(wallet, body, deployment) {
  const id = publicationId(body.publication_id);
  const { row, metadataUri } = await readPreparation(wallet, id, deployment);
  const metadata = validatePublicationMetadata(body.metadata, row, {
    mediaUrl: uploadedMediaUrl(wallet, row.media_path), contentType: row.declared_content_type
  });
  const media = await verifyUploadedMedia(wallet, row.media_path);
  if (media.size !== Number(row.declared_size) || media.contentType !== row.declared_content_type) throw fail('MEDIA_PREPARATION_MISMATCH');
  const pinned = await rpc('prepare_artwork_media_upload', {
    p_publication_id: id, p_creator_wallet: wallet, p_media_sha256: media.sha256,
    p_byte_size: media.size, p_content_type: media.contentType, p_metadata_json: metadata
  });
  assertIssuance(pinned, wallet, deployment);
  if (pinned.media_path !== row.media_path || pinned.metadata_path !== row.metadata_path ||
      pinned.media_sha256 !== media.sha256 || Number(pinned.byte_size) !== media.size ||
      pinned.content_type !== media.contentType || !isDeepStrictEqual(pinned.metadata_json, metadata)) {
    throw fail('MEDIA_PREPARATION_MISMATCH');
  }
  await storePreparedMetadata(pinned, metadataUri);
  const status = await rpc('claim_artwork_media_publication', {
    p_publication_id: id, p_chain_id: deployment.chainId, p_core_address: deployment.core,
    p_creator_wallet: wallet, p_media_sha256: media.sha256, p_media_path: row.media_path,
    p_byte_size: media.size, p_metadata_uri: metadataUri
  });
  if (['DUPLICATE_MEDIA', 'PUBLICATION_BLOCKED', 'PUBLICATION_MISMATCH'].includes(status)) throw fail(status);
  if (!['CLAIMED', 'RESUME', 'REGISTERED'].includes(status)) throw fail('MEDIA_PREPARATION_UNAVAILABLE', 503);
  return { publication_id: id, metadata_uri: metadataUri, media_sha256: media.sha256, claim_status: status, can_submit: false };
}

function submissionView(row, id, wallet, deployment) {
  if (!row || row.publication_id !== id || row.creator_wallet !== wallet ||
      Number(row.chain_id) !== deployment.chainId || row.core_address !== deployment.core) {
    throw fail('MEDIA_PUBLICATION_NOT_FOUND', 404);
  }
  return {
    publication_id: id, metadata_uri: row.metadata_uri, claim_status: row.claim_status,
    submission_started_at: row.submission_started_at || null,
    reported_transaction_hash: row.reported_transaction_hash || null,
    // The journal is dormant scaffolding, not registration authorization.
    // In particular, a client-reported hash does not establish broadcast.
    can_submit: false,
    ...(typeof row.submission_created === 'boolean' ? { submission_created: row.submission_created } : {})
  };
}

export async function journalPublication(wallet, body, deployment) {
  const id = publicationId(body.publication_id);
  const params = { p_publication_id: id, p_chain_id: deployment.chainId,
    p_core_address: deployment.core, p_creator_wallet: wallet };
  let row;
  if (body.action === 'begin') {
    const { metadataUri } = await readPreparation(wallet, id, deployment);
    row = await rpc('begin_artwork_media_submission', { ...params, p_metadata_uri: metadataUri });
  } else if (body.action === 'report-transaction') {
    const hash = typeof body.transaction_hash === 'string' ? body.transaction_hash.toLowerCase() : '';
    if (!TRANSACTION_HASH.test(hash)) throw fail('INVALID_TRANSACTION_HASH', 400);
    row = await rpc('report_artwork_media_transaction', { ...params, p_transaction_hash: hash });
  } else if (body.action === 'status') {
    const rows = await supabaseRest(`artwork_media_publications?publication_id=eq.${id}&creator_wallet=eq.${wallet}` +
      `&chain_id=eq.${deployment.chainId}&core_address=eq.${deployment.core}` +
      '&select=publication_id,creator_wallet,chain_id,core_address,metadata_uri,claim_status,submission_started_at,reported_transaction_hash&limit=1', {
      signal: AbortSignal.timeout(15000)
    });
    row = rows?.[0];
  } else {
    throw fail('INVALID_PUBLICATION_ACTION', 400);
  }
  return submissionView(row, id, wallet, deployment);
}

// Server-only recovery building block. Deliberately absent from the route and
// browser until deployment, legacy coverage and reorg handling are reviewed.
// The scan cursor and pinned deployment/readers come from the server, not JSON
// submitted by a browser. A lost response can repeat this exact reconciliation.
export async function recoverPublication(wallet, id, deployment, { rpcs, scan = null }) {
  publicationId(id);
  if (!wallet || normalizeWallet(wallet) !== wallet || /^0x0{40}$/.test(wallet)) throw fail('INVALID_RECOVERY_SCOPE', 400);
  const { row, metadataUri } = await readPreparation(wallet, id, deployment);
  if (!row.metadata_json || !row.media_sha256) throw fail('MEDIA_PREPARATION_MISMATCH');
  const journal = await journalPublication(wallet, { action: 'status', publication_id: id }, deployment);
  if (journal.metadata_uri !== metadataUri) throw fail('MEDIA_PREPARATION_MISMATCH');
  const media = await verifyUploadedMedia(wallet, row.media_path);
  if (row.media_sha256 !== media.sha256 || Number(row.byte_size) !== media.size ||
      row.content_type !== media.contentType) throw fail('MEDIA_PREPARATION_MISMATCH');
  validatePublicationMetadata(row.metadata_json, row, media);
  await verifyPreparedMetadata(row, metadataUri);
  const evidence = await verifyArtworkRegistration({ deployment, creator: wallet, metadataUri,
    transactionHash: scan ? null : journal.reported_transaction_hash, scan }, { rpcs });
  if (evidence.state !== 'verified') return { publication_id: id, ...evidence };
  const saved = await rpc('reconcile_artwork_media_registration', {
    p_publication_id: id, p_chain_id: deployment.chainId, p_core_address: deployment.core,
    p_creator_wallet: wallet, p_media_sha256: media.sha256, p_media_uri: media.mediaUrl,
    p_byte_size: media.size, p_metadata_uri: metadataUri, p_evidence: evidence
  });
  if (saved?.publication_id !== id || saved.can_submit !== false ||
      !['registered', 'conflict'].includes(saved.claim_status) ||
      (saved.registered_artwork_id !== null && (typeof saved.registered_artwork_id !== 'string' ||
        !/^[1-9]\d{0,77}$/.test(saved.registered_artwork_id))) ||
      (saved.claim_status === 'registered' && !saved.registered_artwork_id)) throw fail('MEDIA_PREPARATION_UNAVAILABLE', 503);
  return { publication_id: id, state: saved.claim_status, registered_artwork_id: saved.registered_artwork_id,
    registrations: evidence.registrations, can_submit: false,
    ...(evidence.coverage ? { coverage: evidence.coverage } : {}) };
}
