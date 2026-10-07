import { supabaseRest } from './backend.js';
import { digest, emailAddress, publicOrigin, sendProductEmail } from './launch-services.js';

const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const enabled = () => process.env.ARTSOUL_MODERATION_EMAIL_ENABLED === 'true';
const rpc = (name, body) => supabaseRest(`rpc/${name}`, {method: 'POST', body, signal: AbortSignal.timeout(10000)});

// Only report references leave the protected queue. Complaint text, evidence,
// reporter identity and wallet credentials never enter a mailbox notification.
export async function deliverReportEmail(reportId) {
  if (!enabled()) return {status: 'disabled'};
  if (!validId(reportId)) throw new Error('INVALID_REPORT_REFERENCE');
  const to = emailAddress(process.env.ARTSOUL_MODERATION_ALERT_EMAIL);
  const from = process.env.ARTSOUL_EMAIL_FROM;
  if (!from || /[\r\n]/.test(from) || !process.env.ARTSOUL_EMAIL_API_KEY) throw new Error('EMAIL_CONFIGURATION_REQUIRED');
  const origin = publicOrigin();
  const subject = `ArtSoul report received: ${reportId}`;
  const text = `A new report is ready for review.\n\nReference: ${reportId}\nOpen the protected Admin panel: ${origin}/admin\n\nSign in with your assigned staff wallet and verify your passkey to read the report. This notification does not make a moderation decision.`;
  const payloadHash = digest(JSON.stringify({from, to, subject, text}));
  const rows = await rpc('claim_moderation_report_email', {p_report_id: reportId, p_payload_hash: payloadHash});
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('INVALID_DELIVERY_CLAIM');
  if (!rows.length) return {status: 'not_claimed'};
  const claim = rows[0];
  if (claim.report_id !== reportId || claim.payload_hash !== payloadHash || claim.state !== 'pending' || !validId(claim.attempt_token)) {
    throw new Error('INVALID_DELIVERY_CLAIM');
  }
  // Recheck after the awaited claim. A suspended worker or delayed response
  // must not send using an expired lease/provider deduplication window.
  const firstAttempt = Date.parse(claim.first_attempt_at), leaseUntil = Date.parse(claim.lease_until);
  const latestSendFinish = Date.now() + 15000;
  if (!Number.isFinite(firstAttempt) || !Number.isFinite(leaseUntil) || firstAttempt > Date.now()
    || leaseUntil <= latestSendFinish || firstAttempt + 23 * 60 * 60 * 1000 <= latestSendFinish) {
    throw new Error('DELIVERY_CLAIM_EXPIRED');
  }
  let accepted = false;
  try {
    await sendProductEmail({to, subject, text, idempotencyKey: `artsoul-report-${reportId}`});
    accepted = true;
  } catch {
    // A timeout can mean the provider accepted the email. The exact same key
    // and payload are used by bounded retries; raw provider errors are private.
  }
  const recorded = await rpc('finish_moderation_report_email', {
    p_report_id: reportId, p_attempt_token: claim.attempt_token,
    p_accepted: accepted, p_error_code: accepted ? null : 'DELIVERY_UNCONFIRMED'
  });
  if (recorded !== true) throw new Error('DELIVERY_RESULT_NOT_RECORDED');
  return {status: accepted ? 'accepted' : 'pending'};
}

export async function deliverPendingReportEmails() {
  if (!enabled()) return {status: 'disabled', attempted: 0};
  const rows = await rpc('pending_moderation_report_emails', {});
  if (!Array.isArray(rows) || rows.length > 3 || rows.some(row => !validId(row.report_id))) throw new Error('INVALID_DELIVERY_BATCH');
  const result = {status: 'complete', attempted: 0, accepted: 0, pending: 0, skipped: 0, failed: 0};
  for (const {report_id: reportId} of rows) {
    result.attempted++;
    try {
      const delivery = await deliverReportEmail(reportId);
      if (delivery.status === 'accepted') result.accepted++;
      else if (delivery.status === 'pending') result.pending++;
      else result.skipped++;
    } catch { result.failed++; }
  }
  return result;
}
