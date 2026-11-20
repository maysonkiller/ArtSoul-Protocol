// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {OrdinaryArtAuctions} from "../replacement/OrdinaryArtAuctions.sol";
import {TreasuryBoundOrdinaryArt} from "../replacement/TreasuryBoundOrdinaryArt.sol";

/// @dev Exercises replacement accounting and custody with a local marketplace and refund limits.
contract TreasuryBindingFixture is TreasuryBoundOrdinaryArt {
    constructor(address protocol, address ecosystem, address security)
        OrdinaryArtAuctions(2, 30_000) TreasuryBoundOrdinaryArt(protocol, ecosystem, security) {}

    function payoutQuotes(uint256 amount) external pure returns (uint256 primaryProtocol, uint256 defaultProtocol, uint256[4] memory resale) {
        return (_protocolShare(amount, 40), _protocolShare(amount, 5), _resaleShares(amount));
    }
}

/// @dev Exercises the engine's caller and threshold checks. It does not implement Safe signatures.
contract TreasuryAccountStub {
    uint256 public getThreshold;
    address[] private _owners = [address(1), address(2), address(3)];
    constructor(uint256 threshold) { getThreshold = threshold; }
    function setThreshold(uint256 value) external { getThreshold = value; }
    function getOwners() external view returns (address[] memory) { return _owners; }
    function addOwner(address owner) external { _owners.push(owner); }
    function setPause(TreasuryBoundOrdinaryArt engine, bool value) external { engine.setEntryPaused(value); }
    function scheduleMarket(TreasuryBoundOrdinaryArt engine, address market) external { engine.scheduleMarketplaceAdmission(market); }
    function cancelMarket(TreasuryBoundOrdinaryArt engine, address market) external { engine.cancelMarketplaceAdmission(market); }
    function disableMarket(TreasuryBoundOrdinaryArt engine, address market) external { engine.disableMarketplace(market); }
    function claim(TreasuryBoundOrdinaryArt engine) external { engine.withdraw(); }
    receive() external payable {}
}
