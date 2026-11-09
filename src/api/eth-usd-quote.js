const URL = 'https://api.coinbase.com/v2/prices/ETH-USD/spot';
const CACHE_MS = 5 * 60_000;
const BACKOFF_MS = 60_000;
const MAX_BYTES = 8 * 1024;
let cached = null;
let validUntil = 0;
let retryAfter = 0;
let pending = null;

async function fetchQuote() {
  const controller = new AbortController();
  let reader, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Quote unavailable')); }, 2000);
  });
  const request = (async () => {
    const response = await fetch(URL, {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal
    });
    controller.signal.throwIfAborted();
    if (response.body) reader = response.body.getReader();
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
        Number(response.headers.get('content-length')) > MAX_BYTES || !reader) throw new Error('Quote unavailable');
    const buffer = Buffer.alloc(MAX_BYTES);
    let size = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_BYTES - size) throw new Error('Quote unavailable');
      buffer.set(value, size);
      size += value.byteLength;
    }
    controller.signal.throwIfAborted();
    const { data } = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    if (!data || data.currency !== 'USD' || (data.base !== undefined && data.base !== 'ETH') ||
        typeof data.amount !== 'string' || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,18})?$/.test(data.amount) ||
        Number(data.amount) <= 0) throw new Error('Quote unavailable');
    return { symbol: 'ETH', currency: 'USD', amount: data.amount, source: 'Coinbase', fetchedAt: new Date(Date.now()).toISOString() };
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

// Display-only public quote. No wallet, NFT, credential, polling or retry input.
export async function readEthUsdQuote() {
  const now = Date.now();
  if (cached && validUntil > now) return { ...cached };
  if (retryAfter > now) return null;
  if (!pending) {
    pending = fetchQuote().then(quote => {
      cached = quote;
      validUntil = Date.now() + CACHE_MS;
      retryAfter = 0;
      return quote;
    }, () => {
      cached = null;
      retryAfter = Date.now() + BACKOFF_MS;
      return null;
    }).finally(() => { pending = null; });
  }
  const quote = await pending;
  return quote ? { ...quote } : null;
}
