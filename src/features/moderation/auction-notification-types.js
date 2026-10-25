// Shared private-inbox vocabulary. These are recorded events, not current actions.
export const LEGACY_NOTIFICATION_TYPES = ['auction_created', 'outbid'];
export const LIFECYCLE_NOTIFICATION_TYPES = [
  'bid_received', 'auction_won', 'auction_ended', 'purchase_completed', 'sale_completed',
  'payment_missed', 'sale_unpaid', 'resale_purchased', 'resale_sold'
];
export const REMINDER_TYPES = ['auction_ending', 'payment_due'];
export function validReminderMinutes(values, sorted = false) {
  return Array.isArray(values) && values.length > 0 && values.length <= 3 &&
    values.every(value => Number.isInteger(value) && value >= 1 && value <= 1440) &&
    new Set(values).size === values.length && (!sorted || values.every((value,index) => index === 0 || value > values[index-1]));
}
export function validReminderFields(item, serverTime, minutes) {
  const now = Date.parse(serverTime);
  return REMINDER_TYPES.includes(item?.type) && typeof item.deadline === 'string' && /^[1-9][0-9]{0,12}$/.test(item.deadline) &&
    Number(item.deadline) <= 8640000000000 && Number.isFinite(now) && Number(item.deadline)*1000 > now &&
    minutes.includes(item.offset_minutes) && Number(item.deadline)*1000-now <= item.offset_minutes*60000 &&
    Date.parse(item.created_at) <= now;
}
export const notificationPreference = type => LEGACY_NOTIFICATION_TYPES.includes(type) ? type : 'lifecycle';
export const notificationHeading = type => ({
  auction_created: 'Auction created', outbid: 'Your bid was surpassed', bid_received: 'New bid on your artwork',
  auction_won: 'You won the auction', auction_ended: 'Auction ended without bids',
  purchase_completed: 'Purchase completed', sale_completed: 'Your artwork sold',
  payment_missed: 'Payment was not completed', sale_unpaid: 'Auction payment was not completed',
  resale_purchased: 'NFT purchased', resale_sold: 'Your NFT sold',
  auction_ending: 'Auction ending soon', payment_due: 'Auction payment due soon'
})[type] || 'Auction update';

export function notificationMessage(item) {
  const auction = `auction #${item.auction_id}`, artwork = `artwork #${item.artwork_id}`;
  return ({
    auction_created: `You created ${auction} for ${artwork}.`,
    outbid: `Your bid was surpassed in ${auction} for ${artwork}.`,
    bid_received: `A bid was placed in ${auction} for your ${artwork}.`,
    auction_won: `You won ${auction}. Winning requires payment before an NFT is minted. Open the artwork to check the current payment status.`,
    auction_ended: `Your ${auction} ended without bids. No NFT was minted.`,
    purchase_completed: `Payment for ${auction} completed and NFT #${item.token_id} was minted to you.`,
    sale_completed: `Payment for your ${artwork} completed in ${auction}.`,
    payment_missed: `The unpaid settlement for ${auction} was finalized as a default.`,
    sale_unpaid: `The unpaid settlement for your ${auction} was finalized as a default.`,
    resale_purchased: `You purchased NFT #${item.token_id} for ${artwork}.`,
    resale_sold: `Your NFT #${item.token_id} for ${artwork} was sold.`,
    auction_ending: `The current deadline for ${auction} is approaching. Open the artwork to check its latest state.`,
    payment_due: `Payment for ${auction} is due before the current deadline. An NFT is minted only after successful payment.`
  })[item.type];
}

const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
export function validLifecycleFields(item) {
  if (![LEGACY_NOTIFICATION_TYPES, LIFECYCLE_NOTIFICATION_TYPES].some(types => types.includes(item.type))) return false;
  if (![item.token_id, item.amount_wei, item.settlement_deadline].every(value => value === null || uint(value))) return false;
  if (item.type.startsWith('resale_')) {
    if (item.auction_id !== null || item.token_id === null || item.amount_wei === null) return false;
  } else if (!uint(item.auction_id) || item.auction_id === '0') return false;
  if (['purchase_completed', 'sale_completed'].includes(item.type) && (item.token_id === null || item.amount_wei === null)) return false;
  if (['bid_received', 'auction_won'].includes(item.type) && item.amount_wei === null) return false;
  if (item.type === 'auction_won' && (item.settlement_deadline === null || item.settlement_deadline === '0' ||
    BigInt(item.settlement_deadline) > 8640000000000n)) return false;
  return true;
}
