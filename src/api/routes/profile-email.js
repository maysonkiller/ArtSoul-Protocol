import crypto from 'node:crypto';
import {allowMethods, requireWallet, supabaseRest} from '../backend.js';
import {consumeServiceQuota, digest, emailAddress, privateDigest, publicOrigin, readBoundedJson, requireService, sendProductEmail, sendServiceError, serviceError} from '../launch-services.js';

const TOKEN_SECONDS = 15 * 60;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const wallet = requireWallet(req);
    if (typeof req.headers?.['x-artsoul-wallet'] !== 'string' || req.headers['x-artsoul-wallet'].toLowerCase() !== wallet) {
      throw serviceError('SESSION_WALLET_MISMATCH', 'Sign in with the wallet for this profile.', 401);
    }
    if (req.method === 'GET' && process.env.ARTSOUL_PROFILE_EMAIL_ENABLED !== 'true') {
      return res.status(200).json({success: true, wallet, available: false, verified: false});
    }
    requireService('ARTSOUL_PROFILE_EMAIL_ENABLED');
    if (req.method === 'GET') {
      const rows = await supabaseRest(`profile_email_connections?wallet_address=eq.${wallet}&select=verified_email,verified_at&limit=1`);
      if (!Array.isArray(rows) || rows.length > 1) throw serviceError('SERVICE_UNAVAILABLE', 'Email status is unavailable.', 503);
      const row = rows[0];
      return res.status(200).json({success: true, wallet, available: true, verified: Boolean(row?.verified_email && row?.verified_at),
        email: row?.verified_at ? row.verified_email : null});
    }
    const origin = publicOrigin();
    const origins = new Set([origin, ...String(process.env.API_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
    if (req.headers?.origin && !origins.has(req.headers.origin)) throw serviceError('INVALID_ORIGIN', 'Open your profile on ArtSoul to manage email.', 401);
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw serviceError('INVALID_JSON', 'Use a JSON request.');
    const body = await readBoundedJson(req, 4096);
    if (body.action === 'disconnect') {
      await supabaseRest('profile_email_connections?on_conflict=wallet_address', {
        method: 'POST', headers: {Prefer: 'resolution=merge-duplicates'},
        body: [{wallet_address: wallet, revision: crypto.randomUUID(), verified_email: null, verified_at: null,
          pending_email: null, pending_token_hash: null, pending_expires_at: null, updated_at: new Date().toISOString()}]
      });
      return res.status(200).json({success: true, wallet, verified: false});
    }
    if (body.action === 'confirm') {
      if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) throw serviceError('INVALID_TOKEN', 'The verification link is invalid.');
      await consumeServiceQuota('profile-email-confirm', privateDigest(wallet), 10, 600);
      const rows = await supabaseRest('rpc/confirm_profile_email', {method: 'POST', body: {p_wallet_address: wallet, p_token_hash: digest(body.token)}});
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].wallet_address !== wallet || !rows[0].verified_email || !rows[0].verified_at) {
        throw serviceError('INVALID_TOKEN', 'This link expired, was already used, or belongs to another wallet. Request a new link.', 400);
      }
      return res.status(200).json({success: true, wallet, verified: true});
    }
    if (body.action !== 'request') throw serviceError('INVALID_ACTION', 'Choose a valid email action.');
    const email = emailAddress(body.email);
    if (!process.env.ARTSOUL_EMAIL_API_KEY || !process.env.ARTSOUL_EMAIL_FROM || /[\r\n]/.test(process.env.ARTSOUL_EMAIL_FROM)) {
      throw serviceError('EMAIL_UNAVAILABLE', 'Email delivery is not configured.', 503);
    }
    // The first durable snapshot fences a request waiting on quotas against a
    // later disconnect or confirmation. Disconnect retains only this revision.
    let snapshots = await supabaseRest('profile_email_connections?on_conflict=wallet_address', {
      method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=representation'},
      body: [{wallet_address: wallet, revision: crypto.randomUUID()}]
    });
    if (Array.isArray(snapshots) && snapshots.length === 0) {
      snapshots = await supabaseRest(`profile_email_connections?wallet_address=eq.${wallet}&select=revision&limit=1`);
    }
    if (!Array.isArray(snapshots) || snapshots.length !== 1 || !/^[0-9a-f-]{36}$/i.test(snapshots[0].revision || '')) {
      throw serviceError('SERVICE_UNAVAILABLE', 'Email state is unavailable.', 503);
    }
    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    await consumeServiceQuota('profile-email-wallet', privateDigest(wallet), 3, 3600);
    await consumeServiceQuota('profile-email-address', privateDigest(email), 3, 3600);
    await consumeServiceQuota('profile-email-ip', privateDigest(ip), 10, 3600);
    const token = crypto.randomBytes(32).toString('hex');
    const hash = digest(token);
    const now = new Date();
    const rows = await supabaseRest(`profile_email_connections?wallet_address=eq.${wallet}&revision=eq.${snapshots[0].revision}`, {
      method: 'PATCH', headers: {Prefer: 'return=representation'},
      body: {revision: crypto.randomUUID(), pending_email: email, pending_token_hash: hash,
        pending_expires_at: new Date(now.getTime() + TOKEN_SECONDS * 1000).toISOString(), updated_at: now.toISOString()}
    });
    if (Array.isArray(rows) && rows.length === 0) throw serviceError('EMAIL_CHANGED', 'Email settings changed during this request. Please try again.', 409);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].wallet_address !== wallet || rows[0].pending_token_hash !== hash) {
      throw serviceError('SERVICE_UNAVAILABLE', 'The verification request could not be saved.', 503);
    }
    await sendProductEmail({to: email, subject: 'Verify your ArtSoul email',
      text: `Confirm this email for your ArtSoul wallet.\n\nOpen this link, connect the same wallet and select Confirm email:\n${origin}/profile#verify_email=${token}\n\nThe link expires in 15 minutes and works once. Your email stays private. This does not subscribe you to updates or change wallet sign-in.\n\nIf you did not request this, ignore this email.`,
      idempotencyKey: `profile-email-${hash}`});
    return res.status(200).json({success: true, wallet, status: 'verification_requested', expires_in: TOKEN_SECONDS});
  } catch (error) { return sendServiceError(res, error); }
}
