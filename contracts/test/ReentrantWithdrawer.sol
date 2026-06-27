// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArtSoulCoreWithdrawTarget {
    function placeBid(uint256 auctionId, uint256 bidAmount) external payable;

    function withdraw() external;
}

contract ReentrantWithdrawer {
    IArtSoulCoreWithdrawTarget public immutable core;

    constructor(address core_) {
        core = IArtSoulCoreWithdrawTarget(core_);
    }

    receive() external payable {
        core.withdraw();
    }

    function bid(uint256 auctionId, uint256 bidAmount) external payable {
        core.placeBid{value: msg.value}(auctionId, bidAmount);
    }

    function withdrawWithReentry() external {
        core.withdraw();
    }
}
