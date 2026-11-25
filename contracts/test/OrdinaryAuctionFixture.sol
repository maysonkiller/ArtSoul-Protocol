// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {OrdinaryArtAuctions} from "../replacement/OrdinaryArtAuctions.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {OrdinaryPayoutMarket} from "../replacement/OrdinaryPayoutMarket.sol";

/// @dev Local EVM policy values only. This fixture has no deployment script.
contract OrdinaryAuctionFixture is OrdinaryArtAuctions {
    address private immutable operator;
    address private immutable treasury;

    constructor(address recipient) OrdinaryArtAuctions(2, 30_000) {
        operator = msg.sender;
        treasury = recipient;
    }

    function setEntryPaused(bool value) external {
        require(msg.sender == operator);
        if (value) _pause(); else _unpause();
    }

    function _protocolRecipient() internal view override returns (address) { return treasury; }
}

/// @dev Models a bidder which independently accepts or declines ETH and NFT delivery.
contract OrdinaryBidderFixture is IERC721Receiver {
    bool private acceptsETH;
    bool private acceptsNFT;

    function acceptDelivery(bool eth, bool nft) external { acceptsETH = eth; acceptsNFT = nft; }
    function bid(OrdinaryArtAuctions engine, uint256 id, uint256 price) external payable {
        engine.placeBid{value: msg.value}(id, price);
    }
    function settle(OrdinaryArtAuctions engine, uint256 id) external payable { engine.settleAuction{value: msg.value}(id); }
    function acceptOffer(OrdinaryArtAuctions engine, uint256 id) external payable {
        engine.acceptRunnerUpOffer{value: msg.value}(id);
    }
    function withdraw(OrdinaryArtAuctions engine) external { engine.withdraw(); }
    function withdrawTo(OrdinaryPayoutMarket engine, address payable recipient) external { engine.withdrawTo(recipient); }
    receive() external payable { require(acceptsETH); }
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        require(acceptsNFT);
        return IERC721Receiver.onERC721Received.selector;
    }
}
