/**
 * Auction Engine - V4.1 off-chain state helper
 *
 * Contract truth remains ArtSoulCore. This helper only mirrors the V4.1
 * lifecycle for local UI/database state:
 * active auction -> settlement pending -> settled/defaulted.
 */

class AuctionEngineFinal {
    constructor() {
        const hour = 60 * 60 * 1000;
        const minute = 60 * 1000;

        this.config = {
            allowedDurations: [24 * hour, 36 * hour, 48 * hour],
            defaultDuration: 24 * hour,
            finalStageWindow: 10 * minute,
            claimWindow: 24 * hour,
            depositPercent: 0.10
        };

        this.STATES = {
            MINTED: 'MINTED',
            PRIMARY_ACTIVE: 'PRIMARY_ACTIVE',
            PRIMARY_ENDED: 'PRIMARY_ENDED',
            WAITING_PAYMENT: 'WAITING_PAYMENT',
            SETTLEMENT_DEFAULTED: 'SETTLEMENT_DEFAULTED',
            SOLD: 'SOLD',
            LOCKED_SECONDARY: 'LOCKED_SECONDARY',
            SECONDARY_ACTIVE: 'SECONDARY_ACTIVE',

            // Legacy aliases accepted for old cached rows.
            ACTIVE: 'active',
            FINAL_STAGE: 'final_stage',
            ENDED: 'ended',
            SETTLED: 'settled',
            EXPIRED: 'expired'
        };

        console.log('AuctionEngineFinal initialized for V4.1');
    }

    initAI() {
        // V4.1 does not route failed settlement into AI/discovery auctions.
        return null;
    }

    normalizeDuration(duration) {
        const numericDuration = Number(duration || this.config.defaultDuration);
        return this.config.allowedDurations.includes(numericDuration)
            ? numericDuration
            : this.config.defaultDuration;
    }

    transition(auction, newState, reason = '') {
        const oldState = auction.state;
        const validTransitions = {
            [this.STATES.MINTED]: [this.STATES.PRIMARY_ACTIVE],
            [this.STATES.PRIMARY_ACTIVE]: [this.STATES.PRIMARY_ENDED],
            [this.STATES.PRIMARY_ENDED]: [this.STATES.WAITING_PAYMENT, this.STATES.SETTLEMENT_DEFAULTED],
            [this.STATES.WAITING_PAYMENT]: [this.STATES.SOLD, this.STATES.SETTLEMENT_DEFAULTED],
            [this.STATES.SETTLEMENT_DEFAULTED]: [this.STATES.PRIMARY_ACTIVE],
            [this.STATES.SOLD]: [this.STATES.LOCKED_SECONDARY],
            [this.STATES.LOCKED_SECONDARY]: [this.STATES.SECONDARY_ACTIVE],
            [this.STATES.SECONDARY_ACTIVE]: [this.STATES.SOLD]
        };

        const allowed = validTransitions[oldState];
        if (allowed && !allowed.includes(newState)) {
            console.warn(`Invalid transition: ${oldState} -> ${newState}`);
            return false;
        }

        auction.state = newState;
        console.log(`State transition: ${oldState} -> ${newState}${reason ? ` (${reason})` : ''}`);
        this.emit('auction:state_changed', { auction, oldState, newState, reason });
        return true;
    }

    async createAuction({ artworkId, startingPrice, duration }) {
        const durationMs = this.normalizeDuration(duration);
        const now = Date.now();

        const auction = {
            id: artworkId,
            seller: window.ArtSoulApp?.wallet || null,
            startingPrice,
            startTime: now,
            endTime: now + durationMs,
            ended: false,
            settled: false,
            highestBidder: null,
            highestBid: 0,
            state: this.STATES.PRIMARY_ACTIVE,
            auctionType: 'primary',
            winnerDeadline: null,
            canonicalFloor: 0,
            depositAmount: 0,
            depositForfeited: false
        };

        if (window.ArtSoulDB) {
            await window.ArtSoulDB.createAuction({
                artwork_id: artworkId,
                starting_price: startingPrice,
                start_time: new Date(now).toISOString(),
                end_time: new Date(auction.endTime).toISOString(),
                auction_type: 'primary',
                ai_triggered: false,
                network: 'base-sepolia'
            });
        }

        this.setupTimer(auction);
        console.log('Auction created:', artworkId);
        this.emit('auction:created', auction);

        return auction;
    }

