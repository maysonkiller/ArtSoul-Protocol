// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ISettledArtworkSource} from "./SettledArtworkNFT.sol";

/// @dev Tracks operator generations so that a later admission cannot restore an owner's old approvals.
abstract contract MarketplaceAdmissions is ISettledArtworkSource {
    struct Admission {
        uint64 generation;
        bool active;
    }

    mapping(address => Admission) private _externalMarkets;

    error InvalidMarketplaceChange();
    event MarketplaceAdmissionChanged(address indexed operator, uint64 generation, bool active);

    function marketplaceApprovalGeneration(address operator) public view virtual returns (uint256) {
        if (operator == address(this)) return 1;
        Admission memory admission = _externalMarkets[operator];
        return admission.active ? admission.generation : 0;
    }

    function isMarketplaceAllowed(address operator) external view returns (bool) {
        return marketplaceApprovalGeneration(operator) != 0;
    }

    function _setExternalMarketplace(address operator, bool active) internal {
        if (operator == address(0) || operator == address(this)) revert InvalidMarketplaceChange();
        Admission storage admission = _externalMarkets[operator];
        if (active == admission.active) revert InvalidMarketplaceChange();
        if (active) {
            if (operator.code.length == 0) revert InvalidMarketplaceChange();
            ++admission.generation;
        }
        admission.active = active;
        emit MarketplaceAdmissionChanged(operator, admission.generation, active);
    }
}
