import hre from "hardhat";
import { ethers } from "ethers";

const { artifacts, network } = hre;
const DRY_RUN = process.env.DEPLOY_DRY_RUN === "1" || process.argv.includes("--dry-run");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required for V4.1 deployment`);
  }
  return value.trim();
}

function requireAddressEnv(name) {
  const value = requireEnv(name);
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return value;
}

function requireNetworkUrl() {
  const url = network.config?.url;
  if (!url || !url.trim()) {
    throw new Error(`RPC URL is required for Hardhat network ${network.name}`);
  }
  return url.trim();
}

async function loadArtifact(name) {
  const artifact = await artifacts.readArtifact(name);
  if (!artifact?.abi?.length || !artifact?.bytecode || artifact.bytecode === "0x") {
    throw new Error(`${name} artifact is missing ABI or bytecode`);
  }
  return artifact;
}

async function buildDeployer() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const provider = new ethers.JsonRpcProvider(requireNetworkUrl());
  return new ethers.Wallet(privateKey, provider);
}

async function deployContract(name, signer, args = []) {
  const artifact = await loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  const deploymentTx = contract.deploymentTransaction();
  console.log(`${name} deploy tx: ${deploymentTx.hash}`);

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const receipt = await deploymentTx.wait();
  console.log(`${name} deployed: ${address}`);
  console.log(`${name} block: ${receipt.blockNumber}`);

  return {
    contract,
    address,
    deployTxHash: deploymentTx.hash,
    deployBlockNumber: receipt.blockNumber
  };
}

async function sendAndWait(label, txPromise) {
  const tx = await txPromise;
  console.log(`${label} tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label} confirmed`);
  console.log(`${label} block: ${receipt.blockNumber}`);

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber
  };
}

async function validateDryRun() {
  requireAddressEnv("TREASURY_ADDRESS");
  const deployer = await buildDeployer();

  await Promise.all([
    loadArtifact("ArtSoulNFT"),
    loadArtifact("ArtSoulProjectNFT"),
    loadArtifact("ArtSoulCore")
  ]);

  console.log("Dry deploy validation passed");
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log("Treasury: configured");
  console.log("Artifacts: ArtSoulNFT, ArtSoulProjectNFT, ArtSoulCore");
}

async function main() {
  if (DRY_RUN) {
    await validateDryRun();
    return;
  }

  const treasury = requireAddressEnv("TREASURY_ADDRESS");
  const deployer = await buildDeployer();

  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log("Treasury: configured");

  const nft = await deployContract("ArtSoulNFT", deployer);
  const projectNft = await deployContract("ArtSoulProjectNFT", deployer);
  const core = await deployContract("ArtSoulCore", deployer, [
    nft.address,
    projectNft.address,
    treasury
  ]);

  const nftSetCore = await sendAndWait("ArtSoulNFT.setCore", nft.contract.setCore(core.address));
  const projectSetCore = await sendAndWait("ArtSoulProjectNFT.setCore", projectNft.contract.setCore(core.address));

  console.log("V4.1 deployment complete");
  console.log("Set these frontend/indexer addresses for this network:");
  console.log(`ARTSOUL_CORE_ADDRESS=${core.address}`);
  console.log(`ARTSOUL_NFT_ADDRESS=${nft.address}`);
  console.log(`ARTSOUL_PROJECT_NFT_ADDRESS=${projectNft.address}`);
  console.log("Deployment transaction hashes:");
  console.log(`ARTSOUL_NFT_DEPLOY_TX=${nft.deployTxHash}`);
  console.log(`ARTSOUL_PROJECT_NFT_DEPLOY_TX=${projectNft.deployTxHash}`);
  console.log(`ARTSOUL_CORE_DEPLOY_TX=${core.deployTxHash}`);
  console.log("setCore transaction hashes:");
  console.log(`ARTSOUL_NFT_SET_CORE_TX=${nftSetCore.txHash}`);
  console.log(`ARTSOUL_PROJECT_NFT_SET_CORE_TX=${projectSetCore.txHash}`);
  console.log("Deployment blocks:");
  console.log(`ARTSOUL_NFT_DEPLOY_BLOCK=${nft.deployBlockNumber}`);
  console.log(`ARTSOUL_PROJECT_NFT_DEPLOY_BLOCK=${projectNft.deployBlockNumber}`);
  console.log(`ARTSOUL_CORE_DEPLOY_BLOCK=${core.deployBlockNumber}`);
  console.log(`ARTSOUL_NFT_SET_CORE_BLOCK=${nftSetCore.blockNumber}`);
  console.log(`ARTSOUL_PROJECT_NFT_SET_CORE_BLOCK=${projectSetCore.blockNumber}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