    async placeBid({ auctionId, bidder, amount }) {
        console.log('Placing bid:', { auctionId, amount });

        const auction = await this.getAuction(auctionId);
        if (!this.isActive(auction)) {
            throw new Error('Auction not active');
        }

        if (bidder.toLowerCase() === auction.seller?.toLowerCase()) {
            throw new Error('Seller cannot bid');
        }

        if (bidder.toLowerCase() === auction.highestBidder?.toLowerCase()) {
            throw new Error('Bidder cannot self-outbid');
        }

        const minBid = this.getMinimumBid(auction);
        if (Number(amount) < minBid) {
            throw new Error('Bid too low');
        }

        const previousBidder = auction.highestBidder;
        const previousDeposit = auction.depositAmount || 0;
        const depositAmount = this.getRequiredDeposit(amount);

        auction.highestBidder = bidder.toLowerCase();
        auction.highestBid = amount;
        auction.depositAmount = depositAmount;

        this.applyAntiSnipingExtension(auction);

        if (window.ArtSoulDB) {
            await window.ArtSoulDB.updateAuction(auctionId, {
                highest_bid: amount,
                highest_bidder: bidder.toLowerCase(),
                deposit_amount: depositAmount,
                end_time: new Date(auction.endTime).toISOString()
            });
        }

        if (previousBidder && previousDeposit > 0) {
            this.emit('bid:deposit_withdrawable', {
                auction,
                bidder: previousBidder,
                amount: previousDeposit
            });
        }

        console.log('Bid placed');
        this.emit('auction:bid', { auction, bidder, amount, depositAmount });

        return auction;
    }

    getRequiredDeposit(bidAmount) {
        const deposit = Number(bidAmount) * this.config.depositPercent;
        return Math.max(deposit, 0.01);
    }

    getMinimumBid(auction) {
        if (!auction.highestBid || Number(auction.highestBid) <= 0) {
            return Number(auction.startingPrice || 0);
        }

        const highest = Number(auction.highestBid);
        return Math.max(highest + 0.01, highest * 1.025);
    }

    applyAntiSnipingExtension(auction) {
        const timeLeft = auction.endTime - Date.now();
        if (timeLeft <= this.config.finalStageWindow && timeLeft > 0) {
            auction.endTime += this.config.finalStageWindow;
            this.emit('auction:extended', {
                auction,
                newEndTime: auction.endTime,
                extension: this.config.finalStageWindow
            });
        }
    }

    async endAuction(auction) {
        console.log('Ending auction:', auction.id);

        if (!this.canBeEnded(auction)) {
            throw new Error('Cannot end auction yet');
        }

        auction.ended = true;
        this.transition(auction, this.STATES.PRIMARY_ENDED, 'auction time expired');

        if (window.ArtSoulDB) {
            await window.ArtSoulDB.updateAuction(auction.id, {
                ended: true
            });
        }

        this.emit('auction:ended', { auction, winner: auction.highestBidder });

        if (auction.highestBidder) {
            await this.startSettlementWindow(auction);
        } else {
            await this.markSettlementDefault(auction, 'auction ended without bids');
        }
    }

    async startSettlementWindow(auction) {
        console.log('Starting 24h settlement window for:', auction.highestBidder);

        const now = Date.now();
        auction.winnerDeadline = now + this.config.claimWindow;

        this.transition(auction, this.STATES.WAITING_PAYMENT, '24h settlement window started');

        if (window.ArtSoulDB) {
            await window.ArtSoulDB.updateAuction(auction.id, {
                winner_deadline: new Date(auction.winnerDeadline).toISOString(),
                settlement_deadline: new Date(auction.winnerDeadline).toISOString(),
                status: 'settlement_pending'
            });
        }

        this.emit('auction:settlement_window_started', {
            auction,
            winner: auction.highestBidder,
            deadline: auction.winnerDeadline
        });

        this.setupSettlementTimer(auction);
    }

    setupSettlementTimer(auction) {
        const checkInterval = 10000;

        const timer = setInterval(async () => {
            const now = Date.now();

            if (now >= auction.winnerDeadline && auction.state === this.STATES.WAITING_PAYMENT) {
                clearInterval(timer);
                console.log('Settlement deadline expired for:', auction.id);
                await this.markSettlementDefault(auction, 'settlement deadline expired');
            }
        }, checkInterval);
    }

