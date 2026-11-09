import { allowMethods, requireWallet, sendError } from '../backend.js';
import { readExternalWalletNfts, readExternalWalletEthQuote } from '../external-wallet-nfts.js';
import { readMultichainWalletAssets } from '../multichain-wallet-assets.js';

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
    const view = req.query?.view;
    const multi = view === 'multichain-nfts' || view === 'multichain-tokens';
    const allowedKeys = multi ? ['cursor', 'route', 'view', 'network'] : ['cursor', 'route', 'quote'];
    if (!validRoute || (req.query?.quote !== undefined && (req.query.quote !== 'eth-usd' || req.query.cursor !== undefined || multi)) || Object.keys(req.query || {}).some(key => !allowedKeys.includes(key)) ||
        (multi && (typeof req.query?.network !== 'string' || req.query.network.length > 40))) {
      throw Object.assign(new Error('Choose a valid wallet asset query.'), { code: 'INVALID_WALLET_NFT_QUERY', statusCode: 400 });
    }
    if (multi) {
      const data = await readMultichainWalletAssets(wallet, {
        view, network: req.query.network, cursor: req.query.cursor
      });
      return res.status(200).json(data);
    }
    const data = req.query?.quote === 'eth-usd' ? await readExternalWalletEthQuote(wallet) : await readExternalWalletNfts(wallet, req.query?.cursor);
    return res.status(200).json(data);
  } catch (error) {
    if (!['UNAUTHENTICATED', 'SESSION_WALLET_MISMATCH', 'INVALID_WALLET_NFT_QUERY', 'INVALID_WALLET_NFT_CURSOR',
      'WALLET_NFTS_DISABLED', 'WALLET_NFTS_CONFIG_UNAVAILABLE', 'WALLET_NFTS_UNAVAILABLE', 'WALLET_NFTS_RATE_LIMITED',
      'WALLET_ASSETS_DISABLED', 'WALLET_ASSETS_CONFIG_UNAVAILABLE', 'WALLET_ASSETS_UNAVAILABLE',
      'WALLET_ASSETS_RATE_LIMITED', 'INVALID_WALLET_ASSET_QUERY', 'INVALID_WALLET_ASSET_CURSOR'].includes(error?.code)) {
      error = Object.assign(new Error('Wallet NFTs are temporarily unavailable. Please try again.'), { code: 'WALLET_NFTS_UNAVAILABLE', statusCode: 503 });
    }
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    sendError(res, error);
  }
}
