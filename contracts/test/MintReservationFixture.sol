// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CollectionLaunch} from "../launch/CollectionLaunch.sol";
import {MintReservationEscrow} from "../launch/MintReservationEscrow.sol";

/// @dev Synthetic failure evidence for isolated Hardhat tests.
contract MintReservationFixture is MintReservationEscrow {
    uint256 private _failureTime;

    constructor(uint32 supply, address artist, address treasury, uint32 claimHours, uint256 mintPrice_)
        CollectionLaunch("Reservation fixture", "RSV", "ipfs://reservation-fixture/", supply, artist, treasury, artist, 550)
        MintReservationEscrow(claimHours, mintPrice_) {
        if (block.chainid != 31337) revert InvalidConfiguration();
    }

    function simulateLaunchFailure() external onlyOwner {
        if (_failureTime != 0) revert ReservationUnavailable();
        _failureTime = block.timestamp;
    }

    function _launchFailedAt() internal view override returns (uint256) {
        return _failureTime;
    }

}
