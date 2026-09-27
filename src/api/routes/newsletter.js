import crypto from 'node:crypto';
import {allowMethods, supabaseRest} from '../backend.js';
import {consumeServiceQuota, digest, emailAddress, privateDigest, publicOrigin, readBoundedJson, requireService, sendProductEmail, sendServiceError, serviceError} from '../launch-services.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    requireService('ARTSOUL_NEWSLETTER_ENABLED');
    const body = await readBoundedJson(req, 4096);
    if (body.action === 'unsubscribe') {
      if (!/^[0-9a-f]{64}$/.test(body.token || '')) throw serviceError('INVALID_TOKEN', 'The unsubscribe link is invalid.');
      await supabaseRest(`email_subscriptions?unsubscribe_hash=eq.${digest(body.token)}`, {method: 'PATCH', body: {status: 'unsubscribed', updated_at: new Date().toISOString()}});
      return res.status(200).json({success: true, status: 'unsubscribed'});
    }
    const email = emailAddress(body.email);
    if (body.consent !== true) throw serviceError('CONSENT_REQUIRED', 'Explicit email consent is required.');
    if (!process.env.ARTSOUL_EMAIL_API_KEY || !process.env.ARTSOUL_EMAIL_FROM) throw serviceError('EMAIL_UNAVAILABLE', 'Email delivery is not configured.', 503);
    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    await consumeServiceQuota('newsletter-ip', privateDigest(ip), 5, 3600);
    await consumeServiceQuota('newsletter-email', privateDigest(email), 1, 86400);
    const token = crypto.randomBytes(32).toString('hex');
    const unsubscribe = `${publicOrigin()}/join?unsubscribe=${token}`;
    // The database status reflects actual provider acceptance. Failed requests
    // never claim subscription success and do not alter an existing opt-out.
    await sendProductEmail({to: email, subject: 'Welcome to ArtSoul',
      text: `Welcome to ArtSoul.\n\nYou're now subscribed to ArtSoul Protocol updates.\n\nWe'll email you when we ship something important, launch a new collection, or open a new ArtSoul experience.\n\nNo website access or collection eligibility depends on subscribing.\n\nUnsubscribe: ${unsubscribe}\n\n— ArtSoul Protocol`,
      idempotencyKey: `welcome-${digest(token)}`});
    await supabaseRest('email_subscriptions?on_conflict=email', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates'}, body: [{
      email, status: 'subscribed', unsubscribe_hash: digest(token), consent_version: 'product-updates-v1',
      consent_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }]});
    return res.status(200).json({success: true, status: 'subscribed', message: "You're in. Welcome to ArtSoul."});
  } catch (error) { return sendServiceError(res, error); }
}
