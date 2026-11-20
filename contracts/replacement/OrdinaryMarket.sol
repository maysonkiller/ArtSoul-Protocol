// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {OrdinaryArtAuctions} from "./OrdinaryArtAuctions.sol";
import {TreasuryBoundOrdinaryArt, ISafeOwnerConfiguration} from "./TreasuryBoundOrdinaryArt.sol";

/// @notice Immutable ordinary-artwork market paired with the NFT created in its constructor.
contract OrdinaryMarket is TreasuryBoundOrdinaryArt {
    constructor(address protocol, address ecosystem, address security, uint256 batchLimit, uint256 transferGas)
        OrdinaryArtAuctions(batchLimit, transferGas)
        TreasuryBoundOrdinaryArt(protocol, ecosystem, security)
    {
        _requireInitialQuorum(protocol);
        _requireInitialQuorum(ecosystem);
        _requireInitialQuorum(security);
    }

    function _requireInitialQuorum(address account) private view {
        ISafeOwnerConfiguration safe = ISafeOwnerConfiguration(account);
        if (safe.getThreshold() != 2 || safe.getOwners().length != 3) revert InvalidMultisig(account);
    }
}
