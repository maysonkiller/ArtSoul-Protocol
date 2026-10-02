import { allowMethods, sendError, supabaseRest } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { requireProtocolAdminEnabled } from '../../protocol-admin-config.js';
import { readDonationConfig } from '../../donation-config.js';

const QUEUE_STATUSES = new Set(['pending_review', 'actioned', 'dismissed', 'resolved', 'withdrawn']);
const REPORT_FIELDS = 'id,chain_id,artwork_id,reporter_wallet,category,details,reference_url,status,created_at,updated_at,reviewed_by,reviewed_at,decision_reason';
const TARGET_FIELDS = 'target_type,donation_contract_address,donation_transaction_hash,donation_log_index';

async function readReports(status) {
  const path = fields => `artwork_reports?status=eq.${status}&select=${fields}&order=created_at.asc&limit=200`;
  try {
    // Read retained donation reports even when new donations are paused.
    return await supabaseRest(path(`${REPORT_FIELDS},${TARGET_FIELDS}`));
  } catch (error) {
    const code = String(error?.details?.code || '');
    const message = String(error?.details?.message || error?.message || '');
    const missingTargetColumn = ['42703', 'PGRST204'].includes(code)
      && /target_type|donation_contract_address|donation_transaction_hash|donation_log_index/.test(message);
    // A default-off release remains compatible with the existing A8 schema.
    // No permission, network, table or unrelated column failure is retried.
    if (readDonationConfig().enabled || !missingTargetColumn) throw error;
    return await supabaseRest(path(REPORT_FIELDS));
  }
}

function invalidStatus() {
  const error = new Error('Choose a valid review queue status.');
  error.code = 'INVALID_REVIEW_STATUS';
  error.statusCode = 400;
  return error;
}

function databaseError(error) {
  const detail = `${error?.details?.code || ''} ${error?.details?.message || error?.message || ''}`;
  if (/42P01|42703|PGRST204|PGRST205|artwork_reports|artwork_report_notifications/i.test(detail)) {
    const mapped = new Error('Protocol Admin storage is not available yet.');
    mapped.code = 'PROTOCOL_ADMIN_SCHEMA_UNAVAILABLE';
    mapped.statusCode = 503;
    return mapped;
  }
  return error;
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    requireProtocolAdminEnabled();
    const access = await getModerationAccess(req, { strict: true });
    const requestedStatus = String(req.query?.status || 'pending_review').toLowerCase();
    if (!QUEUE_STATUSES.has(requestedStatus)) throw invalidStatus();
    const status = requestedStatus;

    let reports;
    let hidden;
    let moderationLog;
    let notifications;
    try {
      [reports, hidden, moderationLog, notifications] = await Promise.all([
        readReports(status),
        supabaseRest(
          'artwork_moderation_visibility?hidden=eq.true&select=chain_id,artwork_id,hidden_reason,hidden_by,hidden_at,updated_at&order=updated_at.desc&limit=200'
        ),
        supabaseRest(
          'artwork_moderation_log?select=id,chain_id,artwork_id,action,reason,actor_wallet,created_at&order=created_at.desc&limit=200'
        ),
        supabaseRest(
          'artwork_report_notifications?select=id,report_id,recipient_wallet,notification_type,created_at,read_at&order=created_at.desc&limit=200'
        )
      ]);
    } catch (error) {
      throw databaseError(error);
    }

    const donationReports = (reports || []).filter(report => report.target_type === 'donation_message');
    if (donationReports.length) {
      try {
        const ids = donationReports.map(report => report.id);
        const messages = await supabaseRest('rpc/read_donation_report_messages', {
          method: 'POST', body: { p_report_ids: ids }
        });
        if (!Array.isArray(messages) || messages.length !== ids.length
            || new Set(messages.map(row => row.report_id)).size !== ids.length
            || messages.some(row => !ids.includes(row.report_id) || typeof row.available !== 'boolean'
              || typeof row.hidden !== 'boolean' || (row.message !== null && typeof row.message !== 'string'))) {
          throw new Error('Invalid donation review context');
        }
        const byId = new Map(messages.map(row => [row.report_id, row]));
        reports = reports.map(report => report.target_type === 'donation_message'
          ? { ...report, donation_message: byId.get(report.id).message,
              donation_message_available: byId.get(report.id).available,
              donation_message_hidden: byId.get(report.id).hidden }
          : report);
      } catch (error) { throw databaseError(error); }
    }

    const reportIds = (reports || []).map(report => report.id).filter(Boolean);
    let events = [];
    if (reportIds.length > 0) {
      const encoded = reportIds.map(id => encodeURIComponent(id)).join(',');
      try {
        events = await supabaseRest(
          `artwork_report_events?report_id=in.(${encoded})&select=id,report_id,event_type,actor_wallet,reason,created_at&order=created_at.asc&limit=1000`
        );
      } catch (error) {
        throw databaseError(error);
      }
    }

    return res.status(200).json({
      success: true,
      access: { role: access.role },
      data: {
        status,
        reports: reports || [],
        events: events || [],
        hidden: hidden || [],
        moderationLog: moderationLog || [],
        notifications: notifications || []
      }
    });
  } catch (error) {
    sendError(res, error);
  }
}
