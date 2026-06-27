// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/IArtSoulNFT.sol";
import "./interfaces/IArtSoulProjectNFT.sol";

contract ArtSoulCore is Ownable2Step, Pausable, ReentrancyGuard {
    enum AuctionStatus {
        None,
        Active,
        SettlementPending,
        Settled,
        Defaulted
    }

    struct Artwork {
        address creator;
        string metadataURI;
        bool minted;
        uint256 canonicalFloor;
        uint256 tokenId;
        uint256 activeAuctionId;
    }

    struct Auction {
        uint256 artworkId;
        address creator;
        uint256 startPrice;
        uint256 duration;
        uint256 originalEndTime;
        uint256 endTime;
        uint256 totalExtension;
        uint256 highestBid;
        address highestBidder;
        uint256 depositLocked;
        uint256 settlementDeadline;
        AuctionStatus status;
    }

    struct ResaleListing {
        address seller;
        uint256 price;
        bool active;
    }

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant DEPOSIT_BPS = 1_000; // 10%
    uint256 public constant PLATFORM_FEE_BPS = 250; // 2.5%
    uint256 public constant ARTIST_ROYALTY_BPS = 750; // 7.5%
    uint256 public constant DEFAULT_ARTIST_BPS = 8_000; // 80%
    uint256 public constant DEFAULT_PLATFORM_BPS = 2_000; // 20%

    uint256 public constant MIN_DEPOSIT = 0.01 ether;
    uint256 public constant MIN_BID_INCREMENT_ABSOLUTE = 0.01 ether;
    uint256 public constant MIN_BID_INCREMENT_BPS = 250; // 2.5%

    uint256 public constant AUCTION_DURATION_24H = 24 hours;
    uint256 public constant AUCTION_DURATION_36H = 36 hours;
    uint256 public constant AUCTION_DURATION_48H = 48 hours;

    uint256 public constant SETTLEMENT_WINDOW = 24 hours;
    uint256 public constant ANTI_SNIPING_WINDOW = 10 minutes;
    uint256 public constant ANTI_SNIPING_EXTENSION = 10 minutes;
    uint256 public constant MAX_TOTAL_EXTENSION = 60 minutes;

    address public treasury;
    IArtSoulNFT public immutable nftContract;
    IArtSoulProjectNFT public immutable projectNFT;

    uint256 public artworkCounter;
    uint256 public auctionCounter;
    uint256 public successfulSettlements;

    mapping(uint256 => Artwork) public artworks;
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => uint256) public tokenToArtwork;
    mapping(uint256 => ResaleListing) public resaleListings;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => bytes32) public projectEligibilityHash;
    mapping(address => bool) public projectNFTMinted;

    error InvalidAddress();
    error EmptyMetadataURI();
    error ArtworkNotFound();
    error AuctionNotFound();
    error NotArtworkCreator();
    error ArtworkAlreadyMinted();
    error InvalidAuctionDuration();
    error InvalidPrice();
    error ActiveAuctionExists();
    error AuctionNotActive();
    error AuctionNotEnded();
    error AuctionAlreadyFinalized();
    error AuctionHasNoWinner();
    error SettlementStillActive();
    error SettlementExpired();
    error NotAuctionWinner();
    error CreatorCannotBid();
    error BidderCannotSelfOutbid();
    error BidTooLow(uint256 requiredBid);
    error IncorrectDeposit(uint256 requiredDeposit);
    error IncorrectSettlementPayment(uint256 requiredPayment);
    error NothingToWithdraw();
    error TransferFailed();
    error ResaleUnavailable();
    error NotTokenOwner();
    error PriceBelowCanonicalFloor(uint256 canonicalFloor);
    error CoreNotApprovedForTransfer();
    error InvalidEligibility();
    error ProjectNFTAlreadyMinted();

    event ArtworkRegistered(
        uint256 indexed artworkId,
        address indexed creator,
        string metadataURI
    );

    event AuctionCreated(
        uint256 indexed auctionId,
        uint256 indexed artworkId,
        address indexed creator,
        uint256 startPrice,
        uint256 duration,
        uint256 endTime,
        uint256 chainId
    );

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 bidAmount,
        uint256 depositAmount
    );

    event BidDepositWithdrawn(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount
    );

    event AuctionExtended(
        uint256 indexed auctionId,
        uint256 oldEndTime,
        uint256 newEndTime
    );

    event AuctionEnded(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 winningBid,
        uint256 settlementDeadline
    );

    event SettlementCompleted(
        uint256 indexed auctionId,
        uint256 indexed artworkId,
        address indexed winner,
        uint256 finalPrice,
        uint256 tokenId
    );

    event SettlementDefaulted(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 artistAmount,
        uint256 platformAmount
    );

    event CanonicalFloorUpdated(
        uint256 indexed artworkId,
        uint256 indexed tokenId,
        uint256 floorPrice
    );

    event ResaleListed(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price
    );

    event ResaleCompleted(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 royaltyAmount,
        uint256 platformFee
    );

    event ProjectNFTEligibilityAchieved(
        address indexed user,
        bytes32 eligibilityHash
    );

    event ProjectNFTMinted(
        address indexed user,
        uint256 indexed tokenId,
        bytes32 eligibilityHash
    );

    constructor(
        address nftContract_,
        address projectNFT_,
        address treasury_
    ) Ownable(msg.sender) {
        if (
            nftContract_ == address(0) ||
            projectNFT_ == address(0) ||
            treasury_ == address(0)
        ) {
            revert InvalidAddress();
        }

        nftContract = IArtSoulNFT(nftContract_);
        projectNFT = IArtSoulProjectNFT(projectNFT_);
        treasury = treasury_;
    }

    function registerArtwork(
        string calldata metadataURI
    ) external whenNotPaused returns (uint256 artworkId) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadataURI();

        artworkId = ++artworkCounter;

        artworks[artworkId] = Artwork({
            creator: msg.sender,
            metadataURI: metadataURI,
            minted: false,
            canonicalFloor: 0,
            tokenId: 0,
            activeAuctionId: 0
        });

        emit ArtworkRegistered(artworkId, msg.sender, metadataURI);
    }

    function createAuction(
        uint256 artworkId,
        uint256 startPrice,
        uint256 duration
    ) external whenNotPaused returns (uint256 auctionId) {
        Artwork storage artwork = artworks[artworkId];

        if (artwork.creator == address(0)) revert ArtworkNotFound();
        if (artwork.creator != msg.sender) revert NotArtworkCreator();
        if (artwork.minted) revert ArtworkAlreadyMinted();
        if (!_isAllowedDuration(duration)) revert InvalidAuctionDuration();
        if (startPrice == 0) revert InvalidPrice();
        if (artwork.activeAuctionId != 0) revert ActiveAuctionExists();

        auctionId = ++auctionCounter;
        uint256 endTime = block.timestamp + duration;

        auctions[auctionId] = Auction({
            artworkId: artworkId,
            creator: msg.sender,
            startPrice: startPrice,
            duration: duration,
            originalEndTime: endTime,
            endTime: endTime,
            totalExtension: 0,
            highestBid: 0,
            highestBidder: address(0),
            depositLocked: 0,
            settlementDeadline: 0,
            status: AuctionStatus.Active
        });

        artwork.activeAuctionId = auctionId;

        emit AuctionCreated(
            auctionId,
            artworkId,
            msg.sender,
            startPrice,
            duration,
            endTime,
            block.chainid
        );
    }

    function placeBid(
        uint256 auctionId,
        uint256 bidAmount
    ) external payable nonReentrant whenNotPaused {
        Auction storage auction = auctions[auctionId];
        if (auction.status == AuctionStatus.None) revert AuctionNotFound();
        if (
            auction.status != AuctionStatus.Active ||
            block.timestamp >= auction.endTime
        ) {
            revert AuctionNotActive();
        }
        if (msg.sender == auction.creator) revert CreatorCannotBid();
        if (msg.sender == auction.highestBidder) revert BidderCannotSelfOutbid();

        uint256 minBid = minimumBid(auctionId);
        if (bidAmount < minBid) revert BidTooLow(minBid);

        uint256 requiredDeposit = requiredDepositForBid(bidAmount);
        if (msg.value != requiredDeposit) {
            revert IncorrectDeposit(requiredDeposit);
        }

        if (auction.highestBidder != address(0)) {
            pendingWithdrawals[auction.highestBidder] += auction.depositLocked;
            emit BidDepositWithdrawn(
                auctionId,
                auction.highestBidder,
                auction.depositLocked
            );
        }

        auction.highestBid = bidAmount;
        auction.highestBidder = msg.sender;
        auction.depositLocked = msg.value;

        _applyAntiSnipingExtension(auctionId, auction);

        emit BidPlaced(auctionId, msg.sender, bidAmount, msg.value);
    }

    function endAuction(uint256 auctionId) external whenNotPaused {
        Auction storage auction = auctions[auctionId];
        if (auction.status == AuctionStatus.None) revert AuctionNotFound();
        if (auction.status != AuctionStatus.Active) {
            revert AuctionAlreadyFinalized();
        }
        if (block.timestamp < auction.endTime) revert AuctionNotEnded();

        if (auction.highestBidder == address(0)) {
            auction.status = AuctionStatus.Defaulted;
            artworks[auction.artworkId].activeAuctionId = 0;

            emit AuctionEnded(auctionId, address(0), 0, 0);
            return;
        }

        uint256 deadline = block.timestamp + SETTLEMENT_WINDOW;
        auction.status = AuctionStatus.SettlementPending;
        auction.settlementDeadline = deadline;

        emit AuctionEnded(
            auctionId,
            auction.highestBidder,
            auction.highestBid,
            deadline
        );
    }

    function settleAuction(
        uint256 auctionId
    ) external payable nonReentrant whenNotPaused {
        Auction storage auction = auctions[auctionId];
        if (auction.status == AuctionStatus.None) revert AuctionNotFound();
        if (auction.status != AuctionStatus.SettlementPending) {
            revert AuctionNotEnded();
        }
        if (auction.highestBidder == address(0)) revert AuctionHasNoWinner();
        if (msg.sender != auction.highestBidder) revert NotAuctionWinner();
        if (block.timestamp > auction.settlementDeadline) {
            revert SettlementExpired();
        }

        uint256 finalPrice = auction.highestBid;
        uint256 creditedDeposit = auction.depositLocked > finalPrice
            ? finalPrice
            : auction.depositLocked;
        uint256 requiredPayment = finalPrice - creditedDeposit;
        if (msg.value != requiredPayment) {
            revert IncorrectSettlementPayment(requiredPayment);
        }

        Artwork storage artwork = artworks[auction.artworkId];
        uint256 platformFee = (finalPrice * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 artistProceeds = finalPrice - platformFee;
        uint256 excessDeposit = auction.depositLocked - creditedDeposit;

        auction.status = AuctionStatus.Settled;
        auction.depositLocked = 0;

        artwork.minted = true;
        artwork.canonicalFloor = finalPrice;
        artwork.activeAuctionId = 0;

        pendingWithdrawals[auction.creator] += artistProceeds;
        pendingWithdrawals[treasury] += platformFee;
        if (excessDeposit != 0) {
            pendingWithdrawals[auction.highestBidder] += excessDeposit;
        }
        successfulSettlements++;

        uint256 tokenId = nftContract.mint(
            auction.highestBidder,
            artwork.metadataURI,
            auction.artworkId,
            artwork.creator
        );

        artwork.tokenId = tokenId;
        tokenToArtwork[tokenId] = auction.artworkId;

        emit SettlementCompleted(
            auctionId,
            auction.artworkId,
            auction.highestBidder,
            finalPrice,
            tokenId
        );

        emit CanonicalFloorUpdated(auction.artworkId, tokenId, finalPrice);
    }

    function claimSettlementDefault(
        uint256 auctionId
    ) external nonReentrant whenNotPaused {
        Auction storage auction = auctions[auctionId];
        if (auction.status == AuctionStatus.None) revert AuctionNotFound();
        if (auction.status != AuctionStatus.SettlementPending) {
            revert AuctionNotEnded();
        }
        if (block.timestamp <= auction.settlementDeadline) {
            revert SettlementStillActive();
        }

        uint256 lockedDeposit = auction.depositLocked;
        uint256 platformAmount = (lockedDeposit * DEFAULT_PLATFORM_BPS) /
            BPS_DENOMINATOR;
        uint256 artistAmount = lockedDeposit - platformAmount;

        auction.status = AuctionStatus.Defaulted;
        auction.depositLocked = 0;
        artworks[auction.artworkId].activeAuctionId = 0;

        pendingWithdrawals[auction.creator] += artistAmount;
        pendingWithdrawals[treasury] += platformAmount;

        emit SettlementDefaulted(
            auctionId,
            auction.highestBidder,
            artistAmount,
            platformAmount
        );
    }

    function listResale(
        uint256 tokenId,
        uint256 price
    ) external whenNotPaused {
        uint256 artworkId = tokenToArtwork[tokenId];
        if (artworkId == 0) revert ResaleUnavailable();

        Artwork storage artwork = artworks[artworkId];
        if (!artwork.minted) revert ResaleUnavailable();
        if (price < artwork.canonicalFloor) {
            revert PriceBelowCanonicalFloor(artwork.canonicalFloor);
        }
        if (nftContract.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (
            nftContract.getApproved(tokenId) != address(this) &&
            !nftContract.isApprovedForAll(msg.sender, address(this))
        ) {
            revert CoreNotApprovedForTransfer();
        }

        resaleListings[tokenId] = ResaleListing({
            seller: msg.sender,
            price: price,
            active: true
        });

        emit ResaleListed(tokenId, msg.sender, price);
    }

    function cancelResale(uint256 tokenId) external whenNotPaused {
        ResaleListing storage listing = resaleListings[tokenId];
        if (!listing.active) revert ResaleUnavailable();
        if (listing.seller != msg.sender) revert NotTokenOwner();

        listing.active = false;
    }

    function buyResale(
        uint256 tokenId
    ) external payable nonReentrant whenNotPaused {
        ResaleListing storage listing = resaleListings[tokenId];
        if (!listing.active) revert ResaleUnavailable();
        if (msg.sender == listing.seller) revert NotTokenOwner();
        if (msg.value != listing.price) {
            revert IncorrectSettlementPayment(listing.price);
        }
        if (nftContract.ownerOf(tokenId) != listing.seller) {
            revert NotTokenOwner();
        }

        uint256 artworkId = tokenToArtwork[tokenId];
        Artwork storage artwork = artworks[artworkId];
        if (msg.value < artwork.canonicalFloor) {
            revert PriceBelowCanonicalFloor(artwork.canonicalFloor);
        }

        uint256 platformFee = (msg.value * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 royaltyAmount = (msg.value * ARTIST_ROYALTY_BPS) /
            BPS_DENOMINATOR;
        uint256 sellerProceeds = msg.value - platformFee - royaltyAmount;
        address seller = listing.seller;

        listing.active = false;

        pendingWithdrawals[treasury] += platformFee;
        pendingWithdrawals[artwork.creator] += royaltyAmount;
        pendingWithdrawals[seller] += sellerProceeds;

        nftContract.transferFrom(seller, msg.sender, tokenId);

        emit ResaleCompleted(
            tokenId,
            seller,
            msg.sender,
            msg.value,
            royaltyAmount,
            platformFee
        );
    }

    function recordProjectNFTEligibility(
        address user,
        bytes32 eligibilityHash
    ) external onlyOwner {
        if (user == address(0) || eligibilityHash == bytes32(0)) {
            revert InvalidEligibility();
        }
        if (projectNFTMinted[user]) revert ProjectNFTAlreadyMinted();

        projectEligibilityHash[user] = eligibilityHash;

        emit ProjectNFTEligibilityAchieved(user, eligibilityHash);
    }

    function mintProjectNFT(
        address user,
        bytes32 eligibilityHash
    ) external onlyOwner nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (
            user == address(0) ||
            eligibilityHash == bytes32(0) ||
            projectEligibilityHash[user] != eligibilityHash
        ) {
            revert InvalidEligibility();
        }
        if (projectNFTMinted[user]) revert ProjectNFTAlreadyMinted();

        projectNFTMinted[user] = true;
        tokenId = projectNFT.awardToWinner(user, 0, eligibilityHash);

        emit ProjectNFTMinted(user, tokenId, eligibilityHash);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        treasury = newTreasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function minimumBid(uint256 auctionId) public view returns (uint256) {
        Auction storage auction = auctions[auctionId];
        if (auction.status == AuctionStatus.None) revert AuctionNotFound();

        if (auction.highestBid == 0) {
            return auction.startPrice;
        }

        uint256 percentIncrement = _ceilDiv(
            auction.highestBid * MIN_BID_INCREMENT_BPS,
            BPS_DENOMINATOR
        );
        uint256 increment = percentIncrement > MIN_BID_INCREMENT_ABSOLUTE
            ? percentIncrement
            : MIN_BID_INCREMENT_ABSOLUTE;

        return auction.highestBid + increment;
    }

    function requiredDepositForBid(
        uint256 bidAmount
    ) public pure returns (uint256) {
        uint256 percentageDeposit = _ceilDiv(
            bidAmount * DEPOSIT_BPS,
            BPS_DENOMINATOR
        );

        return percentageDeposit > MIN_DEPOSIT
            ? percentageDeposit
            : MIN_DEPOSIT;
    }

    function _applyAntiSnipingExtension(
        uint256 auctionId,
        Auction storage auction
    ) internal {
        uint256 remaining = auction.endTime - block.timestamp;
        if (remaining > ANTI_SNIPING_WINDOW) return;

        uint256 oldEndTime = auction.endTime;
        uint256 maxEndTime = auction.originalEndTime + MAX_TOTAL_EXTENSION;
        uint256 proposedEndTime = oldEndTime + ANTI_SNIPING_EXTENSION;
        uint256 newEndTime = proposedEndTime > maxEndTime
            ? maxEndTime
            : proposedEndTime;

        if (newEndTime <= oldEndTime) return;

        auction.endTime = newEndTime;
        auction.totalExtension = newEndTime - auction.originalEndTime;

        emit AuctionExtended(auctionId, oldEndTime, newEndTime);
    }

    function _isAllowedDuration(uint256 duration) internal pure returns (bool) {
        return
            duration == AUCTION_DURATION_24H ||
            duration == AUCTION_DURATION_36H ||
            duration == AUCTION_DURATION_48H;
    }

    function _ceilDiv(
        uint256 value,
        uint256 denominator
    ) internal pure returns (uint256) {
        if (value == 0) return 0;
        return ((value - 1) / denominator) + 1;
    }
}
