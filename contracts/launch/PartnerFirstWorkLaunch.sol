// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CollectionLaunch} from "./CollectionLaunch.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice A first-work launch with up to three opening auctions and a flat-price public remainder.
/// @dev Using this template does not confer reviewed Partner status or identity verification.
contract PartnerFirstWorkLaunch is CollectionLaunch {
    uint8 public constant MAX_OPENING_ATTEMPTS = 3;
    uint256 public constant REAPPLICATION_COOLDOWN = 30 days;
    uint8 public openingAttempt;
    bool public reapplicationRequested;

    event OpeningAttemptStarted(uint8 indexed attempt, uint64 auctionStart, uint64 auctionEnd, uint64 publicStart, uint64 publicEnd);
    event OpeningLaunchCancelled(uint64 failedAt, uint256 reapplicationAvailableAt);
    event PartnerReapplicationRequested(address indexed applicant);
    event PublicMintWindowShifted(uint64 start, uint64 end);

    constructor(string memory name_, string memory symbol_, string memory metadataPrefix_, uint32 maxSupply_,
        address creator_, address protocolReceiver_)
        CollectionLaunch(name_, symbol_, metadataPrefix_, maxSupply_, creator_, protocolReceiver_, creator_, 550)
    {
        if (maxSupply_ < 2) revert InvalidConfiguration();
    }

    function addPhase(PhaseConfig calldata config) public override {
        uint256 id = _phases.length;
        if (id > 1 || (id == 0 && config.kind != Kind.FirstArtworkAuction) ||
            (id == 1 && (config.kind != Kind.Fixed || !config.enabled || config.allocation != maxSupply - 1))) {
            revert InvalidConfiguration();
        }
        super.addPhase(config);
    }

    function lockConfiguration() public override {
        super.lockConfiguration();
        openingAttempt = 1;
        _announceAttempt();
    }

    /// @notice Restart only a bidless opening. Shift both windows together to preserve all other locked terms.
    function retryFirstAuction() external onlyOwner whenNotPaused nonReentrant {
        if (!configurationLocked || openingAttempt >= MAX_OPENING_ATTEMPTS || _states[0].bids != 0 ||
            block.timestamp < _phases[0].end) revert PhaseUnavailable();
        if (!_states[0].closed) _closePhase(0);
        _states[0].closed = false;
        uint256 shift = block.timestamp - _phases[0].start;
        _delayWindow(_phases[0], shift);
        _delayWindow(_phases[1], shift);
        ++openingAttempt;
        _announceAttempt();
    }

    /// @notice Earliest reapplication for this cancelled launch. Its original three attempts stay final.
    function reapplicationAvailableAt() public view returns (uint256) {
        if (openingAttempt != MAX_OPENING_ATTEMPTS || _states[0].bids != 0 ||
            block.timestamp < _phases[0].end) return 0;
        return uint256(_phases[0].end) + REAPPLICATION_COOLDOWN;
    }

    /// @notice Submit a new review request for a cancelled launch. No auction or Partner approval is created.
    function requestReapplication() external onlyOwner {
        uint256 eligibleAt = reapplicationAvailableAt();
        if (eligibleAt == 0 || block.timestamp < eligibleAt || reapplicationRequested) revert PhaseUnavailable();
        if (!_states[0].closed) _closePhase(0);
        reapplicationRequested = true;
        emit PartnerReapplicationRequested(msg.sender);
    }

    function _closePhase(uint256 id) internal override {
        // A late permissionless close must never consume the public phase before a bidless opening is retried.
        if (id == 1 && !_states[0].subscribed) revert PriceUnavailable();
        super._closePhase(id);
        if (id == 0) {
            if (_states[0].subscribed && block.timestamp > _phases[1].start) {
                PhaseConfig storage sale = _phases[1];
                _delayWindow(sale, block.timestamp - sale.start);
                emit PublicMintWindowShifted(sale.start, sale.end);
            } else if (openingAttempt == MAX_OPENING_ATTEMPTS && !_states[0].subscribed) {
                emit OpeningLaunchCancelled(_phases[0].end, reapplicationAvailableAt());
            }
        }
    }

    function _announceAttempt() private {
        emit OpeningAttemptStarted(openingAttempt, _phases[0].start, _phases[0].end, _phases[1].start, _phases[1].end);
    }

    function _delayWindow(PhaseConfig storage phase_, uint256 shift) private {
        // An open-ended public window at uint64.max must never block settlement of a funded bid.
        phase_.start = uint64(Math.min(uint256(phase_.start) + shift, type(uint64).max - 1));
        phase_.end = uint64(Math.min(uint256(phase_.end) + shift, type(uint64).max));
    }
}
