export function readAuctionNotificationConfig() {
  const coreAddress = String(process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA || '').toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(coreAddress) && !/^0x0{40}$/.test(coreAddress);
  return { enabled: process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED === 'true' && valid,
    chainId: 84532, coreAddress: valid ? coreAddress : null,
    ...(process.env.ARTSOUL_AUCTION_LIFECYCLE_ENABLED === 'true' && valid && process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED === 'true'
      ? {lifecycleEnabled: true,
        ...(process.env.ARTSOUL_AUCTION_REMINDERS_ENABLED === 'true' ? {remindersEnabled: true} : {})} : {}) };
}
