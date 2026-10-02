// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IArtSoulArtworkRegistry.sol";

/// @notice Voluntary ETH support routed in full to a registered artwork's creator.
/// @dev Separate from auctions. Deployment must independently verify the Core and administration Safe.
contract ArtSoulDonations is Ownable2Step, Pausable, ReentrancyGuard {
    // This resource bound is not a character count. ArtSoul display also requires at most 140 graphemes.
    uint256 public constant MAX_MESSAGE_BYTES = 560;
    IArtSoulArtworkRegistry public immutable core;

    error InvalidCore();
    error InvalidAdministrationOwner();
    error ZeroDonation();
    error ArtworkNotFound();
    error CreatorMismatch();
    error MessageTooLong();
    error InvalidMessageEncoding();
    error TransferFailed();

    event Donation(
        address indexed donor,
        address indexed creator,
        uint256 indexed artworkId,
        uint256 amount,
        string message,
        bool isAnonymous
    );
    constructor(address core_, address administrationSafe_)
        Ownable(administrationSafe_)
    {
        if (core_.code.length == 0) revert InvalidCore();
        // Contract code alone does not prove a Safe or its owners/threshold; the deployment preflight does.
        if (administrationSafe_.code.length == 0) revert InvalidAdministrationOwner();
        core = IArtSoulArtworkRegistry(core_);
    }

    function donate(address creator, uint256 artworkId, string calldata message, bool isAnonymous)
        external payable nonReentrant whenNotPaused
    {
        if (msg.value == 0) revert ZeroDonation();
        (address registeredCreator,,,,,) = core.artworks(artworkId);
        if (registeredCreator == address(0)) revert ArtworkNotFound();
        if (creator != registeredCreator) revert CreatorMismatch();

        bytes calldata encodedMessage = bytes(message);
        if (encodedMessage.length > MAX_MESSAGE_BYTES) revert MessageTooLong();
        if (encodedMessage.length != 0) _requireValidUtf8(encodedMessage);

        (bool sent,) = payable(registeredCreator).call{value: msg.value}("");
        if (!sent) revert TransferFailed();
        emit Donation(msg.sender, registeredCreator, artworkId, msg.value, message, isAnonymous);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function transferOwnership(address newOwner) public override onlyOwner {
        // Zero cancels an outstanding two-step transfer, as in Ownable2Step.
        if (newOwner != address(0) && newOwner.code.length == 0) revert InvalidAdministrationOwner();
        super.transferOwnership(newOwner);
    }

    function _requireValidUtf8(bytes calldata value) private pure {
        uint256 i;
        while (i < value.length) {
            uint8 first = uint8(value[i]);
            if (first < 0x80) { ++i; continue; }
            uint256 trailing;
            uint8 secondMin = 0x80;
            uint8 secondMax = 0xbf;
            if (first >= 0xc2 && first <= 0xdf) {
                trailing = 1;
            } else if (first >= 0xe0 && first <= 0xef) {
                trailing = 2;
                if (first == 0xe0) secondMin = 0xa0;
                if (first == 0xed) secondMax = 0x9f;
            } else if (first >= 0xf0 && first <= 0xf4) {
                trailing = 3;
                if (first == 0xf0) secondMin = 0x90;
                if (first == 0xf4) secondMax = 0x8f;
            } else {
                revert InvalidMessageEncoding();
            }
            uint256 last = i + trailing;
            if (last >= value.length) revert InvalidMessageEncoding();
            uint8 second = uint8(value[++i]);
            if (second < secondMin || second > secondMax) revert InvalidMessageEncoding();
            while (i < last) {
                uint8 continuation = uint8(value[++i]);
                if (continuation < 0x80 || continuation > 0xbf) revert InvalidMessageEncoding();
            }
            ++i;
        }
    }
}
