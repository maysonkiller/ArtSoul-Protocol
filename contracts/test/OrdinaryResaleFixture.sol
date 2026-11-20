// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {OrdinaryArtResales} from "../replacement/OrdinaryArtResales.sol";
import {OrdinaryArtAuctions} from "../replacement/OrdinaryArtAuctions.sol";

/// @dev Local policy inputs for secondary-sale acceptance tests.
contract OrdinaryResaleFixture is OrdinaryArtResales {
    address private immutable operator;
    address private immutable protocol;
    address private immutable ecosystem;
    bool private allowed = true;

    constructor(address protocol_, address ecosystem_) OrdinaryArtAuctions(2, 30_000) {
        operator = msg.sender;
        protocol = protocol_;
        ecosystem = ecosystem_;
    }

    function setTestConditions(bool pauseEntries, bool allowMarket) external {
        require(msg.sender == operator);
        if (pauseEntries && !paused()) _pause();
        if (!pauseEntries && paused()) _unpause();
        allowed = allowMarket;
    }

    function _protocolRecipient() internal view override returns (address) { return protocol; }
    function _ecosystemRecipient() internal view override returns (address) { return ecosystem; }
    function marketplaceApprovalGeneration(address candidate) public view override returns (uint256) {
        return allowed ? super.marketplaceApprovalGeneration(candidate) : 0;
    }
}

contract NonReceivingBuyerFixture {
    function buy(OrdinaryArtResales engine, uint256 tokenId, uint256 version) external payable {
        engine.buyResale{value: msg.value}(tokenId, version);
    }
}
