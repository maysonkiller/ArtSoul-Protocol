import crypto from 'node:crypto';
import {allowMethods, supabaseRest} from '../backend.js';
import {consumeServiceQuota, digest, emailAddress, privateDigest, publicOrigin, readBoundedJson, requireService, sendProductEmail, sendServiceError, serviceError} from '../launch-services.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    requireService('ARTSOUL_NEWSLETTER_ENABLED');
    const body = await readBoundedJson(req, 4096);
    const action = body.action === undefined ? 'subscribe' : body.action;
    if (!['subscribe', 'resubscribe', 'unsubscribe'].includes(action)) throw serviceError('INVALID_ACTION', 'The newsletter action is invalid.');
    if (action === 'unsubscribe') {
      if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) throw serviceError('INVALID_TOKEN', 'The unsubscribe link is invalid.');
      // Consume the capability to fence stale enrollment snapshots, even when
      // timestamps coincide. Reusing a consumed link remains an idempotent no-op.
      await supabaseRest(`email_subscriptions?unsubscribe_hash=eq.${digest(body.token)}`, {method: 'PATCH', body: {
        status: 'unsubscribed', unsubscribe_hash: digest(crypto.randomBytes(32)), updated_at: new Date().toISOString()
      }});
      return res.status(200).json({success: true, status: 'unsubscribed'});
    }
    const email = emailAddress(body.email);
    if (body.consent !== true) throw serviceError('CONSENT_REQUIRED', 'Explicit email consent is required.');
    if (!process.env.ARTSOUL_EMAIL_API_KEY || !process.env.ARTSOUL_EMAIL_FROM || /[\r\n]/.test(process.env.ARTSOUL_EMAIL_FROM)) throw serviceError('EMAIL_UNAVAILABLE', 'Email delivery is not configured.', 503);
    const origin = publicOrigin();
    const emailFilter = `email=eq.${encodeURIComponent(JSON.stringify(email))}`;
    // The first database read is the ordering boundary, not HTTP arrival across
    // instances. Capture it before quota waits; expose no status before quotas.
    const rows = await supabaseRest(`email_subscriptions?${emailFilter}&select=status,unsubscribe_hash,updated_at&limit=1`);
    if (!Array.isArray(rows) || rows.length > 1) throw serviceError('SERVICE_UNAVAILABLE', 'Subscription state is unavailable.', 503);
    const existing = rows[0];
    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    await consumeServiceQuota('newsletter-ip', privateDigest(ip), 5, 3600);
    if (existing?.status === 'subscribed') return res.status(200).json({success: true, status: 'subscribed', welcome_email: 'not_requested', message: 'This address is already subscribed. No new welcome email was requested.'});
    if (existing && existing.status !== 'unsubscribed') throw serviceError('SERVICE_UNAVAILABLE', 'Subscription state is unavailable.', 503);
    if (existing && action !== 'resubscribe') throw serviceError('RESUBSCRIBE_REQUIRED', 'This address was unsubscribed. Explicit resubscription consent is required.', 409);
    // Only an enrollment/send attempt consumes the daily email allowance;
    // clarifying consent or returning active status is already IP-limited.
    await consumeServiceQuota('newsletter-email', privateDigest(email), 1, 86400);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = digest(token);
    const now = new Date().toISOString();
    const enrollment = {email, status: 'subscribed', unsubscribe_hash: tokenHash,
      consent_version: 'product-updates-v1', consent_at: now, updated_at: now};
    const saved = existing
      ? await supabaseRest(`email_subscriptions?${emailFilter}&status=eq.unsubscribed&unsubscribe_hash=eq.${existing.unsubscribe_hash}&updated_at=eq.${encodeURIComponent(JSON.stringify(existing.updated_at))}`, {
        method: 'PATCH', headers: {Prefer: 'return=representation'}, body: enrollment
      })
      : await supabaseRest('email_subscriptions?on_conflict=email', {
        method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=representation'}, body: [enrollment]
      });
    if (Array.isArray(saved) && saved.length === 0) throw serviceError('SUBSCRIPTION_CHANGED', 'Subscription state changed while this request was in progress. No welcome email was requested.', 409);
    if (!Array.isArray(saved) || saved.length !== 1 || saved[0].unsubscribe_hash !== tokenHash || saved[0].status !== 'subscribed') throw serviceError('SERVICE_UNAVAILABLE', 'Subscription save could not be confirmed.', 503);
    const unsubscribe = `${origin}/join?unsubscribe=${token}`;
    // Consent is durable before this external effect. There is no outbox or
    // exactly-once delivery guarantee, and completion must never undo opt-out.
    let welcomeEmail = 'unconfirmed';
    try {
      await sendProductEmail({to: email, subject: 'Welcome to ArtSoul',
        text: `Welcome to ArtSoul.\n\nYou requested ArtSoul Protocol updates.\n\nWe'll email you when we ship something important, launch a new collection, or open a new ArtSoul experience.\n\nNo website access or collection eligibility depends on subscribing.\n\nUnsubscribe: ${unsubscribe}\n\n— ArtSoul Protocol`,
        idempotencyKey: `welcome-${tokenHash}`});
      welcomeEmail = 'accepted';
    } catch { /* Provider acceptance is uncertain; consent remains durable. */ }
    return res.status(200).json({success: true, status: 'consent_recorded', welcome_email: welcomeEmail,
      message: welcomeEmail === 'accepted' ? 'Your consent was saved. The email provider accepted the welcome message.' : 'Your consent was saved. Welcome email acceptance could not be confirmed.'});
  } catch (error) { return sendServiceError(res, error); }
}
