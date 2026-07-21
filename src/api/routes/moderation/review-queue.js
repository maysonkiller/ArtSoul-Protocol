import { allowMethods, sendError, supabaseRest } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { requireProtocolAdminEnabled } from '../../protocol-admin-config.js';

const QUEUE_STATUSES = new Set(['pending_review', 'actioned', 'dismissed', 'resolved', 'withdrawn']);

function invalidStatus() {
  const error = new Error('Choose a valid review queue status.');
  error.code = 'INVALID_REVIEW_STATUS';
  error.statusCode = 400;
  return error;
}

function databaseError(error) {
  const detail = String(error?.details?.code || error?.details?.message || error?.message || '');
  if (/42P01|PGRST205|artwork_reports|artwork_report_notifications/i.test(detail)) {
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
        supabaseRest(
          `artwork_reports?status=eq.${status}&select=id,chain_id,artwork_id,reporter_wallet,category,details,reference_url,status,created_at,updated_at,reviewed_by,reviewed_at,decision_reason&order=created_at.asc&limit=200`
        ),
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
