import { allowMethods, readJson, requireWallet, sendError, supabaseRest } from '../../../backend.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_INLINE_MEDIA_BYTES = 4 * 1024 * 1024;
const MEDIA_FETCH_TIMEOUT_MS = 5000;

function readGeminiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function cleanText(value, limit = 1200) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback = null) {
  const parsed = toNumber(value, fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeConfidence(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (['high', 'medium', 'low'].includes(text)) return text;
  const numeric = clampNumber(value, 0, 1, null);
  if (numeric === null) return 'medium';
  if (numeric >= 0.72) return 'high';
  if (numeric <= 0.38) return 'low';
  return 'medium';
}

function parseMaybeJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || raw.match(/\{[\s\S]*\}/)?.[0] || raw;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function buildPrompt(payload, wallet) {
  const facts = {
    title: cleanText(payload.title, 160),
    description: cleanText(payload.description, 1000),
    creator_value_eth: cleanText(payload.creator_value ?? payload.start_price ?? payload.price, 40),
    media_type: cleanText(payload.media_type || payload.file_type, 40),
    artwork_id: cleanText(payload.artwork_id || payload.id, 128),
    creator: cleanText(payload.creator || payload.creator_id || wallet, 80),
    chain_id: cleanText(payload.chain_id || payload.chainId || 84532, 20),
    signals: {
      likes: toNumber(payload.like_count ?? payload.vote_count, 0),
      would_buy: toNumber(payload.would_buy_count, 0),
      watching: toNumber(payload.watching_count, 0)
    }
  };

  return [
    'You are ArtSoul Value Guidance, a conservative NFT art appraisal assistant.',
    'This is guidance only. It must not claim to set floor, settlement, royalty, ownership, or protocol truth.',
    'Return strict JSON only, with no markdown.',
    'Schema:',
    '{',
    '  "estimated_value_min_eth": number,',
    '  "estimated_value_max_eth": number,',
    '  "suggested_start_price_eth": number,',
    '  "confidence": "low" | "medium" | "high",',
    '  "rationale": "one or two short sentences",',
    '  "factors": ["short factor", "..."],',
    '  "risk_flags": ["short risk", "..."]',
    '}',
    'Use the creator value as context, not as truth. Be cautious for testnet, missing metadata, or limited market history.',
    `Artwork facts: ${JSON.stringify(facts)}`
  ].join('\n');
}

async function fetchInlineMedia(mediaUrl) {
  if (!mediaUrl) return null;

  let url;
  try {
    url = new URL(mediaUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
    if (!mimeType.startsWith('image/')) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_INLINE_MEDIA_BYTES) return null;

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_INLINE_MEDIA_BYTES) return null;

    return {
      inlineData: {
        mimeType,
        data: Buffer.from(arrayBuffer).toString('base64')
      }
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function readInlineMediaData(dataUrl) {
  const value = String(dataUrl || '').trim();
  if (!value || value.length > (MAX_INLINE_MEDIA_BYTES * 1.5) + 256) return null;

  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;

  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.byteLength > MAX_INLINE_MEDIA_BYTES) return null;
    return {
      inlineData: {
        mimeType: match[1].toLowerCase(),
        data: buffer.toString('base64')
      }
    };
  } catch {
    return null;
  }
}

async function callGemini({ apiKey, model, payload, wallet }) {
  const mediaUrl = payload.media_url || payload.file_url || payload.image || payload.animation_url || '';
  const inlineMedia = readInlineMediaData(payload.media_data_url) || await fetchInlineMedia(mediaUrl);
  const parts = [{ text: buildPrompt(payload, wallet) }];
  if (inlineMedia) parts.push(inlineMedia);

  const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(data?.error?.message || 'Gemini analysis failed');
    err.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
    err.code = 'GEMINI_ANALYSIS_FAILED';
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('\n')
    .trim();
  const parsed = parseMaybeJson(text);
  if (!parsed) {
    const err = new Error('Gemini returned an unreadable analysis');
    err.statusCode = 502;
    err.code = 'GEMINI_RESPONSE_INVALID';
    throw err;
  }

  const min = clampNumber(parsed.estimated_value_min_eth, 0, 1000000, 0);
  const max = Math.max(min, clampNumber(parsed.estimated_value_max_eth, 0, 1000000, min));
  const start = clampNumber(parsed.suggested_start_price_eth, 0, 1000000, min);

  return {
    estimated_value_min_eth: min,
    estimated_value_max_eth: max,
    suggested_start_price_eth: start,
    confidence: normalizeConfidence(parsed.confidence),
    rationale: cleanText(parsed.rationale, 500),
    factors: Array.isArray(parsed.factors) ? parsed.factors.map(item => cleanText(item, 120)).filter(Boolean).slice(0, 6) : [],
    risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags.map(item => cleanText(item, 120)).filter(Boolean).slice(0, 6) : [],
    used_media: Boolean(inlineMedia)
  };
}

function legacyConfidenceScore(confidence) {
  if (confidence === 'high') return 0.85;
  if (confidence === 'low') return 0.35;
  return 0.6;
}

function legacyArtworkUuid(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

async function tryInsertValuation(path, body) {
  return supabaseRest(path, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body
  });
}

async function logValuation(payload, result, wallet, model) {
  const artworkUuid = legacyArtworkUuid(payload.artwork_uuid || payload.legacy_artwork_id || payload.id);
  const average = (result.estimated_value_min_eth + result.estimated_value_max_eth) / 2;
  const rationale = [
    result.rationale,
    result.factors.length ? `Factors: ${result.factors.join('; ')}` : '',
    result.risk_flags.length ? `Risks: ${result.risk_flags.join('; ')}` : '',
    `Model: ${model}`,
    `Requester: ${wallet}`
  ].filter(Boolean).join('\n');

  const currentSchemaPayload = {
    artwork_id: artworkUuid,
    calculated_floor: average,
    avg_similar_sales: null,
    engagement_multiplier: 1,
    rarity_multiplier: 1,
    creator_multiplier: 1,
    confidence: result.confidence,
    similar_sales_count: 0,
    engagement_score: toNumber(payload.vote_count ?? payload.like_count, 0)
  };

  const legacySchemaPayload = {
    artwork_id: artworkUuid,
    estimated_value: average,
    confidence: legacyConfidenceScore(result.confidence),
    reason: rationale
  };

  try {
    const inserted = await tryInsertValuation('ai_valuations', [currentSchemaPayload]);
    return { logged: true, schema: 'calculated_floor', id: inserted?.[0]?.id || inserted?.[0]?.valuation_id || null };
  } catch (firstError) {
    try {
      const inserted = await tryInsertValuation('ai_valuations', [legacySchemaPayload]);
      return { logged: true, schema: 'estimated_value', id: inserted?.[0]?.id || inserted?.[0]?.valuation_id || null };
    } catch (secondError) {
      console.warn('[AI analyze] valuation log skipped:', secondError.code || secondError.message);
      return {
        logged: false,
        reason: secondError.code || firstError.code || 'AI_VALUATION_LOG_FAILED'
      };
    }
  }
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const wallet = requireWallet(req);
    const apiKey = readGeminiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'AI_ANALYSIS_UNAVAILABLE',
        message: 'AI analysis is temporarily unavailable.'
      });
    }

    const payload = await readJson(req);
    const model = cleanText(process.env.GEMINI_MODEL || DEFAULT_MODEL, 80);
    const valuation = await callGemini({ apiKey, model, payload, wallet });
    const logResult = await logValuation(payload, valuation, wallet, model);

    return res.status(200).json({
      success: true,
      source: 'gemini',
      model,
      guidance_only: true,
      valuation,
      valuation_logged: logResult.logged,
      valuation_log_schema: logResult.logged ? logResult.schema : undefined,
      valuation_log_id: logResult.id || undefined
    });
  } catch (error) {
    console.error('[AI analyze] request failed:', error.code || error.message);
    return sendError(res, error);
  }
}
