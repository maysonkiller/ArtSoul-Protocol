// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ISettledArtworkSource} from "../replacement/SettledArtworkNFT.sol";

/// @dev New collection templates share the reviewed Core's external marketplace admissions.
abstract contract CollectionOperatorApprovals is ERC721 {
    ISettledArtworkSource public immutable marketplaceRegistry;
    mapping(uint256 => uint256) private _tokenGeneration;
    mapping(address => mapping(address => uint256)) private _operatorGeneration;

    error InvalidMarketplaceRegistry();
    error MarketplaceNotAllowed(address operator);

    constructor(string memory name_, string memory symbol_, address registry_) ERC721(name_, symbol_) {
        ISettledArtworkSource registry = ISettledArtworkSource(registry_);
        if (registry_.code.length == 0 || registry.marketplaceApprovalGeneration(registry_) != 1 ||
            registry.marketplaceApprovalGeneration(address(0)) != 0) revert InvalidMarketplaceRegistry();
        marketplaceRegistry = registry;
    }

    function _grantGeneration(address operator) private view returns (uint256 generation) {
        // The ordinary Core handles its own NFT's sales. Only externally admitted operators serve collections.
        if (operator != address(marketplaceRegistry)) generation = marketplaceRegistry.marketplaceApprovalGeneration(operator);
        if (generation == 0) revert MarketplaceNotAllowed(operator);
    }

    function setApprovalForAll(address operator, bool approved) public override {
        if (approved) _operatorGeneration[msg.sender][operator] = _grantGeneration(operator);
        super.setApprovalForAll(operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return super.isApprovedForAll(owner, operator) &&
            marketplaceRegistry.marketplaceApprovalGeneration(operator) == _operatorGeneration[owner][operator];
    }

    function _approve(address to, uint256 tokenId, address auth, bool emitEvent) internal override {
        if (to != address(0)) _tokenGeneration[tokenId] = _grantGeneration(to);
        super._approve(to, tokenId, auth, emitEvent);
    }

    function _getApproved(uint256 tokenId) internal view override returns (address) {
        address operator = super._getApproved(tokenId);
        if (operator != address(0) && marketplaceRegistry.marketplaceApprovalGeneration(operator) != _tokenGeneration[tokenId]) {
            return address(0);
        }
        return operator;
    }
}
