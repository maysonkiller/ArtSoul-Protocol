// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {SettledArtworkNFT} from "../replacement/SettledArtworkNFT.sol";
import {MarketplaceAdmissions} from "../replacement/MarketplaceAdmissions.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Local test fixture supplying source records, without a payment or auction implementation.
contract SettledArtworkSourceFixture is MarketplaceAdmissions {
    SettledArtworkNFT public immutable nft;
    mapping(uint256 => Record) private _records;

    constructor() {
        nft = new SettledArtworkNFT();
    }

    function setRecord(uint256 auctionId, Record calldata record) external {
        _records[auctionId] = record;
    }

    function nftSettlement(uint256 auctionId) external view returns (Record memory) {
        return _records[auctionId];
    }

    function issue(SettledArtworkNFT target, uint256 auctionId) external returns (uint256) {
        return target.mintSettled(auctionId);
    }

    function allowMarketplace(address operator, bool allowed) external {
        _setExternalMarketplace(operator, allowed);
    }

    function transferApproved(SettledArtworkNFT target, address from, address to, uint256 tokenId) external {
        target.transferFrom(from, to, tokenId);
    }

    function approveToken(SettledArtworkNFT target, address operator, uint256 tokenId) external {
        target.approve(operator, tokenId);
    }
}

contract SettledArtworkReceiverFixture is IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata)
        external view returns (bytes4)
    {
        SettledArtworkNFT nft = SettledArtworkNFT(msg.sender);
        require(operator == address(nft.core()) && from == address(0));
        require(nft.ownerOf(tokenId) == address(this) && nft.firstCollector(tokenId) == address(this));
        require(nft.tokenCreator(tokenId) != address(0) && bytes(nft.tokenURI(tokenId)).length > 0);
        return IERC721Receiver.onERC721Received.selector;
    }
}
