// ArtSoul V4.1 smart contract integration
// Frontend action adapter for auction-first lazy mint protocol.

import { ethers } from 'https://esm.sh/ethers@6.7.0';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// V4.1 deployments are intentionally configured after deployment.
// Runtime pages may set window.ARTSOUL_CONTRACTS before this module loads.
const DEFAULT_CONTRACTS = {
    baseSepolia: {
        core: ZERO_ADDRESS,
        nft: ZERO_ADDRESS,
        projectNFT: ZERO_ADDRESS,
        chainId: 84532
    },
    sepolia: {
        core: ZERO_ADDRESS,
        nft: ZERO_ADDRESS,
        projectNFT: ZERO_ADDRESS,
        chainId: 11155111
    }
};

function normalizeAddress(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : ZERO_ADDRESS;
}

function buildContractConfig(overrides = {}) {
    return Object.fromEntries(
        Object.entries(DEFAULT_CONTRACTS).map(([network, defaults]) => {
            const override = overrides?.[network] || {};
            return [network, {
                ...defaults,
                core: normalizeAddress(override.core ?? defaults.core),
                nft: normalizeAddress(override.nft ?? defaults.nft),
                projectNFT: normalizeAddress(override.projectNFT ?? defaults.projectNFT)
            }];
        })
    );
}

