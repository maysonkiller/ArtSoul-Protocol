import {
  allowMethods,
  readJson,
  requireWallet,
  sendError,
  supabaseRest
} from '../../backend.js';

const REPORTING_ENABLED = String(process.env.ARTSOUL_REPORTING_ENABLED || '').toLowerCase() === 'true';
const PUBLIC_ARTWORK_CHAINS = new Set([84532, 11155111]);
const REPORT_CATEGORIES = new Set([
  'copyright',
  'impersonation',
  'prohibited_content',
  'spam',
  'other'
]);

function requestError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function protocolId(value) {
  const text = String(value || '').trim();
  return /^\d{1,78}$/.test(text) && text !== '0' ? text : '';
}

function optionalHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 500) {
    throw requestError('Reference URL must not exceed 500 characters.', 'INVALID_REFERENCE_URL');
  }

  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    return parsed.toString();
  } catch {
    throw requestError('Reference URL must be a valid HTTP or HTTPS URL.', 'INVALID_REFERENCE_URL');
  }
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    if (!REPORTING_ENABLED) {
      throw requestError('Artwork reporting is not enabled yet.', 'REPORTING_DISABLED', 503);
    }

    const reporterWallet = requireWallet(req);
    const body = await readJson(req);
    const chainId = Number(body.chain_id);
    const artworkId = protocolId(body.artwork_id);
    const category = String(body.category || '').trim().toLowerCase();
    const details = String(body.details || '').trim();
    const referenceUrl = optionalHttpUrl(body.reference_url);

    if (!PUBLIC_ARTWORK_CHAINS.has(chainId)) {
      throw requestError('This artwork network cannot be reported through this form.', 'UNSUPPORTED_ARTWORK_CHAIN');
    }
    if (!artworkId) {
      throw requestError('Valid artwork_id is required.', 'INVALID_ARTWORK_ID');
    }
    if (!REPORT_CATEGORIES.has(category)) {
      throw requestError('Choose a valid report category.', 'INVALID_REPORT_CATEGORY');
    }
    if (!details || details.length > 2000) {
      throw requestError('Report details are required and must not exceed 2000 characters.', 'INVALID_REPORT_DETAILS');
    }
    if (body.good_faith_confirmed !== true) {
      throw requestError('Confirm that this report is accurate and submitted in good faith.', 'GOOD_FAITH_REQUIRED');
    }

    const rows = await supabaseRest('rpc/submit_artwork_report', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        p_chain_id: chainId,
        p_artwork_id: artworkId,
        p_reporter_wallet: reporterWallet,
        p_category: category,
        p_details: details,
        p_reference_url: referenceUrl || null,
        p_good_faith_confirmed: true
      }
    });
    const report = rows?.[0];
    if (!report?.report_id) {
      throw requestError('The report could not be recorded.', 'REPORT_SUBMISSION_FAILED', 500);
    }

    const alreadySubmitted = report.already_submitted === true;
    return res.status(alreadySubmitted ? 200 : 201).json({
      success: true,
      alreadySubmitted,
      report: {
        reference: report.report_id,
        status: report.report_status,
        created_at: report.report_created_at
      }
    });
  } catch (error) {
    sendError(res, error);
  }
}
