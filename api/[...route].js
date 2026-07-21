import logoutHandler from '../src/api/routes/auth/logout.js';
import nonceHandler from '../src/api/routes/auth/nonce.js';
import sessionHandler from '../src/api/routes/auth/session.js';
import verifyHandler from '../src/api/routes/auth/verify.js';
import likeHandler from '../src/api/routes/discovery/like.js';
import signalHandler from '../src/api/routes/discovery/signal.js';
import functionsAiAnalyzeHandler from '../src/api/routes/functions/ai/analyze.js';
import functionsArtworksHandler from '../src/api/routes/functions/artworks.js';
import functionsAuctionsHandler from '../src/api/routes/functions/auctions.js';
import artworkVisibilityHandler from '../src/api/routes/moderation/artwork-visibility.js';
import passkeyRegisterOptionsHandler from '../src/api/routes/moderation/passkey-register-options.js';
import passkeyRegisterVerifyHandler from '../src/api/routes/moderation/passkey-register-verify.js';
import passkeyAuthOptionsHandler from '../src/api/routes/moderation/passkey-auth-options.js';
import passkeyAuthVerifyHandler from '../src/api/routes/moderation/passkey-auth-verify.js';
import passkeysHandler from '../src/api/routes/moderation/passkeys.js';
import passkeyGrantHandler from '../src/api/routes/moderation/passkey-grant.js';
import passkeyRecoveryHandler from '../src/api/routes/moderation/passkey-recovery.js';
import {
  createOAuthCallbackHandler,
  oauthStartHandler,
  oauthUnlinkHandler
} from '../src/api/routes/oauth.js';
import profileHandler from '../src/api/routes/profile.js';
import publicArtworksHandler from '../src/api/routes/public/artworks.js';
import publicArtworkProvenanceHandler from '../src/api/routes/public/artwork-provenance.js';
import publicAuctionLiveHandler from '../src/api/routes/public/auction-live.js';
import publicConfigHandler from '../src/api/routes/public/config.js';
import publicIndexerStatusHandler from '../src/api/routes/public/indexer-status.js';
import uploadFileHandler from '../src/api/routes/upload/file.js';

const ROUTES = new Map([
  ['auth/logout', logoutHandler],
  ['auth/nonce', nonceHandler],
  ['auth/session', sessionHandler],
  ['auth/verify', verifyHandler],
  ['profile', profileHandler],
  ['discovery/like', likeHandler],
  ['discovery/signal', signalHandler],
  ['public/artworks', publicArtworksHandler],
  ['public/artwork-provenance', publicArtworkProvenanceHandler],
  ['public/auction-live', publicAuctionLiveHandler],
  ['public/config', publicConfigHandler],
  ['public/indexer-status', publicIndexerStatusHandler],
  ['upload/file', uploadFileHandler],
  ['functions/ai/analyze', functionsAiAnalyzeHandler],
  ['functions/artworks', functionsArtworksHandler],
  ['functions/auctions', functionsAuctionsHandler],
  ['moderation/artwork-visibility', artworkVisibilityHandler],
  ['moderation/passkey-register-options', passkeyRegisterOptionsHandler],
  ['moderation/passkey-register-verify', passkeyRegisterVerifyHandler],
  ['moderation/passkey-auth-options', passkeyAuthOptionsHandler],
  ['moderation/passkey-auth-verify', passkeyAuthVerifyHandler],
  ['moderation/passkeys', passkeysHandler],
  ['moderation/passkey-grant', passkeyGrantHandler],
  ['moderation/passkey-recovery', passkeyRecoveryHandler],
  ['oauth/start', oauthStartHandler],
  ['oauth/callback/discord', createOAuthCallbackHandler('discord')],
  ['oauth/callback/twitter', createOAuthCallbackHandler('twitter')],
  ['oauth/unlink', oauthUnlinkHandler],
  ['ai/analyze', functionsAiAnalyzeHandler],
  ['artworks', functionsArtworksHandler],
  ['auctions', functionsAuctionsHandler]
]);

function routeFromRequest(req) {
  const value = req.query?.route;
  if (Array.isArray(value)) {
    return value.filter(Boolean).join('/');
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split('/').filter(Boolean).join('/');
  }

  const path = String(req.url || '').split('?')[0].replace(/^\/api\/?/, '');
  return path.split('/').filter(Boolean).join('/');
}

export default async function handler(req, res) {
  // Authenticated and write routes are private by default. Explicit public
  // handlers may replace Cache-Control with their documented short-lived cache.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  const route = routeFromRequest(req);
  const routeHandler = ROUTES.get(route);

  if (!routeHandler) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }

  return routeHandler(req, res);
}
