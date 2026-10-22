import { allowMethods, readJson, requireWallet } from '../../backend.js';
import { issuePublication, preparationDeployment, preparePublication } from '../../upload-publication.js';

const PUBLIC_ERRORS = new Map([
  ['UNAUTHENTICATED', 401], ['INVALID_PUBLICATION_ID', 400], ['INVALID_UPLOAD_PAYLOAD', 400],
  ['INVALID_PUBLICATION_METADATA', 400], ['MEDIA_PREPARATION_DISABLED', 503],
  ['MEDIA_UPLOAD_NOT_FOUND', 404], ['MEDIA_UPLOAD_MISMATCH', 409],
  ['MEDIA_UPLOAD_PATH_CONFLICT', 409], ['MEDIA_PREPARATION_MISMATCH', 409],
  ['INVALID_MEDIA_UPLOAD', 400], ['INVALID_MEDIA_PREPARATION', 400],
  ['PUBLICATION_METADATA_MISMATCH', 409], ['PUBLICATION_METADATA_CONFLICT', 409],
  ['PUBLICATION_METADATA_UNAVAILABLE', 503], ['UPLOAD_MEDIA_UNAVAILABLE', 503],
  ['UPLOAD_MEDIA_TIMEOUT', 503], ['UPLOAD_MEDIA_TOO_LARGE', 413],
  ['UNSUPPORTED_UPLOAD_MEDIA', 422], ['EMPTY_UPLOAD_MEDIA', 422],
  ['DUPLICATE_MEDIA', 409], ['PUBLICATION_BLOCKED', 409], ['PUBLICATION_MISMATCH', 409]
]);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    const wallet = requireWallet(req);
    const deployment = preparationDeployment();
    if (String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      return res.status(415).json({ error: 'JSON_REQUIRED' });
    }
    const body = await readJson(req);
    if (!body || !['issue', 'prepare'].includes(body.action)) {
      return res.status(400).json({ error: 'INVALID_PUBLICATION_ACTION' });
    }
    // The existing file route and browser remain unchanged until rollout.
    // No client-provided path, digest, wallet or chain can replace issued data.
    const result = body.action === 'issue'
      ? await issuePublication(wallet, body, deployment)
      : await preparePublication(wallet, body, deployment);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    const candidate = error instanceof SyntaxError ? 'INVALID_UPLOAD_PAYLOAD'
      : PUBLIC_ERRORS.has(error?.code) ? error.code : error?.details?.message;
    const code = PUBLIC_ERRORS.has(candidate) ? candidate : 'MEDIA_PREPARATION_UNAVAILABLE';
    return res.status(PUBLIC_ERRORS.get(code) || 503).json({ error: code });
  }
}
