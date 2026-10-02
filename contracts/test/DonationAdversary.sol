// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IDonationTestCore {
    function registerArtwork(string calldata metadataURI) external returns (uint256);
}

interface IDonationTestTarget {
    function donate(address creator, uint256 artworkId, string calldata message, bool isAnonymous) external payable;
}

/// @dev Test administration relay, not a Safe implementation or Safe acceptance evidence.
contract DonationTestAdmin {
    address public immutable controller;
    constructor(address controller_) { controller = controller_; }

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        require(msg.sender == controller, "Controller required");
        bool success;
        (success, result) = target.call(data);
        if (!success) assembly { revert(add(result, 32), mload(result)) }
    }
}

contract DonationAdversary {
    enum Mode { Accept, Reject, CatchReentry, RejectReentry }
    Mode public mode;
    IDonationTestTarget public target;
    uint256 public artworkId;
    uint256 public receives;
    uint256 public received;
    bool public reentryBlocked;
    bytes4 public reentryError;

    function register(address core) external {
        artworkId = IDonationTestCore(core).registerArtwork("ipfs://adversary");
    }

    function configure(address target_, Mode mode_) external {
        target = IDonationTestTarget(target_);
        mode = mode_;
    }

    receive() external payable {
        require(mode != Mode.Reject, "Creator rejected support");
        ++receives;
        received += msg.value;
        if (mode == Mode.CatchReentry || mode == Mode.RejectReentry) {
            (bool success, bytes memory result) = address(target).call{value: 1}(
                abi.encodeCall(IDonationTestTarget.donate, (address(this), artworkId, "", false))
            );
            if (mode == Mode.RejectReentry) require(success, "Nested support rejected");
            require(!success, "Reentry unexpectedly succeeded");
            reentryBlocked = true;
            if (result.length >= 4) reentryError = bytes4(result);
        }
    }
}
