import hre from "hardhat";
import { ethers } from "ethers";
import { SUPPORTED_INDEXER_CHAINS } from "../src/indexer/chain-config.js";

const { artifacts, network } = hre;
const DRY_RUN = process.env.DEPLOY_DRY_RUN === "1" || process.argv.includes("--dry-run");
const target = SUPPORTED_INDEXER_CHAINS["base-sepolia"];

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required for V4.1 deployment`);
  }
  return value.trim();
}

function requireAddressEnv(name) {
  const value = requireEnv(name);
  if (!ethers.isAddress(value) || value.toLowerCase() === ethers.ZeroAddress) {
    throw new Error(`${name} must be a valid nonzero address`);
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
  if (artifact?.contractName !== name || !Array.isArray(artifact.abi) || !artifact.abi.length ||
      !ethers.isHexString(artifact.bytecode, true) || artifact.bytecode === "0x") {
    throw new Error(`${name} artifact is missing ABI or bytecode`);
  }
  return artifact;
}

function buildDeployer() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const provider = new ethers.JsonRpcProvider(requireNetworkUrl(), target.chainId);
  // All five transactions use this signer, including the two issuer bindings.
  return new ethers.NonceManager(new ethers.Wallet(privateKey, provider));
}

async function deployContract(artifact, signer, args = []) {
  const name = artifact.contractName;
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

async function main() {
  if (network.name !== target.slug) {
    throw new Error(`Prototype deployment is restricted to ${target.label} (${target.chainId})`);
  }
  const treasury = requireAddressEnv("TREASURY_ADDRESS");
  const deployer = buildDeployer();
  if (!DRY_RUN) {
    // ethers checks the RPC-reported chain against the pinned ID on this provider.
    try {
      await deployer.provider.getNetwork();
    } catch {
      throw new Error(`RPC did not confirm ${target.label} (chain ID ${target.chainId}); deployment stopped`);
    }
  }
  const [nftArtifact, projectArtifact, coreArtifact] = await Promise.all([
    loadArtifact("ArtSoulNFT"),
    loadArtifact("ArtSoulProjectNFT"),
    loadArtifact("ArtSoulCore")
  ]);

  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${await deployer.getAddress()}`);
  console.log("Treasury: configured");
  if (DRY_RUN) {
    console.log("Dry deploy validation passed (offline). Artifacts: ArtSoulNFT, ArtSoulProjectNFT, ArtSoulCore");
    return;
  }

  const nft = await deployContract(nftArtifact, deployer);
  const projectNft = await deployContract(projectArtifact, deployer);
  const core = await deployContract(coreArtifact, deployer, [
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
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
