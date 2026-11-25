import { Interface, ZeroAddress, ZeroHash } from 'ethers';

const mintEvents = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Locked(uint256 tokenId)',
  'event GenesisGranted(uint256 indexed tokenId, address indexed recipient, uint8 indexed category, bytes32 decisionHash)',
  'event CollectionMinted(uint256 indexed phaseId, address indexed payer, address indexed recipient, uint256 firstTokenId, uint256 quantity, uint256 unitPrice)'
]);

function sameDeployment(designation, chainId, nftAddress) {
  return designation?.chainId === chainId && typeof designation.address === 'string' &&
    designation.address.toLowerCase() === nftAddress;
}

// Inputs come from the verified ownership, registration and launch readers.
// The canonical block is supplied independently of the transaction receipt.
// A Genesis grant here identifies the granted NFT itself, never every work
// made or held by its recipient. A Partner review covers one deployment.
export function verifiedArtworkAura({ chainId, nftAddress, tokenId }, {
  platformRegistration, genesisDeployment, partnerReview, receipt, canonicalMintBlock
}) {
  if ((chainId !== 8453 && chainId !== 84532) || typeof nftAddress !== 'string' || !/^0x[0-9a-f]{40}$/i.test(nftAddress) ||
      nftAddress.toLowerCase() === ZeroAddress || typeof tokenId !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(tokenId) ||
      BigInt(tokenId) >= (1n << 256n)) return null;
  nftAddress = nftAddress.toLowerCase();
  if (sameDeployment(platformRegistration, chainId, nftAddress) && platformRegistration.tokenId === tokenId) return 'platform';

  const genesis = chainId === 8453 && sameDeployment(genesisDeployment, chainId, nftAddress);
  const partner = partnerReview?.approved === true && sameDeployment(partnerReview, chainId, nftAddress);
  if ((!genesis && !partner) || canonicalMintBlock?.chainId !== chainId ||
      !Number.isSafeInteger(canonicalMintBlock.number) || canonicalMintBlock.number < 1 ||
      !Number.isSafeInteger(canonicalMintBlock.finalizedThrough) || canonicalMintBlock.finalizedThrough < canonicalMintBlock.number ||
      !/^0x[0-9a-f]{64}$/.test(canonicalMintBlock.hash) || canonicalMintBlock.hash === ZeroHash ||
      (receipt?.status !== 1 && receipt?.status !== '0x1') || !Array.isArray(receipt.logs) ||
      receipt.blockHash !== canonicalMintBlock.hash ||
      (receipt.blockNumber !== canonicalMintBlock.number && receipt.blockNumber !== '0x' + canonicalMintBlock.number.toString(16))) return null;
  const transactionHash = receipt.hash ?? receipt.transactionHash;
  if (!/^0x[0-9a-f]{64}$/.test(transactionHash) || transactionHash === ZeroHash) return null;

  const events = [];
  try {
    for (const log of receipt.logs) {
      if (log.address?.toLowerCase() === nftAddress) {
        if (log.removed === true || log.transactionHash !== transactionHash || log.blockHash !== receipt.blockHash) return null;
        const event = mintEvents.parseLog(log);
        if (event) events.push(event);
      }
    }
  } catch {
    return null;
  }
  const id = BigInt(tokenId);
  const mints = events.filter(event => event.name === 'Transfer' && event.args.from === ZeroAddress &&
    event.args.to !== ZeroAddress && event.args.tokenId === id);
  if (mints.length !== 1) return null;
  const recipient = mints[0].args.to;
  if (genesis) {
    const tokenEvents = events.filter(event => event.args.tokenId === id);
    if (tokenEvents.length === 3) {
      const [mint, lock, grant] = tokenEvents;
      if (mint === mints[0] && lock.name === 'Locked' && grant.name === 'GenesisGranted' &&
          grant.args.recipient === recipient && grant.args.category <= 3n && grant.args.decisionHash !== ZeroHash) return 'genesis';
    }
  }
  if (partner && events.filter(event => event.name === 'CollectionMinted' && event.args.recipient === recipient &&
      event.args.firstTokenId <= id && id < event.args.firstTokenId + event.args.quantity).length === 1) return 'partner';
  return null;
}
