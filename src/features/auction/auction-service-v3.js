import { ethers } from 'ethers';
import CoreMarketplaceEngine from '../../core/engine/index.js';

const MARKETPLACE_ABI = [
  "function createAuction(uint256 artworkId, uint256 startPrice, uint256 duration) external returns (uint256)",
  "function placeBid(uint256 auctionId, uint256 bidAmount) external payable",
  "function endAuction(uint256 artworkId) external",
  "function settleAuction(uint256 auctionId) external payable",
  "function claimSettlementDefault(uint256 auctionId) external",
  "function withdraw() external",
  "function artworks(uint256 artworkId) external view returns (address creator, string metadataURI, bool minted, uint256 canonicalFloor, uint256 tokenId, uint256 activeAuctionId)",
  "function auctions(uint256 auctionId) external view returns (uint256 artworkId, address creator, uint256 startPrice, uint256 duration, uint256 originalEndTime, uint256 endTime, uint256 totalExtension, uint256 highestBid, address highestBidder, uint256 depositLocked, uint256 settlementDeadline, uint8 status)",
  "function pendingWithdrawals(address user) external view returns (uint256)",
  "function minimumBid(uint256 auctionId) external view returns (uint256)",
  "function requiredDepositForBid(uint256 bidAmount) external pure returns (uint256)",
  "event AuctionCreated(uint256 indexed auctionId, uint256 indexed artworkId, address indexed creator, uint256 startPrice, uint256 duration, uint256 endTime, uint256 chainId)",
  "event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 bidAmount, uint256 depositAmount)",
  "event AuctionEnded(uint256 indexed auctionId, address indexed winner, uint256 winningBid, uint256 settlementDeadline)",
  "event SettlementCompleted(uint256 indexed auctionId, uint256 indexed artworkId, address indexed winner, uint256 finalPrice, uint256 tokenId)",
  "event SettlementDefaulted(uint256 indexed auctionId, address indexed winner, uint256 artistAmount, uint256 platformAmount)"
];

class AuctionServiceV3 {
    constructor(config) {
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.contractAddress = config.contractAddress;
        this.contract = new ethers.Contract(this.contractAddress, MARKETPLACE_ABI, this.provider);
        this.engine = new CoreMarketplaceEngine();
        this.moderationService = config.moderationService || null;
        this.cache = new Map();
        this.cacheTTL = 15000; // 15 seconds

        console.log('[AuctionService] Initialized');
        console.log('  Contract:', this.contractAddress);
        console.log('  RPC:', config.rpcUrl);
        console.log('  Engine:', 'CoreMarketplaceEngine');
        console.log('  Moderation:', this.moderationService ? 'Enabled' : 'Disabled');
    }

