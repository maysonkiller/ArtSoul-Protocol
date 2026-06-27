require("dotenv").config();

const deployerPrivateKey = process.env.PRIVATE_KEY;
const accounts = deployerPrivateKey ? [deployerPrivateKey] : [];

module.exports = {
  networks: {
    "base-sepolia": {
      url: process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL || "",
      accounts
    },
    "eth-sepolia": {
      url: process.env.ETH_SEPOLIA_RPC_URL || "",
      accounts
    }
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  }
};
