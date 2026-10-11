import { allowMethods, clearWalletSession } from '../../backend.js';
import { clearModerationSession } from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  const cookies = [];
  const cookieSink = { setHeader(_name, value) { cookies.push(value); } };
  clearWalletSession(cookieSink);
  clearModerationSession(cookieSink);
  res.setHeader('Set-Cookie', cookies);
  res.status(200).json({ success: true });
}
