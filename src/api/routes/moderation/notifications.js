import { allowMethods, requireWallet, sendError, supabaseRest } from '../../backend.js';

const PAGE_SIZE = 20;
const MESSAGES = Object.freeze({
  REPORT_ACTIONED: 'A report you submitted was reviewed and action was taken.',
  REPORT_DISMISSED: 'A report you submitted was reviewed and dismissed.',
  REPORT_RESOLVED: 'A report you submitted has been resolved.',
  REPORT_REOPENED: 'A report you submitted has been reopened for review.',
  ARTWORK_HIDDEN: 'One of your artworks has been hidden from public discovery following a moderation review.',
  ARTWORK_RESTORED: 'One of your artworks has been restored to public discovery following a moderation review.'
});
const validId = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const validReportId = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const validProtocolId = value => typeof value === 'string' && /^\d{1,78}$/.test(value);
const failure = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET'])) return;
  try {
    const wallet = requireWallet(req);
    // The optional client identity is only a mismatch guard, never a recipient selector.
    const expectedWallet = req.headers?.['x-artsoul-wallet'];
    if (expectedWallet !== undefined && (typeof expectedWallet !== 'string' || expectedWallet.toLowerCase() !== wallet)) {
      throw failure(401, 'SESSION_WALLET_MISMATCH', 'Sign in with your connected wallet to view notifications.');
    }
    const before = req.query?.before;
    if (before !== undefined && !validId(before)) {
      throw failure(400, 'INVALID_NOTIFICATION_CURSOR', 'Choose a valid notification page.');
    }
    let rows, artworkByReport;
    try {
      // Read history independently of intake/review write flags. BIGINT cursors stay exact.
      rows = await supabaseRest(`artwork_report_notifications?recipient_wallet=eq.${wallet}&select=id::text,report_id,notification_type,created_at&order=id.desc&limit=${PAGE_SIZE + 1}${before ? `&id=lt.${before}` : ''}`);
      if (!Array.isArray(rows) || rows.some(row => !validId(row.id) || !validReportId(row.report_id) || !Object.hasOwn(MESSAGES, row.notification_type) || !Number.isFinite(Date.parse(row.created_at)))) {
        throw new Error('Invalid notification projection');
      }
      // Only references from this recipient's visible page may be resolved.
      // Complaint identity/content never crosses the response boundary.
      const reportIds = [...new Set(rows.slice(0, PAGE_SIZE).map(row => row.report_id))];
      const artworks = reportIds.length ? await supabaseRest(`artwork_reports?id=in.(${reportIds.join(',')})&select=id,chain_id::text,artwork_id::text&limit=${PAGE_SIZE}`) : [];
      if (!Array.isArray(artworks) || artworks.some(row => !reportIds.includes(row.id) || !validProtocolId(row.chain_id) || !validProtocolId(row.artwork_id))) throw new Error('Invalid artwork references');
      artworkByReport = new Map(artworks.map(row => [row.id, row]));
      if (reportIds.some(id => !artworkByReport.has(id))) throw new Error('Missing artwork reference');
    } catch {
      throw failure(503, 'NOTIFICATIONS_UNAVAILABLE', 'Notifications are temporarily unavailable. Please try again later.');
    }
    const items = rows.slice(0, PAGE_SIZE).map(row => ({
      id: row.id, type: row.notification_type, created_at: row.created_at, message: MESSAGES[row.notification_type],
      chain_id: artworkByReport.get(row.report_id).chain_id, artwork_id: artworkByReport.get(row.report_id).artwork_id
    }));
    return res.status(200).json({ wallet, items, nextCursor: rows.length > PAGE_SIZE ? items.at(-1).id : null });
  } catch (error) {
    sendError(res, error);
  }
}
