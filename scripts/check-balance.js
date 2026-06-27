import hre from "hardhat";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const address = await signer.getAddress();
  const balance = await hre.ethers.provider.getBalance(address);

  console.log("📍 Account:", address);
  console.log(" Balance:", hre.ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    console.log("\n No ETH! Get testnet ETH from:");
    console.log("   https://sepoliafaucet.com/");
    console.log("   https://www.alchemy.com/faucets/ethereum-sepolia");
    process.exit(1);
  }

  console.log(" Ready to create auction!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
