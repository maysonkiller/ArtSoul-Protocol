// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev The existing Core getter resolves both registered pre-mint and minted works.
interface IArtSoulArtworkRegistry {
    function artworks(uint256 artworkId) external view returns (
        address creator,
        string memory metadataURI,
        bool minted,
        uint256 canonicalFloor,
        uint256 tokenId,
        uint256 activeAuctionId
    );
}
