import { MAX_METADATA_BYTES } from '../config/upload-policy.js';

const STORAGE_PATHS = ['/storage/v1/object/public/artworks/', '/storage/v1/render/image/public/artworks/'];
const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/;

function allowedArtworkUrl(value) {
  try {
    const text = String(value || '').trim();
    const url = new URL(text.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${text.slice(7)}` : text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    // Reject encoded separators and double encoding before a downstream router
    // can interpret them differently from the URL parser.
    if (/%(?:2f|5c|25)/i.test(url.pathname)) return null;
    const segments = decodeURIComponent(url.pathname).split('/');
    if (segments.some(segment => segment === '.' || segment === '..' || /[\\\u0000-\u001f\u007f]/.test(segment))) return null;

    if (url.origin === 'https://ipfs.io' && segments[1] === 'ipfs' && IPFS_CID.test(segments[2] || '')) return url;

    const configured = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const storage = new URL(configured);
    if (storage.protocol !== 'https:' || storage.username || storage.password || storage.port ||
        storage.pathname !== '/' || storage.search || storage.hash) return null;
    return url.origin === storage.origin && STORAGE_PATHS.some(prefix => url.pathname.startsWith(prefix) && url.pathname.length > prefix.length)
      ? url : null;
  } catch {
    return null;
  }
}

// Only these public artwork stores are fetched. Caller-controlled URLs never
// reach arbitrary hosts, REST/auth endpoints, or redirect destinations.
export async function fetchArtworkResource(uri, { maxBytes, timeoutMs, acceptContentType = () => true }) {
  const url = allowedArtworkUrl(uri);
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) return null;
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!acceptContentType(mimeType) || Number(response.headers.get('content-length')) > maxBytes) return null;
    if (!response.body) return null;

    reader = response.body.getReader();
    // A fixed buffer also bounds memory for streams split into tiny chunks.
    const data = Buffer.alloc(maxBytes);
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size) return null;
      data.set(value, size);
      size += value.byteLength;
    }
    return size ? { data: data.subarray(0, size), mimeType } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export async function readArtworkMetadata(uri) {
  try {
    const text = String(uri || '').trim();
    if (!text || text.length > MAX_METADATA_BYTES * 6) return {};
    let json;
    if (text.startsWith('{')) json = text;
    else if (text.startsWith('data:application/json;base64,')) json = Buffer.from(text.slice(29), 'base64').toString('utf8');
    else if (text.startsWith('data:application/json,')) json = decodeURIComponent(text.slice(22));
    else {
      const resource = await fetchArtworkResource(text, { maxBytes: MAX_METADATA_BYTES, timeoutMs: 2500 });
      if (!resource) return {};
      json = resource.data.toString('utf8');
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) return {};
    const metadata = JSON.parse(json);
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  } catch {
    return {};
  }
}
