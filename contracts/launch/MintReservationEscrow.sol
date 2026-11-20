// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CollectionLaunch} from "./CollectionLaunch.sol";

/// @notice Local candidate for auctioning one optional mint per winning bidder.
/// @dev A release must supply reviewed evidence for launch failure.
abstract contract MintReservationEscrow is CollectionLaunch {
    enum Outcome { Open, Redeemed, Expired, Refunded }

    struct Reservation {
        address resaleBuyer;
        Outcome outcome;
        uint256 resalePaid;
        uint256 askingPrice;
        uint256 listingVersion;
    }

    uint256 public immutable holderMintPrice;
    uint256 public immutable redemptionDuration;
    uint256 public resaleEndsAt;
    uint256 public redemptionEndsAt;
    mapping(address => Reservation) public reservations;

    error ReservationUnavailable();
    error StaleReservationListing();
    event ReservationWindowsOpened(uint256 resaleEndsAt, uint256 redemptionEndsAt);
    event ReservationListingChanged(address indexed original, uint256 indexed version, uint256 askingPrice);
    event ReservationResold(address indexed original, address indexed buyer, uint256 paid, uint256 listingVersion);
    event ReservationResolved(address indexed original, address indexed holder, Outcome outcome);
    event ReservationProceedsCredited(address indexed original, uint256 creatorAmount, uint256 protocolFee, uint256 resaleProceeds);

    constructor(uint32 redemptionHours, uint256 additionalPayment) {
        if (redemptionHours == 0) revert InvalidConfiguration();
        redemptionDuration = uint256(redemptionHours) * 1 hours;
        holderMintPrice = additionalPayment;
    }

    function addPhase(PhaseConfig calldata config) public override {
        if (_phases.length >= 2 || !config.enabled || config.rollover || config.priceSource != 0 ||
            config.kind != (_phases.length == 0 ? Kind.UniformAuction : Kind.Fixed) || config.price == 0) {
            revert InvalidConfiguration();
        }
        super.addPhase(config);
    }

    function lockConfiguration() public override {
        if (_phases.length != 2) revert InvalidConfiguration();
        super.lockConfiguration();
    }

    // A winning bid here buys a right. The NFT is issued only upon redemption.
    function claimAuction(uint256, address) external pure override {
        revert ReservationUnavailable();
    }

    function listReservation(uint256 price) external whenNotPaused {
        _requireResaleWindow();
        _requireOpen(msg.sender);
        Reservation storage place = reservations[msg.sender];
        if (price == 0 || place.resaleBuyer != address(0)) revert ReservationUnavailable();
        place.askingPrice = price;
        emit ReservationListingChanged(msg.sender, ++place.listingVersion, price);
    }

    function cancelReservationListing() external {
        Reservation storage place = reservations[msg.sender];
        if (place.askingPrice == 0 || place.outcome != Outcome.Open) revert ReservationUnavailable();
        place.askingPrice = 0;
        emit ReservationListingChanged(msg.sender, ++place.listingVersion, 0);
    }

    function buyReservation(address original, uint256 expectedVersion) external payable whenNotPaused {
        _requireResaleWindow();
        _requireOpen(original);
        Reservation storage place = reservations[original];
        if (place.listingVersion != expectedVersion || place.askingPrice == 0) revert StaleReservationListing();
        if (msg.value != place.askingPrice) revert IncorrectPayment();
        if (msg.sender == original || place.resaleBuyer != address(0)) revert ReservationUnavailable();
        place.askingPrice = 0;
        place.resalePaid = msg.value;
        place.resaleBuyer = msg.sender;
        emit ReservationResold(original, msg.sender, msg.value, expectedVersion);
        emit ReservationListingChanged(original, ++place.listingVersion, 0);
    }

    function redeemReservation(address original, address recipient) external payable nonReentrant {
        address holder = _requireOpen(original);
        if (holder != msg.sender || block.timestamp < resaleEndsAt || block.timestamp >= redemptionEndsAt ||
            _failedDuringWindow()) revert ReservationUnavailable();
        if (msg.value != holderMintPrice) revert IncorrectPayment();
        _resolve(original, holder, Outcome.Redeemed);
        bids[0][original].claimed = true;
        ++phaseMints[0][holder];
        _mintBatch(0, holder, recipient, 1, msg.value);
    }

    function expireReservation(address original) external nonReentrant {
        address holder = _requireOpen(original);
        if (block.timestamp < redemptionEndsAt || _failedDuringWindow()) revert ReservationUnavailable();
        _resolve(original, holder, Outcome.Expired);
        // Each expired right can release at most one unit into the public phase.
        if (!_states[1].closed && block.timestamp < _phases[1].end) ++_states[1].capacity;
    }

    function refundFailedReservation(address original) external nonReentrant {
        address holder = _requireOpen(original);
        if (!_failedDuringWindow()) revert ReservationUnavailable();
        _resolve(original, holder, Outcome.Refunded);
    }

    function _requireOpen(address original) private view returns (address holder) {
        _requireSettledWinner(0, original);
        Reservation storage place = reservations[original];
        if (place.outcome != Outcome.Open) revert ReservationUnavailable();
        return place.resaleBuyer == address(0) ? original : place.resaleBuyer;
    }

    function _resolve(address original, address holder, Outcome outcome) private {
        Reservation storage place = reservations[original];
        place.outcome = outcome;
        place.askingPrice = 0;
        _creditWinnerRefund(0, original);
        uint256 premium = _states[0].clearingPrice;
        if (outcome == Outcome.Refunded) {
            credits[original] += premium;
            credits[holder] += place.resalePaid;
        } else {
            uint256 primaryGross = premium + (outcome == Outcome.Redeemed ? holderMintPrice : 0);
            // Round the 1/40 protocol share once per reservation. The creator wins exact half-wei ties.
            uint256 protocolFee = primaryGross / 40;
            if (primaryGross % 40 > 20) ++protocolFee;
            uint256 creatorAmount = primaryGross - protocolFee;
            credits[creator] += creatorAmount;
            credits[protocolReceiver] += protocolFee;
            credits[original] += place.resalePaid;
            emit ReservationProceedsCredited(original, creatorAmount, protocolFee, place.resalePaid);
        }
        emit ReservationResolved(original, holder, outcome);
    }

    function _settleAuctionProceeds(uint256) internal override {
        // Leave funded premiums in escrow until each right reaches its own outcome.
        resaleEndsAt = block.timestamp + 24 hours;
        redemptionEndsAt = resaleEndsAt + redemptionDuration;
        emit ReservationWindowsOpened(resaleEndsAt, redemptionEndsAt);
    }

    function _requireResaleWindow() private view {
        if (block.timestamp >= resaleEndsAt || _failedDuringWindow()) revert ReservationUnavailable();
    }

    function _requireLive(uint256 id) internal view override {
        if (_launchFailedAt() != 0) revert PhaseUnavailable();
        super._requireLive(id);
    }

    function _failedDuringWindow() private view returns (bool) {
        uint256 failure = _launchFailedAt();
        return failure != 0 && failure < redemptionEndsAt;
    }

    /// @dev Returns zero while operational or the immutable, evidenced time at which the launch failed.
    function _launchFailedAt() internal view virtual returns (uint256);

}
