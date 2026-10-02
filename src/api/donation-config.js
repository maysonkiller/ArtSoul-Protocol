export function readDonationConfig() {
    const address = String(process.env.ARTSOUL_DONATIONS_ADDRESS_BASE_SEPOLIA || '').toLowerCase();
    const valid = /^0x[0-9a-f]{40}$/.test(address) && !/^0x0{40}$/.test(address);
    return {
        enabled: process.env.ARTSOUL_DONATIONS_ENABLED === 'true' && valid,
        chainId: 84532,
        address: valid ? address : null
    };
}