    async getAuctionView(artworkId) {
        const cacheKey = `view_${artworkId}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            const [auctionRaw, bidsRaw, visibilityData] = await Promise.all([
                this._getAuctionByArtwork(artworkId),
                Promise.resolve([]),
                this.moderationService
                    ? this.moderationService.getArtworkVisibility(artworkId)
                    : Promise.resolve({ hidden: false, featured: false, curated: false })
            ]);

            const contractData = this._parseAuctionData(auctionRaw, artworkId);
            const bids = this._parseBids(bidsRaw);

            const artworkData = {
                id: artworkId.toString(),
                floorPrice: contractData.startingPrice,
                sold: contractData.settled,
                listed: contractData.status === 'active' || contractData.status === 'settlement_pending',
                hidden: visibilityData.hidden,
                featured: visibilityData.featured,
                curated: visibilityData.curated
            };

            const auctionData = {
                startTime: contractData.startTime * 1000,
                endTime: contractData.endTime * 1000,
                highestBidder: contractData.highestBidder,
                highestBid: contractData.highestBid,
                sold: contractData.settled,
                finalized: contractData.ended,
                bids: bids.map(bid => ({
                    bidder: bid.bidder,
                    amount: bid.amount,
                    timestamp: bid.timestamp * 1000
                }))
            };

            const engineState = this.engine.getArtworkState(
                artworkData,
                auctionData,
                null,
                null,
                Date.now()
            );

            const engineCapabilities = {
                extensionWorking: this.engine.auctionEngine.canCalculateExtensions(auctionData),
                settlementWindowWorking: contractData.status === 'settlement_pending',
                pullWithdrawalsWorking: true,
                realBidHistory: bids.length > 0
            };

            const result = {
                artworkId: artworkId.toString(),
                contract: contractData,
                bids: bids,
                engine: {
                    state: engineState.state,
                    metadata: engineState.metadata,
                    visibility: engineState.visibility
                },
                moderation: visibilityData,
                capabilities: engineCapabilities,
                timestamp: Date.now()
            };

            this._setCache(cacheKey, result);
            return result;

        } catch (error) {
            console.error('[AuctionService] getAuctionView failed:', error);
            throw error;
        }
    }

    async createAuction(signer, artworkId, startingPrice, duration) {
        await this._ensureBaseSepoliaWrite();
        const contractWithSigner = this.contract.connect(signer);
        const tx = await contractWithSigner.createAuction(artworkId, startingPrice, duration);
        await tx.wait();
        this._invalidateCache(`view_${artworkId}`);
        return tx;
    }

    async placeBid(signer, artworkId, bidAmount) {
        await this._ensureBaseSepoliaWrite();
        const contractWithSigner = this.contract.connect(signer);
        const auction = await this._getAuctionByArtwork(artworkId);
        const deposit = await contractWithSigner.requiredDepositForBid(bidAmount);
        const tx = await contractWithSigner.placeBid(auction.auctionId, bidAmount, { value: deposit });
        await tx.wait();
        this._invalidateCache(`view_${artworkId}`);
        return tx;
    }

    async endAuction(signer, artworkId) {
        await this._ensureBaseSepoliaWrite();
        const contractWithSigner = this.contract.connect(signer);
        const auction = await this._getAuctionByArtwork(artworkId);
        const tx = await contractWithSigner.endAuction(auction.auctionId);
        await tx.wait();
        this._invalidateCache(`view_${artworkId}`);
        return tx;
    }

    async settleAuction(signer, artworkId) {
        await this._ensureBaseSepoliaWrite();
        const contractWithSigner = this.contract.connect(signer);
        const auction = await this._getAuctionByArtwork(artworkId);
        const remaining = auction.raw.highestBid > auction.raw.depositLocked
            ? auction.raw.highestBid - auction.raw.depositLocked
            : 0n;
        const tx = await contractWithSigner.settleAuction(auction.auctionId, { value: remaining });
        await tx.wait();
        this._invalidateCache(`view_${artworkId}`);
        return tx;
    }

    async withdraw(signer) {
        await this._ensureBaseSepoliaWrite();
        const contractWithSigner = this.contract.connect(signer);
        const tx = await contractWithSigner.withdraw();
        await tx.wait();
        return tx;
    }

    async getPendingWithdrawal(address) {
        return await this.contract.pendingWithdrawals(address);
    }

    async _ensureBaseSepoliaWrite() {
        if (typeof window.ensureArtSoulWriteNetwork !== 'function') {
            throw new Error('This action requires Base Sepolia.');
        }
        await window.ensureArtSoulWriteNetwork();
    }

    async _getAuctionByArtwork(artworkId) {
        const artwork = await this.contract.artworks(artworkId);
        if (!artwork.activeAuctionId || artwork.activeAuctionId === 0n) {
            throw new Error('No active auction for artwork');
        }
        const raw = await this.contract.auctions(artwork.activeAuctionId);
        const parsed = this._parseAuctionData(raw, artwork.activeAuctionId);
        parsed.artwork = artwork;
        parsed.raw = raw;
        return parsed;
    }

    _parseAuctionData(raw, auctionId) {
        const statusNames = ['none', 'active', 'settlement_pending', 'settled', 'defaulted'];
        return {
            auctionId: auctionId.toString(),
            artworkId: raw.artworkId.toString(),
            creator: raw.creator,
            startingPrice: raw.startPrice,
            startTime: Number(raw.originalEndTime - raw.duration),
            endTime: Number(raw.endTime),
            winnerDeadline: Number(raw.settlementDeadline),
            ended: Number(raw.status) !== 1,
            settled: Number(raw.status) === 3,
            defaulted: Number(raw.status) === 4,
            status: statusNames[Number(raw.status)] || 'unknown',
            highestBidder: raw.highestBidder,
            highestBid: raw.highestBid
        };
    }

    _parseBids(raw) {
        return raw.map(bid => ({
            bidder: bid.bidder,
            amount: bid.amount,
            timestamp: Number(bid.timestamp)
        }));
    }

    _getCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;

        if (Date.now() > cached.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    _setCache(key, data) {
        this.cache.set(key, {
            data: data,
            expiresAt: Date.now() + this.cacheTTL
        });
    }

    _invalidateCache(key) {
        this.cache.delete(key);
    }
}

export default AuctionServiceV3;

if (typeof window !== 'undefined') {
    window.AuctionServiceV3 = AuctionServiceV3;
}