    async markSettlementDefault(auction, reason = 'settlement default') {
        auction.depositForfeited = Number(auction.depositAmount || 0) > 0;
        this.transition(auction, this.STATES.SETTLEMENT_DEFAULTED, reason);

        if (window.ArtSoulDB) {
            await window.ArtSoulDB.updateAuction(auction.id, {
                status: 'settlement_defaulted',
                settlement_defaulted: true
            });
            await window.ArtSoulDB.updateArtwork(auction.id, {
                status: 'draft',
                active_auction_id: null
            });
        }

        this.emit('auction:settlement_defaulted', { auction, reason });
        return auction;
    }

    async completeSettlement(auction, payer) {
        console.log('Processing settlement from:', payer);

        if (auction.state !== this.STATES.WAITING_PAYMENT) {
            throw new Error('Not in settlement window');
        }

        if (payer.toLowerCase() !== auction.highestBidder?.toLowerCase()) {
            throw new Error('Only winner can settle');
        }

        if (Date.now() > auction.winnerDeadline) {
            throw new Error('Settlement deadline expired');
        }

        await this.settle(auction);
        return auction;
    }

    async settle(auction) {
        console.log('Settling auction:', auction.id);

        if (auction.settled) {
            throw new Error('Already settled');
        }

        auction.settled = true;
        auction.canonicalFloor = auction.highestBid;
        this.transition(auction, this.STATES.SOLD, 'settlement completed');

        const distribution = await this.distributeRevenue(auction);
        await this.recordLazyMint(auction);

        if (window.ArtSoulDB) {
            await window.ArtSoulDB.updateArtwork(auction.id, {
                status: 'sold',
                minted: true,
                current_owner_address: auction.highestBidder,
                auction_winner_address: auction.highestBidder,
                sale_price: auction.highestBid,
                floor_price: auction.highestBid,
                canonical_floor: auction.highestBid
            });
        }

        console.log('Auction settled');
        this.emit('auction:settlement_completed', { auction, distribution });

        return auction;
    }

    async distributeRevenue(auction) {
        const total = Number(auction.highestBid || 0);
        const distribution = {
            creator: total * 0.975,
            platform: total * 0.025
        };

        this.emit('revenue:distributed', { auction, distribution });
        return distribution;
    }

    async recordLazyMint(auction) {
        this.emit('nft:minted', {
            artworkId: auction.id,
            to: auction.highestBidder,
            canonicalFloor: auction.canonicalFloor
        });
    }

    async refundBidder(bidder, amount) {
        this.emit('bid:deposit_withdrawable', { bidder, amount });
    }

    isActive(auction) {
        const now = Date.now();
        const activeStates = [
            this.STATES.PRIMARY_ACTIVE,
            this.STATES.SECONDARY_ACTIVE,
            this.STATES.ACTIVE,
            this.STATES.FINAL_STAGE
        ];

        return now >= auction.startTime &&
            now < auction.endTime &&
            !auction.ended &&
            activeStates.includes(auction.state);
    }

    canBeEnded(auction) {
        return Date.now() >= auction.endTime && !auction.ended;
    }

    setupTimer(auction) {
        const checkInterval = 10000;

        const timer = setInterval(() => {
            const timeLeft = auction.endTime - Date.now();
            if (timeLeft <= this.config.finalStageWindow &&
                timeLeft > 0 &&
                auction.state === this.STATES.PRIMARY_ACTIVE) {
                this.emit('auction:final_stage', auction);
            }

            if (this.canBeEnded(auction)) {
                clearInterval(timer);
                this.endAuction(auction);
            }
        }, checkInterval);
    }

    async getAuction(auctionId) {
        if (window.ArtSoulDB) {
            return await window.ArtSoulDB.getAuction(auctionId);
        }
        throw new Error('Database not available');
    }

    getStateInfo(auction) {
        const now = Date.now();
        const timeLeft = Math.max(0, auction.endTime - now);
        const settlementTimeLeft = auction.winnerDeadline ? Math.max(0, auction.winnerDeadline - now) : 0;

        return {
            state: auction.state,
            timeLeft,
            settlementTimeLeft,
            isFinalStage: timeLeft <= this.config.finalStageWindow && timeLeft > 0,
            isActive: this.isActive(auction),
            isEnded: auction.ended,
            isSettled: auction.settled,
            canBid: this.isActive(auction),
            inSettlementWindow: auction.state === this.STATES.WAITING_PAYMENT,
            settlementDeadline: auction.winnerDeadline
        };
    }

    emit(eventName, data) {
        const event = new CustomEvent(eventName, { detail: data });
        window.dispatchEvent(event);
    }
}

window.AuctionEngineFinal = AuctionEngineFinal;

console.log('AuctionEngineFinal module loaded');
