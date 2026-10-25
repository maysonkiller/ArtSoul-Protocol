import { allowMethods, requireWallet, sendError, supabaseRest } from '../backend.js';
import { publicOrigin, readBoundedJson, serviceError } from '../launch-services.js';
import { readAuctionNotificationConfig } from '../auction-notification-config.js';
import { LEGACY_NOTIFICATION_TYPES, LIFECYCLE_NOTIFICATION_TYPES, notificationPreference,
  notificationMessage, validLifecycleFields } from '../../features/moderation/auction-notification-types.js';

const PAGE_SIZE = 20;
const validId = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const validUint = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
const validRevision = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const validChainRevision = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const validPreferences = (value, lifecycle) => exact(value,lifecycle ? ['auction_created','outbid','lifecycle'] : LEGACY_NOTIFICATION_TYPES) &&
  Object.values(value).every(flag => typeof flag === 'boolean');
const fail = (code,message,status=400) => serviceError(code,message,status);

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (!allowMethods(req,res,['GET','PUT'])) return;
  try {
    const wallet = requireWallet(req);
    if (typeof req.headers?.['x-artsoul-wallet'] !== 'string' || req.headers['x-artsoul-wallet'].toLowerCase() !== wallet) {
      throw fail('SESSION_WALLET_MISMATCH','Sign in with your connected wallet to view notifications.',401);
    }
    const config = readAuctionNotificationConfig();
    if (!config.enabled) throw fail('AUCTION_NOTIFICATIONS_DISABLED','Auction notifications are not active yet.',503);
    const lifecycle = req.query?.v === '2';
    if ((req.query?.v !== undefined && !lifecycle) || Object.keys(req.query || {}).some(key => !['before','route','v'].includes(key))) {
      throw fail('INVALID_NOTIFICATION_CURSOR','Choose a valid notification page.');
    }
    if (lifecycle && !config.lifecycleEnabled) throw fail('NOTIFICATIONS_UNAVAILABLE','Lifecycle notifications are not active yet.',503);
    const suffix = lifecycle ? '_v2' : '';
    const types = lifecycle ? [...LEGACY_NOTIFICATION_TYPES,...LIFECYCLE_NOTIFICATION_TYPES] : LEGACY_NOTIFICATION_TYPES;
    if (req.method === 'GET') {
      const before = req.query?.before;
      if (before !== undefined && !validId(before)) {
        throw fail('INVALID_NOTIFICATION_CURSOR','Choose a valid notification page.');
      }
      const data = await supabaseRest('rpc/read_auction_notifications'+suffix,{method:'POST',body:{p_wallet:wallet,p_core:config.coreAddress,p_before:before || null}});
      if (!Array.isArray(data?.items) || data.items.length > PAGE_SIZE+1 || !validChainRevision(data.chainRevision) || !validPreferences(data.preferences,lifecycle) || !validRevision(data.preferencesRevision)) throw new Error('Invalid notification projection');
      let previous = before ? BigInt(before) : 9223372036854775808n;
      for (const item of data.items) {
        if (!validId(item.id) || BigInt(item.id)>=previous || !types.includes(item.type) || !data.preferences[notificationPreference(item.type)] ||
          !validUint(item.artwork_id) || !(lifecycle ? validLifecycleFields(item) : validUint(item.auction_id)) || !/^0x[0-9a-f]{64}$/i.test(item.transaction_hash) ||
          !Number.isFinite(Date.parse(item.created_at)) || typeof item.read !== 'boolean' || typeof item.artworkAvailable !== 'boolean') throw new Error('Invalid notification row');
        previous = BigInt(item.id);
      }
      const items = data.items.slice(0,PAGE_SIZE).map(item => ({
        id:item.id,type:item.type,created_at:item.created_at,chain_id:'84532',core_address:config.coreAddress,
        artwork_id:item.artwork_id,auction_id:item.auction_id,transaction_hash:item.transaction_hash.toLowerCase(),read:item.read,
        artworkAvailable:item.artworkAvailable,message:notificationMessage(item),
        ...(lifecycle ? {token_id:item.token_id,amount_wei:item.amount_wei,settlement_deadline:item.settlement_deadline} : {})
      }));
      return res.status(200).json({wallet,items,nextCursor:data.items.length>PAGE_SIZE?items.at(-1).id:null,
        chainRevision:data.chainRevision,preferences:data.preferences,preferencesRevision:data.preferencesRevision});
    }
    const origins = new Set([publicOrigin(),...String(process.env.API_ALLOWED_ORIGINS || '').split(',').map(value=>value.trim()).filter(Boolean)]);
    if (req.headers.origin && !origins.has(req.headers.origin)) throw fail('INVALID_ORIGIN','Open ArtSoul to update notifications.',401);
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('JSON_REQUIRED','Use a JSON request.',415);
    const body = await readBoundedJson(req,4096);
    if (body.action === 'read') {
      if (!exact(body,['action','ids','read']) || !Array.isArray(body.ids) || body.ids.length<1 || body.ids.length>PAGE_SIZE ||
        body.ids.some(id=>!validId(id)) || new Set(body.ids).size!==body.ids.length || typeof body.read!=='boolean') throw fail('INVALID_NOTIFICATION_UPDATE','Choose valid notification updates.');
      const saved = await supabaseRest('rpc/mark_auction_notifications'+suffix,{method:'POST',body:{p_wallet:wallet,p_core:config.coreAddress,p_ids:body.ids,p_read:body.read}});
      if (saved?.updated===false) throw fail('NOTIFICATION_UNAVAILABLE','An update is no longer available. Reload your notifications.',409);
      if (saved?.updated!==true || !Array.isArray(saved.ids) || saved.ids.length!==body.ids.length ||
        new Set(saved.ids).size!==body.ids.length || saved.ids.some(id=>!body.ids.includes(id)) || saved.read!==body.read) throw new Error('Invalid read acknowledgement');
      return res.status(200).json({wallet,updated:saved.ids,read:saved.read});
    }
    if (body.action === 'preferences') {
      if (!exact(body,['action','expected_revision','preferences']) || !validRevision(body.expected_revision) || body.expected_revision===2147483647 ||
        !validPreferences(body.preferences,lifecycle)) throw fail('INVALID_NOTIFICATION_UPDATE','Choose valid notification preferences.');
      const saved = await supabaseRest('rpc/save_auction_notification_preferences'+suffix,{method:'POST',body:{p_wallet:wallet,p_core:config.coreAddress,
        p_revision:body.expected_revision,p_created:body.preferences.auction_created,p_outbid:body.preferences.outbid,
        ...(lifecycle ? {p_lifecycle:body.preferences.lifecycle} : {})}});
      if (saved?.saved===false) throw fail('NOTIFICATION_PREFERENCES_CONFLICT','Notification preferences changed elsewhere. Reload the latest settings.',409);
      if (saved?.saved!==true || saved.preferencesRevision!==body.expected_revision+1 || !validPreferences(saved.preferences,lifecycle) ||
        Object.keys(body.preferences).some(key=>saved.preferences[key]!==body.preferences[key])) throw new Error('Invalid preference acknowledgement');
      return res.status(200).json({wallet,preferences:saved.preferences,preferencesRevision:saved.preferencesRevision});
    }
    throw fail('INVALID_NOTIFICATION_UPDATE','Choose a supported notification update.');
  } catch (error) {
    if (!['UNAUTHENTICATED','SESSION_WALLET_MISMATCH','AUCTION_NOTIFICATIONS_DISABLED','INVALID_NOTIFICATION_CURSOR',
      'INVALID_ORIGIN','JSON_REQUIRED','BODY_TOO_LARGE','INVALID_JSON','INVALID_NOTIFICATION_UPDATE',
      'NOTIFICATION_UNAVAILABLE','NOTIFICATION_PREFERENCES_CONFLICT'].includes(error?.code)) {
      error=fail('NOTIFICATIONS_UNAVAILABLE','Notifications are temporarily unavailable. Please try again later.',503);
    }
    sendError(res,error);
  }
}
