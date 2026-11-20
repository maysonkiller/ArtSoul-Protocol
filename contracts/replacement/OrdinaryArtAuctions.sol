// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SettledArtworkNFT} from "./SettledArtworkNFT.sol";
import {MarketplaceAdmissions} from "./MarketplaceAdmissions.sol";
import {OutbidRefunds} from "./OutbidRefunds.sol";

/// @dev Primary auctions for a fresh, immutable engine/NFT pair.
abstract contract OrdinaryArtAuctions is Pausable, OutbidRefunds, MarketplaceAdmissions {
    enum State { None, Open, Payment, NoBids, Settled, Defaulted, RunnerUpOffer }
    enum DueAction { None, Close, FinalizeDefault, ExpireRunnerUpOffer }
    struct Work {
        address creator;
        string metadataURI;
        uint256 activeAuction;
        uint256 floor;
    }
    struct Auction {
        uint256 artworkId;
        uint256 startPrice;
        uint256 originalEnd;
        uint256 end;
        uint256 deadline;
        address highestBidder;
        uint256 price;
        uint256 deposit;
        State state;
        address firstCollector;
    }
    struct RunnerUpOffer {
        address bidder;
        uint256 price;
        uint256 deadline;
    }

    SettledArtworkNFT public immutable nft;
    uint256 public constant MAX_METADATA_URI_BYTES = 2048;
    uint256 public constant ANTI_SNIPING_WINDOW = 10 minutes;
    uint256 public constant ANTI_SNIPING_EXTENSION = 10 minutes;
    uint256 public constant MAX_TOTAL_EXTENSION = 1 hours;
    uint256 public workCount;
    uint256 public auctionCount;
    mapping(uint256 => Work) public works;
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => RunnerUpOffer) public runnerUpOffers;

    error InvalidWork();
    error InvalidTerms();
    error WrongAuctionState();
    error NotEligibleBidder();
    error BidBelowMinimum(uint256 minimum);
    error IncorrectFunding(uint256 required);
    error NotWinner();
    error NotRunnerUp();
    error InvalidTreasury();

    event ArtworkRegistered(uint256 indexed artworkId, address indexed creator, string metadataURI);
    event AuctionOpened(uint256 indexed auctionId, uint256 indexed artworkId, uint256 startPrice, uint256 end);
    event BidAccepted(uint256 indexed auctionId, address indexed bidder, uint256 price, uint256 deposit);
    event AuctionExtended(uint256 indexed auctionId, uint256 oldEnd, uint256 newEnd);
    event AuctionClosed(uint256 indexed auctionId, address indexed winner, uint256 deadline);
    event AuctionSettled(uint256 indexed auctionId, uint256 indexed artworkId, uint256 tokenId, uint256 price);
    event AuctionDefaulted(uint256 indexed auctionId, address indexed winner, uint256 deposit);
    event RunnerUpOfferOpened(uint256 indexed auctionId, address indexed bidder, uint256 price, uint256 deadline);
    event RunnerUpOfferAccepted(uint256 indexed auctionId, address indexed bidder, uint256 price);
    event RunnerUpOfferDeclined(uint256 indexed auctionId, address indexed bidder);
    event RunnerUpOfferExpired(uint256 indexed auctionId, address indexed bidder);
    event WinnerSurplusCredited(uint256 indexed auctionId, address indexed winner, uint256 amount);
    event ProceedsCredited(uint256 indexed auctionId, address indexed creator, address indexed treasury, uint256 creatorAmount, uint256 protocolAmount);

    constructor(uint256 batchLimit, uint256 transferGas) OutbidRefunds(batchLimit, transferGas) {
        nft = new SettledArtworkNFT();
    }

    function registerArtwork(string calldata uri) external whenNotPaused nonReentrant returns (uint256 id) {
        if (bytes(uri).length == 0 || bytes(uri).length > MAX_METADATA_URI_BYTES) revert InvalidWork();
        id = ++workCount;
        works[id] = Work(msg.sender, uri, 0, 0);
        emit ArtworkRegistered(id, msg.sender, uri);
    }

    function createAuction(uint256 artworkId, uint256 startPrice, uint256 duration)
        external whenNotPaused nonReentrant returns (uint256 id)
    {
        Work storage work = works[artworkId];
        if (work.creator != msg.sender || work.floor != 0) revert InvalidWork();
        if (startPrice == 0 || (duration != 24 hours && duration != 36 hours && duration != 48 hours)) revert InvalidTerms();
        uint256 previous = work.activeAuction;
        if (previous != 0) {
            if (auctions[previous].highestBidder == address(0)) _closeAuction(previous);
            else _expireRunnerUpOffer(previous);
        }
        id = ++auctionCount;
        uint256 end = block.timestamp + duration;
        auctions[id] = Auction(artworkId, startPrice, end, end, 0, address(0), 0, 0, State.Open, address(0));
        work.activeAuction = id;
        emit AuctionOpened(id, artworkId, startPrice, end);
    }

    function requiredDepositForBid(uint256 price) public pure returns (uint256) {
        return Math.max(0.01 ether, Math.ceilDiv(price, 10));
    }

    /// @notice Zero once a bidless round or runner-up offer expires, even before a closing transaction.
    function currentAuctionForWork(uint256 artworkId) external view returns (uint256) {
        uint256 id = works[artworkId].activeAuction;
        if (id == 0) return 0;
        Auction storage auction = auctions[id];
        if (auction.highestBidder == address(0) && block.timestamp >= auction.end) return 0;
        if (dueAuctionAction(id) == DueAction.ExpireRunnerUpOffer) return 0;
        return id;
    }

    /// @notice The permissionless lifecycle action due for this auction in the current block.
    function dueAuctionAction(uint256 id) public view returns (DueAction) {
        Auction storage auction = auctions[id];
        if (auction.state == State.Open && block.timestamp >= auction.end) return DueAction.Close;
        if (auction.state == State.Payment && block.timestamp > auction.deadline) return DueAction.FinalizeDefault;
        if (auction.state == State.RunnerUpOffer && block.timestamp > runnerUpOffers[id].deadline) {
            return DueAction.ExpireRunnerUpOffer;
        }
        return DueAction.None;
    }

    function minimumBid(uint256 id) public view returns (uint256) {
        Auction storage auction = auctions[id];
        if (auction.state != State.Open || block.timestamp >= auction.end) revert WrongAuctionState();
        if (auction.price == 0) return auction.startPrice;
        return auction.price + Math.max(0.01 ether, Math.ceilDiv(auction.price, 40));
    }

    function placeBid(uint256 id, uint256 price) external payable whenNotPaused nonReentrant {
        Auction storage auction = auctions[id];
        uint256 minimum = minimumBid(id);
        if (msg.sender == works[auction.artworkId].creator || msg.sender == auction.highestBidder) revert NotEligibleBidder();
        if (price < minimum) revert BidBelowMinimum(minimum);
        uint256 required = requiredDepositForBid(price);
        if (msg.value != required) revert IncorrectFunding(required);
        if (auction.highestBidder != address(0)) {
            // Bids strictly increase and the current leader cannot outbid themselves.
            RunnerUpOffer storage offer = runnerUpOffers[id];
            offer.bidder = auction.highestBidder;
            offer.price = auction.price;
            _queueOutbidRefund(id, auction.highestBidder, auction.deposit);
        }
        auction.highestBidder = msg.sender;
        auction.price = price;
        auction.deposit = required;
        emit BidAccepted(id, msg.sender, price, required);
        uint256 end = auction.end;
        if (end - block.timestamp <= ANTI_SNIPING_WINDOW) {
            uint256 nextEnd = Math.min(end + ANTI_SNIPING_EXTENSION, auction.originalEnd + MAX_TOTAL_EXTENSION);
            if (nextEnd > end) {
                auction.end = nextEnd;
                emit AuctionExtended(id, end, nextEnd);
            }
        }
    }

    function closeAuction(uint256 id) external nonReentrant { _closeAuction(id); }

    function _closeAuction(uint256 id) private {
        Auction storage auction = auctions[id];
        if (dueAuctionAction(id) != DueAction.Close) revert WrongAuctionState();
        if (auction.highestBidder == address(0)) {
            auction.state = State.NoBids;
            works[auction.artworkId].activeAuction = 0;
        } else {
            auction.state = State.Payment;
            auction.deadline = block.timestamp + 24 hours;
        }
        emit AuctionClosed(id, auction.highestBidder, auction.deadline);
    }

    function settleAuction(uint256 id) external payable nonReentrant returns (uint256 tokenId) {
        Auction storage auction = auctions[id];
        // A ready winner can close and pay in one transaction, including during an entry pause.
        if (auction.state == State.Open && msg.sender == auction.highestBidder) _closeAuction(id);
        if (auction.state != State.Payment || block.timestamp > auction.deadline) revert WrongAuctionState();
        if (msg.sender != auction.highestBidder) revert NotWinner();
        uint256 applied = Math.min(auction.price, auction.deposit);
        uint256 payment = auction.price - applied;
        if (msg.value != payment) revert IncorrectFunding(payment);
        uint256 surplus = auction.deposit - applied;
        if (surplus != 0) {
            credits[msg.sender] += surplus;
            emit WinnerSurplusCredited(id, msg.sender, surplus);
        }
        auction.deposit = 0;
        return _settle(id, auction.price);
    }

    function _settle(uint256 id, uint256 salePrice) private returns (uint256 tokenId) {
        Auction storage auction = auctions[id];
        auction.state = State.Settled;
        auction.firstCollector = msg.sender;
        Work storage work = works[auction.artworkId];
        work.activeAuction = 0;
        work.floor = salePrice;
        _creditProceeds(id, work.creator, salePrice, 40);
        tokenId = nft.mintSettled(id);
        emit AuctionSettled(id, auction.artworkId, tokenId, salePrice);
    }

    function finalizeDefault(uint256 id) external nonReentrant {
        Auction storage auction = auctions[id];
        if (dueAuctionAction(id) != DueAction.FinalizeDefault) revert WrongAuctionState();
        uint256 deposit = auction.deposit;
        auction.deposit = 0;
        Work storage work = works[auction.artworkId];
        RunnerUpOffer storage offer = runnerUpOffers[id];
        if (offer.bidder == address(0)) {
            auction.state = State.Defaulted;
            work.activeAuction = 0;
        } else {
            auction.state = State.RunnerUpOffer;
            offer.deadline = block.timestamp + 24 hours;
        }
        _creditProceeds(id, work.creator, deposit, 5);
        emit AuctionDefaulted(id, auction.highestBidder, deposit);
        if (offer.bidder != address(0)) emit RunnerUpOfferOpened(id, offer.bidder, offer.price, offer.deadline);
    }

    function acceptRunnerUpOffer(uint256 id) external payable nonReentrant returns (uint256 tokenId) {
        RunnerUpOffer storage offer = _liveOfferForCaller(id);
        if (msg.value != offer.price) revert IncorrectFunding(offer.price);
        emit RunnerUpOfferAccepted(id, msg.sender, offer.price);
        return _settle(id, offer.price);
    }

    function declineRunnerUpOffer(uint256 id) external nonReentrant {
        _liveOfferForCaller(id);
        _releaseAfterOffer(id);
        emit RunnerUpOfferDeclined(id, msg.sender);
    }

    function _liveOfferForCaller(uint256 id) private view returns (RunnerUpOffer storage offer) {
        offer = runnerUpOffers[id];
        if (auctions[id].state != State.RunnerUpOffer || block.timestamp > offer.deadline) revert WrongAuctionState();
        if (msg.sender != offer.bidder) revert NotRunnerUp();
    }

    function expireRunnerUpOffer(uint256 id) external nonReentrant { _expireRunnerUpOffer(id); }

    function _expireRunnerUpOffer(uint256 id) private {
        if (dueAuctionAction(id) != DueAction.ExpireRunnerUpOffer) revert WrongAuctionState();
        _releaseAfterOffer(id);
        emit RunnerUpOfferExpired(id, runnerUpOffers[id].bidder);
    }

    function _releaseAfterOffer(uint256 id) private {
        Auction storage auction = auctions[id];
        auction.state = State.Defaulted;
        works[auction.artworkId].activeAuction = 0;
    }

    // With two recipients the creator receives the complement, including an exact half-wei tie.
    function _protocolShare(uint256 amount, uint256 denominator) internal pure returns (uint256) {
        uint256 quota = amount / denominator;
        return amount % denominator > denominator / 2 ? quota + 1 : quota;
    }

    function _creditProceeds(uint256 id, address creator, uint256 amount, uint256 denominator) private {
        address treasury = _protocolRecipient();
        if (treasury == address(0)) revert InvalidTreasury();
        uint256 share = _protocolShare(amount, denominator);
        credits[creator] += amount - share;
        credits[treasury] += share;
        emit ProceedsCredited(id, creator, treasury, amount - share, share);
    }

    function nftSettlement(uint256 id) external view returns (Record memory) {
        Auction storage auction = auctions[id];
        Work storage work = works[auction.artworkId];
        return Record(auction.state == State.Settled, auction.artworkId, work.creator, auction.firstCollector, work.metadataURI);
    }

    function _refundsOpen(uint256 id) internal view override returns (bool) {
        State state = auctions[id].state;
        return state == State.Payment || state == State.Settled || state == State.Defaulted
            || state == State.NoBids || state == State.RunnerUpOffer;
    }

    function _protocolRecipient() internal view virtual returns (address);
}
