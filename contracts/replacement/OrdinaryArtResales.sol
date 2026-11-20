// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OrdinaryArtAuctions} from "./OrdinaryArtAuctions.sol";

/// @notice Fixed-price secondary sales of ordinary works issued by this engine.
abstract contract OrdinaryArtResales is OrdinaryArtAuctions {
    struct Listing {
        uint256 version;
        address seller;
        uint256 price;
        bytes32 authorization;
    }

    mapping(uint256 => Listing) public resaleListings;

    error StaleListing();
    error InvalidListingOwner();
    error MissingResaleApproval();
    error BelowCanonicalFloor(uint256 floor);

    event ResaleListed(uint256 indexed tokenId, uint256 indexed version, address indexed seller, uint256 price, bytes32 authorization);
    event ResaleCancelled(uint256 indexed tokenId, uint256 indexed version, address indexed seller);
    event ResalePurchased(uint256 indexed tokenId, uint256 version, address indexed seller, address indexed buyer, uint256 price);
    event ResaleCredited(uint256 indexed tokenId, uint256 indexed version, address protocol, address ecosystem,
        uint256 sellerAmount, uint256 creatorAmount, uint256 protocolAmount, uint256 ecosystemAmount);

    /// @notice Returns the current sale terms. Inactive quotes keep the version and return zero seller and price.
    function getActiveResale(uint256 tokenId) external view returns (bool active, address seller, uint256 price, uint256 version) {
        Listing memory listing = resaleListings[tokenId];
        version = listing.version;
        if (paused() || listing.seller == address(0) || !_hasResaleApproval(tokenId, listing)) {
            return (false, address(0), 0, version);
        }
        (bool meetsFloor,) = _checkFloor(tokenId, listing.price);
        if (!meetsFloor) return (false, address(0), 0, version);
        return (true, listing.seller, listing.price, version);
    }

    function listResale(uint256 tokenId, uint256 expectedVersion, uint256 price) external whenNotPaused nonReentrant {
        if (nft.ownerOf(tokenId) != msg.sender) revert InvalidListingOwner();
        _requireFloor(tokenId, price);
        uint256 currentVersion = resaleListings[tokenId].version;
        if (expectedVersion != currentVersion) revert StaleListing();
        bytes32 authorization = nft.resaleAuthorization(tokenId, msg.sender);
        if (authorization == bytes32(0)) revert MissingResaleApproval();
        uint256 version = currentVersion + 1;
        resaleListings[tokenId] = Listing(version, msg.sender, price, authorization);
        emit ResaleListed(tokenId, version, msg.sender, price, authorization);
    }

    function cancelResale(uint256 tokenId, uint256 expectedVersion) external nonReentrant {
        Listing memory listing = _activeListing(tokenId, expectedVersion);
        if (listing.seller != msg.sender || nft.ownerOf(tokenId) != msg.sender) revert InvalidListingOwner();
        _clearListing(tokenId, listing.version);
        emit ResaleCancelled(tokenId, listing.version, msg.sender);
    }

    function buyResale(uint256 tokenId, uint256 expectedVersion) external payable whenNotPaused nonReentrant {
        Listing memory listing = _activeListing(tokenId, expectedVersion);
        if (listing.seller == msg.sender) revert InvalidListingOwner();
        if (msg.value != listing.price) revert IncorrectFunding(listing.price);
        if (!_hasResaleApproval(tokenId, listing)) revert MissingResaleApproval();
        _requireFloor(tokenId, listing.price);
        _clearListing(tokenId, listing.version);
        _creditResale(tokenId, listing);
        emit ResalePurchased(tokenId, listing.version, listing.seller, msg.sender, listing.price);
        nft.safeTransferFrom(listing.seller, msg.sender, tokenId);
    }

    function _activeListing(uint256 tokenId, uint256 version) private view returns (Listing memory listing) {
        listing = resaleListings[tokenId];
        if (listing.seller == address(0) || listing.version != version) revert StaleListing();
    }

    function _hasResaleApproval(uint256 tokenId, Listing memory listing) private view returns (bool) {
        return nft.resaleAuthorization(tokenId, listing.seller) == listing.authorization;
    }

    function _checkFloor(uint256 tokenId, uint256 price) private view returns (bool valid, uint256 floor) {
        floor = works[nft.tokenToArtwork(tokenId)].floor;
        valid = floor != 0 && price >= floor;
    }

    function _requireFloor(uint256 tokenId, uint256 price) private view {
        (bool valid, uint256 floor) = _checkFloor(tokenId, price);
        if (!valid) revert BelowCanonicalFloor(floor);
    }

    function _clearListing(uint256 tokenId, uint256 version) private {
        resaleListings[tokenId] = Listing(version + 1, address(0), 0, bytes32(0));
    }

    function _creditResale(uint256 tokenId, Listing memory listing) private {
        address protocol = _protocolRecipient();
        address ecosystem = _ecosystemRecipient();
        if (protocol == address(0) || ecosystem == address(0) || protocol == ecosystem) revert InvalidTreasury();
        uint256[4] memory shares = _resaleShares(listing.price);
        credits[listing.seller] += shares[0];
        credits[nft.tokenCreator(tokenId)] += shares[1];
        credits[protocol] += shares[2];
        credits[ecosystem] += shares[3];
        emit ResaleCredited(tokenId, listing.version, protocol, ecosystem, shares[0], shares[1], shares[2], shares[3]);
    }

    /// @dev Weight order also breaks remainder ties: seller, creator, protocol, ecosystem.
    function _resaleShares(uint256 price) internal pure returns (uint256[4] memory shares) {
        uint256[4] memory weights = [uint256(185), 11, 2, 2];
        uint256[4] memory remainders;
        uint256 unallocated = price;
        for (uint256 i = 0; i < weights.length; ++i) {
            shares[i] = Math.mulDiv(price, weights[i], 200);
            remainders[i] = mulmod(price, weights[i], 200);
            unallocated -= shares[i];
        }
        // Four floor quotas leave at most three wei. A role can receive only one of them.
        for (uint256 extra = 0; extra < unallocated; ++extra) {
            uint256 best = 0;
            for (uint256 i = 1; i < remainders.length; ++i) {
                if (remainders[i] > remainders[best]) best = i;
            }
            ++shares[best];
            remainders[best] = 0;
        }
    }

    function _ecosystemRecipient() internal view virtual returns (address);
}
