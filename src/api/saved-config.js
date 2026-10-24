export function readSavedConfig() {
  const address = String(process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA || '').toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(address) && !/^0x0{40}$/.test(address);
  return {
    enabled: process.env.ARTSOUL_SAVED_ENABLED === 'true' && valid,
    chainId: 84532,
    coreAddress: valid ? address : null
  };
}