function formatTransactionError(error, fallback = 'The transaction could not be completed. Please try again.') {
    const nestedError = error?.info?.error || error?.error || {};
    const code = String(error?.code || nestedError?.code || '').toUpperCase();
    const messages = [
        error?.shortMessage,
        error?.reason,
        error?.revert?.name ? `Contract rejected the transaction: ${error.revert.name}` : '',
        nestedError?.message,
        error?.data?.message,
        error?.message
    ].filter(message => typeof message === 'string' && message.trim());
    const combined = messages.join(' | ').toLowerCase();

    if (code === 'ACTION_REJECTED' || code === '4001' || combined.includes('user rejected') || combined.includes('user denied')) {
        return 'Transaction was rejected in your wallet.';
    }
    if (combined.includes('insufficient funds') || combined.includes('insufficient gas') || combined.includes('not enough funds')) {
        return 'Not enough testnet ETH to cover the transaction and gas.';
    }
    if (combined.includes('nonce too low') || combined.includes('replacement transaction underpriced')) {
        return 'Your wallet has a pending or out-of-sync transaction. Wait for it to clear, then try again.';
    }
    if (combined.includes('unsupported network') || combined.includes('wrong network') || combined.includes('network changed')) {
        return 'The wallet network changed or is unsupported. Switch back to the artwork network and try again.';
    }

    const usefulMessage = messages.find(message => !/missing revert data|call_exception|unknown error/i.test(message));
    if (!usefulMessage) return fallback;

    return usefulMessage
        .replace(/^execution reverted(?::\s*)?/i, 'Transaction reverted: ')
        .replace(/\s*\(action=.*$/i, '')
        .trim() || fallback;
}

const CONTRACTS = buildContractConfig(globalThis.ARTSOUL_CONTRACTS);

const NFT_ABI = [
    'function totalSupply() view returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function approve(address to, uint256 tokenId)',
    'function getApproved(uint256 tokenId) view returns (address)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function tokenCreator(uint256 tokenId) view returns (address)',
    'function tokenToArtwork(uint256 tokenId) view returns (uint256)',
    'function artworkToToken(uint256 artworkId) view returns (uint256)',
    'function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address receiver, uint256 royaltyAmount)'
];

const CORE_ABI = [
    'function registerArtwork(string metadataURI) returns (uint256)',
    'function createAuction(uint256 artworkId, uint256 startPrice, uint256 duration) returns (uint256)',
    'function placeBid(uint256 auctionId, uint256 bidAmount) payable',
    'function endAuction(uint256 auctionId)',
    'function settleAuction(uint256 auctionId) payable',
    'function claimSettlementDefault(uint256 auctionId)',
    'function withdraw()',
    'function listResale(uint256 tokenId, uint256 price)',
    'function cancelResale(uint256 tokenId)',
    'function buyResale(uint256 tokenId) payable',
    'function artworks(uint256 artworkId) view returns (address creator, string metadataURI, bool minted, uint256 canonicalFloor, uint256 tokenId, uint256 activeAuctionId)',
    'function auctions(uint256 auctionId) view returns (uint256 artworkId, address creator, uint256 startPrice, uint256 duration, uint256 originalEndTime, uint256 endTime, uint256 totalExtension, uint256 highestBid, address highestBidder, uint256 depositLocked, uint256 settlementDeadline, uint8 status)',
    'function resaleListings(uint256 tokenId) view returns (address seller, uint256 price, bool active)',
    'function tokenToArtwork(uint256 tokenId) view returns (uint256)',
    'function pendingWithdrawals(address user) view returns (uint256)',
    'function projectEligibilityHash(address user) view returns (bytes32)',
    'function projectNFTMinted(address user) view returns (bool)',
    'function minimumBid(uint256 auctionId) view returns (uint256)',
    'function requiredDepositForBid(uint256 bidAmount) pure returns (uint256)',
    'function treasury() view returns (address)',
    'function owner() view returns (address)',
    'function paused() view returns (bool)',
    'function DEPOSIT_BPS() view returns (uint256)',
    'function PLATFORM_FEE_BPS() view returns (uint256)',
    'function ARTIST_ROYALTY_BPS() view returns (uint256)',
    'function MIN_DEPOSIT() view returns (uint256)',
    'function MIN_BID_INCREMENT_ABSOLUTE() view returns (uint256)',
    'function MIN_BID_INCREMENT_BPS() view returns (uint256)',
    'function AUCTION_DURATION_24H() view returns (uint256)',
    'function AUCTION_DURATION_36H() view returns (uint256)',
    'function AUCTION_DURATION_48H() view returns (uint256)',
    'function SETTLEMENT_WINDOW() view returns (uint256)',
    'function ANTI_SNIPING_WINDOW() view returns (uint256)',
    'function ANTI_SNIPING_EXTENSION() view returns (uint256)',
    'function MAX_TOTAL_EXTENSION() view returns (uint256)',
    'event ArtworkRegistered(uint256 indexed artworkId, address indexed creator, string metadataURI)',
    'event AuctionCreated(uint256 indexed auctionId, uint256 indexed artworkId, address indexed creator, uint256 startPrice, uint256 duration, uint256 endTime, uint256 chainId)',
    'event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 bidAmount, uint256 depositAmount)',
    'event BidDepositWithdrawn(uint256 indexed auctionId, address indexed bidder, uint256 amount)',
    'event AuctionExtended(uint256 indexed auctionId, uint256 oldEndTime, uint256 newEndTime)',
    'event AuctionEnded(uint256 indexed auctionId, address indexed winner, uint256 winningBid, uint256 settlementDeadline)',
    'event SettlementCompleted(uint256 indexed auctionId, uint256 indexed artworkId, address indexed winner, uint256 finalPrice, uint256 tokenId)',
    'event SettlementDefaulted(uint256 indexed auctionId, address indexed winner, uint256 artistAmount, uint256 platformAmount)',
    'event CanonicalFloorUpdated(uint256 indexed artworkId, uint256 indexed tokenId, uint256 floorPrice)',
    'event ResaleListed(uint256 indexed tokenId, address indexed seller, uint256 price)',
    'event ResaleCompleted(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 royaltyAmount, uint256 platformFee)',
    'event ProjectNFTEligibilityAchieved(address indexed user, bytes32 eligibilityHash)',
    'event ProjectNFTMinted(address indexed user, uint256 indexed tokenId, bytes32 eligibilityHash)'
];

class ArtSoulContracts {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.nftContract = null;
        this.coreContract = null;
        this.marketplaceContract = null; // Compatibility alias for active pages.
        this.currentNetwork = null;
    }

    async init(provider) {
        try {
            this.provider = new ethers.BrowserProvider(provider);
            const network = await this.provider.getNetwork();
            const chainId = Number(network.chainId);

            let networkKey = null;
            if (chainId === CONTRACTS.baseSepolia.chainId) {
                networkKey = 'baseSepolia';
            } else if (chainId === CONTRACTS.sepolia.chainId) {
                networkKey = 'sepolia';
            } else {
                throw new Error(`Unsupported network. Please switch to Base Sepolia (${CONTRACTS.baseSepolia.chainId}) or Ethereum Sepolia (${CONTRACTS.sepolia.chainId})`);
            }

            this.currentNetwork = networkKey;
            this.signer = await this.provider.getSigner();

            const addresses = CONTRACTS[this.currentNetwork];
            this.validateConfiguredAddresses(addresses);
            this.nftContract = new ethers.Contract(addresses.nft, NFT_ABI, this.signer);
            this.coreContract = new ethers.Contract(addresses.core, CORE_ABI, this.signer);
            this.marketplaceContract = this.coreContract;

            console.log('ArtSoul V4.1 contracts initialized on', this.currentNetwork);
            return true;
        } catch (error) {
            console.error('Contract initialization failed:', error);
            throw error;
        }
    }

    ensureCore() {
        if (!this.coreContract) {
            throw new Error('Contracts not initialized');
        }
    }

    isZeroAddress(address) {
        return !address || address.toLowerCase() === ZERO_ADDRESS;
    }

    validateConfiguredAddresses(addresses) {
        const missing = ['core', 'nft', 'projectNFT'].filter(key => this.isZeroAddress(addresses[key]));
        if (missing.length) {
            throw new Error(`V4.1 contract addresses not configured: ${missing.join(', ')}`);
        }

        const invalid = ['core', 'nft', 'projectNFT'].filter(key => !ethers.isAddress(addresses[key]));
        if (invalid.length) {
            throw new Error(`Invalid V4.1 contract addresses: ${invalid.join(', ')}`);
        }
    }

    formatEth(value) {
        return ethers.formatEther(value || 0n);
    }

    parseEth(value) {
        return ethers.parseEther(value.toString());
    }

    async waitForEvent(receipt, eventName) {
        for (const log of receipt.logs) {
            try {
                const parsed = this.coreContract.interface.parseLog(log);
                if (parsed?.name === eventName) {
                    return parsed;
                }
            } catch {
                // Ignore logs from other contracts.
            }
        }
        return null;
    }

    normalizeDuration(duration) {
        const value = Number(duration);
        const allowedSeconds = {
            24: 24 * 60 * 60,
            36: 36 * 60 * 60,
            48: 48 * 60 * 60
        };

        if ([allowedSeconds[24], allowedSeconds[36], allowedSeconds[48]].includes(value)) {
            return value;
        }

        if (allowedSeconds[value]) {
            return allowedSeconds[value];
        }

        // Legacy pages used "3" for a three-day V4 auction.
        // V4.1 supports only 24h/36h/48h, so legacy calls are safely mapped to 24h.
        return allowedSeconds[24];
    }

    auctionStatusName(status) {
        const names = ['none', 'active', 'settlement_pending', 'settled', 'defaulted'];
        return names[Number(status)] || 'unknown';
    }

    async getArtworkStruct(artworkId) {
        this.ensureCore();
        return await this.coreContract.artworks(artworkId);
    }

    async getAuctionStruct(auctionId) {
        this.ensureCore();
        return await this.coreContract.auctions(auctionId);
    }

    async resolveAuctionId(id) {
        this.ensureCore();
        const rawId = BigInt(id.toString());

        try {
            const auction = await this.getAuctionStruct(rawId);
            if (Number(auction.status) !== 0) {
                return rawId;
            }
        } catch {
            // Fall through to artwork lookup.
        }

        const artwork = await this.getArtworkStruct(rawId);
        if (artwork.activeAuctionId && artwork.activeAuctionId !== 0n) {
            return artwork.activeAuctionId;
        }

        throw new Error('No active auction found for this artwork');
    }

    async resolveTokenId(id) {
        this.ensureCore();
        const rawId = BigInt(id.toString());

        try {
            const artwork = await this.getArtworkStruct(rawId);
            if (artwork.minted && artwork.tokenId !== 0n) {
                return artwork.tokenId;
            }
        } catch {
            // Fall through to token lookup.
        }

        try {
            const owner = await this.nftContract.ownerOf(rawId);
            if (!this.isZeroAddress(owner)) {
                return rawId;
            }
        } catch {
            // Fall through to user-facing error.
        }

        throw new Error('NFT is not minted yet. Complete settlement first.');
    }

    async registerArtwork(metadataURI) {
        this.ensureCore();
        const tx = await this.coreContract.registerArtwork(metadataURI);
        console.log('Registering artwork...', tx.hash);
        const receipt = await tx.wait();
        const event = await this.waitForEvent(receipt, 'ArtworkRegistered');
        const artworkId = event?.args?.artworkId?.toString() || null;
        return { artworkId, txHash: tx.hash };
    }

    async uploadArtwork(ipfsHash, metadataURI) {
        // Compatibility wrapper: V4.1 stores canonical metadata URI on-chain.
        const canonicalMetadataURI = metadataURI || ipfsHash;
        return await this.registerArtwork(canonicalMetadataURI);
    }

    async createAuction(artworkId, startingPriceEth, duration) {
        this.ensureCore();
        const startPrice = this.parseEth(startingPriceEth);
        const durationSeconds = this.normalizeDuration(duration);
        const tx = await this.coreContract.createAuction(artworkId, startPrice, durationSeconds);
        console.log('Creating V4.1 auction...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async placeBid(auctionOrArtworkId, bidAmountEth) {
        this.ensureCore();
        const auctionId = await this.resolveAuctionId(auctionOrArtworkId);
        const bidAmount = this.parseEth(bidAmountEth);
        const deposit = await this.coreContract.requiredDepositForBid(bidAmount);
        const tx = await this.coreContract.placeBid(auctionId, bidAmount, { value: deposit });
        console.log('Placing V4.1 deposit bid...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async endAuction(auctionOrArtworkId) {
        this.ensureCore();
        const auctionId = await this.resolveAuctionId(auctionOrArtworkId);
        const tx = await this.coreContract.endAuction(auctionId);
        console.log('Ending V4.1 auction...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async completeSettlement(auctionOrArtworkId) {
        this.ensureCore();
        const auctionId = await this.resolveAuctionId(auctionOrArtworkId);
        const auction = await this.getAuctionStruct(auctionId);
        const remainingPayment = auction.highestBid > auction.depositLocked
            ? auction.highestBid - auction.depositLocked
            : 0n;
        const tx = await this.coreContract.settleAuction(auctionId, { value: remainingPayment });
        console.log('Completing V4.1 settlement...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async claimSettlementDefault(auctionOrArtworkId) {
        this.ensureCore();
        const auctionId = await this.resolveAuctionId(auctionOrArtworkId);
        const tx = await this.coreContract.claimSettlementDefault(auctionId);
        console.log('Claiming settlement default...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async withdraw() {
        this.ensureCore();
        const tx = await this.coreContract.withdraw();
        console.log('Withdrawing pending funds...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async getPendingWithdrawal(address) {
        this.ensureCore();
        return this.formatEth(await this.coreContract.pendingWithdrawals(address));
    }

    async getArtwork(artworkId) {
        this.ensureCore();
        const artwork = await this.getArtworkStruct(artworkId);
        let currentOwner = null;

        if (artwork.minted && artwork.tokenId !== 0n && this.nftContract) {
            try {
                currentOwner = await this.nftContract.ownerOf(artwork.tokenId);
            } catch {
                currentOwner = null;
            }
        }

        const status = artwork.minted ? 3 : (artwork.activeAuctionId !== 0n ? 1 : 0);
        return {
            id: artworkId.toString(),
            creator: artwork.creator,
            auctionWinner: null,
            currentOwner,
            metadataURI: artwork.metadataURI,
            minted: artwork.minted,
            canonicalFloor: this.formatEth(artwork.canonicalFloor),
            floorPrice: this.formatEth(artwork.canonicalFloor),
            salePrice: '0',
            status,
            tokenId: artwork.tokenId.toString(),
            activeAuctionId: artwork.activeAuctionId.toString(),
            createdAt: 0
        };
    }

    async getAuction(auctionOrArtworkId) {
        this.ensureCore();
        const auctionId = await this.resolveAuctionId(auctionOrArtworkId);
        const auction = await this.getAuctionStruct(auctionId);
        const statusName = this.auctionStatusName(auction.status);
        const uiState = {
            active: 'PRIMARY_ACTIVE',
            settlement_pending: 'WAITING_PAYMENT',
            settled: 'SOLD',
            defaulted: 'DEFAULTED'
        }[statusName] || 'UNKNOWN';
        const minimumBid = Number(auction.status) === 1
            ? await this.coreContract.minimumBid(auctionId)
            : 0n;

        return {
            auctionId: auctionId.toString(),
            artworkId: auction.artworkId.toString(),
            creator: auction.creator,
            seller: auction.creator,
            startTime: Number(auction.originalEndTime - auction.duration),
            endTime: Number(auction.endTime),
            startingPrice: this.formatEth(auction.startPrice),
            startPrice: this.formatEth(auction.startPrice),
            highestBid: this.formatEth(auction.highestBid),
            currentBid: this.formatEth(auction.highestBid),
            highestBidder: auction.highestBidder,
            auctionWinner: auction.highestBidder,
            winner: auction.highestBidder,
            depositLocked: this.formatEth(auction.depositLocked),
            minimumBid: this.formatEth(minimumBid),
            requiredNextBid: this.formatEth(minimumBid),
            settlementDeadline: Number(auction.settlementDeadline),
            winnerDeadline: Number(auction.settlementDeadline),
            duration: Number(auction.duration),
            totalExtension: Number(auction.totalExtension),
            status: statusName,
            state: uiState,
            ended: Number(auction.status) !== 1,
            settlementPending: Number(auction.status) === 2,
            settled: Number(auction.status) === 3,
            defaulted: Number(auction.status) === 4,
            depositAmount: this.formatEth(auction.depositLocked)
        };
    }

    async getCreatorArtworks() {
        console.warn('getCreatorArtworks is indexer/Supabase-backed in V4.1');
        return [];
    }

    async relistArtwork(artworkId, newPriceEth) {
        return await this.createAuction(artworkId, newPriceEth, 24);
    }

    async listResale(tokenOrArtworkId, priceEth) {
        this.ensureCore();
        const tokenId = await this.resolveTokenId(tokenOrArtworkId);
        const price = this.parseEth(priceEth);
        const coreAddress = await this.coreContract.getAddress();
        const seller = await this.signer.getAddress();
        const [approved, approvedForAll] = await Promise.all([
            this.nftContract.getApproved(tokenId),
            this.nftContract.isApprovedForAll(seller, coreAddress)
        ]);

        if (approved.toLowerCase() !== coreAddress.toLowerCase() && !approvedForAll) {
            const approveTx = await this.nftContract.approve(coreAddress, tokenId);
            console.log('Approving Core for resale...', approveTx.hash);
            await approveTx.wait();
        }

        const tx = await this.coreContract.listResale(tokenId, price);
        console.log('Listing resale...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async buyResale(tokenOrArtworkId, priceEth) {
        this.ensureCore();
        const tokenId = await this.resolveTokenId(tokenOrArtworkId);
        const price = this.parseEth(priceEth);
        const tx = await this.coreContract.buyResale(tokenId, { value: price });
        console.log('Buying resale...', tx.hash);
        await tx.wait();
        return tx.hash;
    }

    async getAuctionBids(auctionOrArtworkId) {
        const auction = await this.getAuction(auctionOrArtworkId);
        if (!auction.highestBidder || this.isZeroAddress(auction.highestBidder)) {
            return [];
        }
        return [{
            bidder: auction.highestBidder,
            amount: auction.highestBid,
            deposit: auction.depositLocked,
            refunded: false,
            timestamp: auction.endTime
        }];
    }

    async getResaleListing(tokenOrArtworkId) {
        this.ensureCore();
        const tokenId = await this.resolveTokenId(tokenOrArtworkId);
        const listing = await this.coreContract.resaleListings(tokenId);
        return {
            tokenId: tokenId.toString(),
            seller: listing.seller,
            price: this.formatEth(listing.price),
            active: listing.active
        };
    }

    async isOwner() {
        this.ensureCore();
        const owner = await this.coreContract.owner();
        const currentAddress = await this.signer.getAddress();
        return owner.toLowerCase() === currentAddress.toLowerCase();
    }

    async getContractBalance() {
        this.ensureCore();
        const balance = await this.provider.getBalance(await this.coreContract.getAddress());
        return this.formatEth(balance);
    }

    async getPlatformFee() {
        this.ensureCore();
        const feeBps = await this.coreContract.PLATFORM_FEE_BPS();
        return Number(feeBps) / 100;
    }

    async withdrawFees() {
        throw new Error('V4.1 uses pull withdrawals. Treasury should call withdraw().');
    }

    async getProjectNFTState(userAddress) {
        this.ensureCore();
        const [eligibilityHash, minted] = await Promise.all([
            this.coreContract.projectEligibilityHash(userAddress),
            this.coreContract.projectNFTMinted(userAddress)
        ]);
        return {
            user: userAddress,
            eligibilityHash,
            eligible: eligibilityHash !== ethers.ZeroHash,
            minted
        };
    }

    async getAuctionConstants() {
        this.ensureCore();
        const [
            duration24,
            duration36,
            duration48,
            settlementWindow,
            depositBps,
            minDeposit,
            minAbsoluteIncrement,
            minIncrementBps,
            antiSnipingWindow,
            antiSnipingExtension,
            maxTotalExtension
        ] = await Promise.all([
            this.coreContract.AUCTION_DURATION_24H(),
            this.coreContract.AUCTION_DURATION_36H(),
            this.coreContract.AUCTION_DURATION_48H(),
            this.coreContract.SETTLEMENT_WINDOW(),
            this.coreContract.DEPOSIT_BPS(),
            this.coreContract.MIN_DEPOSIT(),
            this.coreContract.MIN_BID_INCREMENT_ABSOLUTE(),
            this.coreContract.MIN_BID_INCREMENT_BPS(),
            this.coreContract.ANTI_SNIPING_WINDOW(),
            this.coreContract.ANTI_SNIPING_EXTENSION(),
            this.coreContract.MAX_TOTAL_EXTENSION()
        ]);

        return {
            allowedDurations: [Number(duration24), Number(duration36), Number(duration48)],
            settlementWindow: Number(settlementWindow),
            depositPercentage: Number(depositBps) / 100,
            minDeposit: this.formatEth(minDeposit),
            minBidIncrementAbsolute: this.formatEth(minAbsoluteIncrement),
            minBidIncrementPercent: Number(minIncrementBps) / 100,
            antiSnipingWindow: Number(antiSnipingWindow),
            antiSnipingExtension: Number(antiSnipingExtension),
            maxTotalExtension: Number(maxTotalExtension)
        };
    }
}

window.ArtSoulContracts = new ArtSoulContracts();
window.ArtSoulTransactionErrors = Object.freeze({ message: formatTransactionError });

console.log('ArtSoul V4.1 contracts module loaded');
