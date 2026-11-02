import { allowMethods, requireWallet, sendError } from '../backend.js';
import { readExternalWalletNfts } from '../external-wallet-nfts.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET'])) return;
  try {
    const wallet = requireWallet(req);
    const expected = req.headers?.['x-artsoul-wallet'];
    if (typeof expected !== 'string' || expected.toLowerCase() !== wallet) {
      throw Object.assign(new Error('Sign in with your connected wallet to view wallet NFTs.'), { code: 'SESSION_WALLET_MISMATCH', statusCode: 401 });
    }
    // The catch-all dispatcher preserves its route field. It is not an owner selector.
    const route = req.query?.route;
    const validRoute = route === undefined || route === 'wallet-nfts' ||
      (Array.isArray(route) && route.length === 1 && route[0] === 'wallet-nfts');
    if (!validRoute || Object.keys(req.query || {}).some(key => !['cursor', 'route'].includes(key))) {
      throw Object.assign(new Error('Choose a valid wallet NFT page.'), { code: 'INVALID_WALLET_NFT_QUERY', statusCode: 400 });
    }
    const data = await readExternalWalletNfts(wallet, req.query?.cursor);
    return res.status(200).json(data);
  } catch (error) {
    if (!['UNAUTHENTICATED', 'SESSION_WALLET_MISMATCH', 'INVALID_WALLET_NFT_QUERY', 'INVALID_WALLET_NFT_CURSOR',
      'WALLET_NFTS_DISABLED', 'WALLET_NFTS_CONFIG_UNAVAILABLE', 'WALLET_NFTS_UNAVAILABLE', 'WALLET_NFTS_RATE_LIMITED'].includes(error?.code)) {
      error = Object.assign(new Error('Wallet NFTs are temporarily unavailable. Please try again.'), { code: 'WALLET_NFTS_UNAVAILABLE', statusCode: 503 });
    }
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    sendError(res, error);
  }
}
