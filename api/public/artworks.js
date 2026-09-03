import publicArtworksHandler from '../../src/api/routes/public/artworks.js';

export default async function handler(req, res) {
  // Match the shared API boundary while keeping this latency-sensitive public
  // read out of the catch-all function's unrelated auth, AI and upload graph.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  return publicArtworksHandler(req, res);
}
