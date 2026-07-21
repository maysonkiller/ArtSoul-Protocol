import { allowMethods, readJson, sendError, supabaseRest } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { requireProtocolAdminEnabled } from '../../protocol-admin-config.js';

const REVIEW_ACTIONS = new Set(['hide', 'dismiss', 'reopen', 'restore']);

function requestError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function reportId(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)
    ? text
    : '';
}

function mapReviewError(error) {
  const detail = String(error?.details?.code || '') + ' ' + String(error?.details?.message || error?.message || '');
  if (detail.includes('REPORT_REVIEW_CONFLICT')) {
    return requestError('This report changed while it was open. Refresh and review the latest state.', 'REPORT_REVIEW_CONFLICT', 409);
  }
  if (detail.includes('REPORT_ALREADY_PENDING') || /23505|idx_artwork_reports_one_pending_category/.test(detail)) {
    return requestError('A newer pending report from the same reporter and category already exists for this artwork.', 'REPORT_ALREADY_PENDING', 409);
  }
  if (detail.includes('REPORT_ACTION_NOT_ALLOWED')) {
    return requestError('This action is not valid for the report\'s current state.', 'REPORT_ACTION_NOT_ALLOWED', 409);
  }
  if (detail.includes('REPORT_NOT_FOUND')) {
    return requestError('The report was not found.', 'REPORT_NOT_FOUND', 404);
  }
  if (/42P01|PGRST202|PGRST205|review_artwork_report/i.test(detail)) {
    return requestError('Protocol Admin storage is not available yet.', 'PROTOCOL_ADMIN_SCHEMA_UNAVAILABLE', 503);
  }
  return error;
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    requireProtocolAdminEnabled();
    const access = await getModerationAccess(req, { strict: true });
    let body;
    try {
      body = await readJson(req);
    } catch {
      throw requestError('Request body must be valid JSON.', 'INVALID_JSON');
    }

    const id = reportId(body.report_id);
    const action = String(body.action || '').trim().toLowerCase();
    const reason = String(body.reason || '').trim();
    const expectedUpdatedAt = String(body.expected_updated_at || '').trim();

    if (!id) throw requestError('Valid report_id is required.', 'INVALID_REPORT_ID');
    if (!REVIEW_ACTIONS.has(action)) throw requestError('Choose a valid review action.', 'INVALID_REVIEW_ACTION');
    if (!reason || reason.length > 500) {
      throw requestError('A review reason is required and must not exceed 500 characters.', 'INVALID_REVIEW_REASON');
    }
    if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
      throw requestError('A valid expected_updated_at value is required.', 'INVALID_REVIEW_VERSION');
    }

    let rows;
    try {
      rows = await supabaseRest('rpc/review_artwork_report', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          p_report_id: id,
          p_expected_updated_at: expectedUpdatedAt,
          p_action: action,
          p_reason: reason,
          p_actor_wallet: access.wallet
        }
      });
    } catch (error) {
      throw mapReviewError(error);
    }

    const report = rows?.[0];
    if (!report?.report_id) {
      throw requestError('The review decision was not recorded.', 'REPORT_REVIEW_FAILED', 500);
    }

    return res.status(200).json({
      success: true,
      report: {
        id: report.report_id,
        status: report.report_status,
        updated_at: report.report_updated_at,
        artwork_hidden: report.artwork_hidden === true
      }
    });
  } catch (error) {
    sendError(res, error);
  }
}
