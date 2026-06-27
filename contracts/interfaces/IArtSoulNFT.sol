// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArtSoulNFT {
    function mint(
        address to,
        string calldata tokenURI,
        uint256 artworkId,
        address creator
    ) external returns (uint256);

    function ownerOf(uint256 tokenId) external view returns (address);

    function getApproved(uint256 tokenId) external view returns (address);

    function isApprovedForAll(
        address owner,
        address operator
    ) external view returns (bool);

    function transferFrom(address from, address to, uint256 tokenId) external;
}
