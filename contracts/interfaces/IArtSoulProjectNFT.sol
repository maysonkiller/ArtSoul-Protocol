// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArtSoulProjectNFT {
    function awardToWinner(
        address winner,
        uint256 auctionId,
        bytes32 eligibilityHash
    ) external returns (uint256);
}
