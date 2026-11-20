// Offline simulation of the mainnet-only grant path. Hardhat creates disposable accounts.
const { solidity } = require('./hardhat.local.config.cjs');
module.exports = { defaultNetwork: 'hardhat', networks: { hardhat: { chainId: 8453 } }, solidity };
