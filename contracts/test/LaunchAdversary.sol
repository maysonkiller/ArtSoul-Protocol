// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface ILaunchPayments {
    function bid(uint256 phaseId) external payable;
    function withdrawTo(address payable recipient) external;
    function claimAuction(uint256 phaseId, address recipient) external;
}

contract LaunchAdversary {
    ILaunchPayments public immutable launch;
    bool public reenter;
    bool public reentrySucceeded;
    constructor(address launch_) { launch = ILaunchPayments(launch_); }
    function bid(uint256 phaseId) external payable { launch.bid{value: msg.value}(phaseId); }
    function claim(uint256 phaseId, address recipient) external { launch.claimAuction(phaseId, recipient); }
    function withdraw(address payable recipient, bool attack) external {
        reenter = attack;
        launch.withdrawTo(recipient);
    }
    receive() external payable {
        require(reenter, "reject ETH");
        (reentrySucceeded,) = address(launch).call(abi.encodeCall(ILaunchPayments.withdrawTo, (payable(address(this)))));
    }
}
