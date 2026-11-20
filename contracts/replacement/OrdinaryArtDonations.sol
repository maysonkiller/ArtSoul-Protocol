// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CreatorDonations} from "../ArtSoulDonations.sol";
import {OrdinaryArtAuctions} from "./OrdinaryArtAuctions.sol";

/// @notice Supports pre-mint and settled work registered in one ordinary auction engine.
contract OrdinaryArtDonations is CreatorDonations {
    OrdinaryArtAuctions public immutable core;

    constructor(OrdinaryArtAuctions core_, address administrationSafe_) CreatorDonations(address(core_), administrationSafe_) {
        core = core_;
    }

    function _registeredCreator(uint256 artworkId) internal view override returns (address creator) {
        (creator,,,) = core.works(artworkId);
    }
}
