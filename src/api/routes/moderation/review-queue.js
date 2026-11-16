import { allowMethods, normalizeWallet, sendError, supabaseRest } from '../../backend.js';
import { getModerationAccess, canReadStaffWallets, redactOtherStaffWallets } from '../../moderation-access.js';
import { requireProtocolAdminEnabled } from '../../protocol-admin-config.js';
import { readDonationConfig } from '../../donation-config.js';
import { readAdminArtworkCatalog } from '../../admin-artwork-catalog.js';
import { readReportingConfig } from '../../reporting-config.js';

const QUEUE_STATUSES = new Set(['pending_review', 'actioned', 'dismissed', 'resolved', 'withdrawn', 'all']);
const REPORT_FIELDS = 'id,chain_id,artwork_id,reporter_wallet,category,details,reference_url,status,created_at,updated_at,reviewed_by,reviewed_at,decision_reason';
const TARGET_FIELDS = 'target_type,donation_contract_address,donation_transaction_hash,donation_log_index';
const PROFILE_FIELDS = 'profile_wallet,profile_content_snapshot,profile_content_hash';

async function readReports(status, target) {
  const path = fields => `artwork_reports?${status === 'all' ? '' : `status=eq.${status}&`}select=${fields}&order=created_at.asc&limit=200`
    + (target?.type === 'profile_content' ? `&target_type=eq.profile_content&profile_wallet=eq.${target.profileWallet}`
      : target ? `&chain_id=eq.${target.chainId}&artwork_id=eq.${target.artworkId}`
      + (fields.includes('target_type') ? `&target_type=eq.${target.type}` : '') : '');
  let fields = `${REPORT_FIELDS},${TARGET_FIELDS},${PROFILE_FIELDS}`;
  try {
    // Read retained profile/donation reports even when new intake is paused.
    return await supabaseRest(path(fields));
  } catch (error) {
    const missingProfileColumn = ['42703', 'PGRST204'].includes(String(error?.details?.code || ''))
      && /profile_wallet|profile_content_snapshot|profile_content_hash/.test(String(error?.details?.message || error?.message || ''));
    if (missingProfileColumn && !readReportingConfig().profileEnabled && target?.type !== 'profile_content') {
      fields = `${REPORT_FIELDS},${TARGET_FIELDS}`;
      try { return await supabaseRest(path(fields)); } catch (legacyError) { error = legacyError; }
    }
    const code = String(error?.details?.code || '');
    const message = String(error?.details?.message || error?.message || '');
    const missingTargetColumn = ['42703', 'PGRST204'].includes(code)
      && /target_type|donation_contract_address|donation_transaction_hash|donation_log_index/.test(message);
    // A default-off release remains compatible with the existing A8 schema.
    // No permission, network, table or unrelated column failure is retried.
    if (readDonationConfig().enabled || target?.type === 'donation_message' || !missingTargetColumn) throw error;
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
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    requireProtocolAdminEnabled();
    await getModerationAccess(req, { strict: true });
    const requestedStatus = String(req.query?.status || 'pending_review').toLowerCase();
    if (!QUEUE_STATUSES.has(requestedStatus)) throw invalidStatus();
    const status = requestedStatus;
    let target = null;
    if (req.query?.target_type === 'profile_content' || req.query?.profile_wallet !== undefined) {
      const profileWallet = normalizeWallet(req.query?.profile_wallet);
      if (req.query?.target_type !== 'profile_content' || !profileWallet || /^0x0{40}$/.test(profileWallet)
        || req.query?.artworkId !== undefined || req.query?.chainId !== undefined) throw invalidStatus();
      target = { type: 'profile_content', profileWallet };
    } else if (req.query?.artworkId !== undefined || req.query?.chainId !== undefined) {
      const artworkId = String(req.query.artworkId || '');
      const chainId = String(req.query.chainId || '');
      if (!/^[1-9]\d{0,77}$/.test(artworkId) || BigInt(artworkId) >= 2n ** 256n
          || !/^[1-9]\d{0,9}$/.test(chainId) || Number(chainId) > 2147483647) {
        const error = new Error('Choose a valid artwork and network.');
        error.statusCode = 400; error.code = 'INVALID_REVIEW_TARGET'; throw error;
      }
      const type = req.query.target_type || 'artwork';
      if (!['artwork','donation_message'].includes(type)) throw invalidStatus();
      target = {chainId, artworkId, type};
    }
    if (status === 'all' && !target) throw invalidStatus();

    let reports;
    let hidden;
    let moderationLog;
    let notifications;
    try {
      [reports, hidden, moderationLog, notifications] = await Promise.all([
        readReports(status, target),
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

    const profileWallets = [...new Set((reports || []).filter(report => report.target_type === 'profile_content').map(report => report.profile_wallet))];
    let profiles = [];
    if (profileWallets.length) {
      try {
        if (profileWallets.some(wallet => normalizeWallet(wallet) !== wallet || /^0x0{40}$/.test(wallet))) throw new Error('Invalid profile review target');
        profiles = await supabaseRest(`profile_content_visibility?profile_wallet=in.(${profileWallets.join(',')})&select=profile_wallet,content_hash,hidden&limit=${profileWallets.length}`);
        if (!Array.isArray(profiles) || profiles.length > profileWallets.length || new Set(profiles.map(row => row.profile_wallet)).size !== profiles.length
          || profiles.some(row => !profileWallets.includes(row.profile_wallet) || typeof row.hidden !== 'boolean' || !/^[0-9a-f]{64}$/.test(row.content_hash))) throw new Error('Invalid profile review context');
        const byWallet = new Map(profiles.map(row => [row.profile_wallet, row]));
        reports = reports.map(report => report.target_type === 'profile_content' ? { ...report,
          profile_content_available: byWallet.has(report.profile_wallet),
          profile_content_changed: byWallet.get(report.profile_wallet)?.content_hash !== report.profile_content_hash,
          profile_content_hidden: byWallet.get(report.profile_wallet)?.hidden === true
        } : report);
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

    const artworkIds = [...new Set((reports || []).filter(row => Number(row.chain_id) === 84532)
      .map(row => String(row.artwork_id)))];
    const artworks = artworkIds.length ? (await readAdminArtworkCatalog({ids:artworkIds})).artworks : [];

    // Permissions can change while the queue is loading. Do not disclose staff
    // identities using the role/session that was valid only before those reads.
    const access = await getModerationAccess(req, { strict: true });
    const canReadAll = await canReadStaffWallets(access);
    return res.status(200).json({
      success: true,
      access: { role: access.role },
      data: {
        status,
        artworks,
        profiles,
        reports: redactOtherStaffWallets(reports, 'reviewed_by', access, canReadAll),
        // Intake events identify complaint participants, not staff decisions.
        events: events.map(event => event.event_type === 'REPORT_SUBMITTED' ? {...event}
          : redactOtherStaffWallets([event], 'actor_wallet', access, canReadAll)[0]),
        hidden: redactOtherStaffWallets(hidden, 'hidden_by', access, canReadAll),
        moderationLog: redactOtherStaffWallets(moderationLog, 'actor_wallet', access, canReadAll),
        notifications: notifications || []
      }
    });
  } catch (error) {
    sendError(res, error);
  }
}
