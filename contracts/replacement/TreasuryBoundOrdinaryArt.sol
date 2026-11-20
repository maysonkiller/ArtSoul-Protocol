// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {OrdinaryArtResales} from "./OrdinaryArtResales.sol";

interface ISafeOwnerConfiguration {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

/// @dev Binds the three reviewed Safe addresses for the life of this deployment.
/// The deployment review must establish Safe identity, owners, exact quorum and enabled modules.
abstract contract TreasuryBoundOrdinaryArt is OrdinaryArtResales {
    address public immutable protocolTreasury;
    address public immutable ecosystemTreasury;
    address public immutable adminSecurity;
    uint256 public constant MARKETPLACE_ADMISSION_DELAY = 48 hours;
    mapping(address => uint256) public marketplaceAdmissionReadyAt;

    error OverlappingSafeRoles();
    error InvalidMultisig(address account);
    error UnauthorizedPauseCaller();
    error UnauthorizedMarketplaceGovernor();
    event MarketplaceAdmissionScheduled(address indexed operator, uint256 readyAt);
    event MarketplaceAdmissionCancelled(address indexed operator);

    constructor(address protocol, address ecosystem, address security) {
        if (protocol == ecosystem || protocol == security || ecosystem == security) revert OverlappingSafeRoles();
        _requireMultisig(protocol);
        _requireMultisig(ecosystem);
        _requireMultisig(security);
        protocolTreasury = protocol;
        ecosystemTreasury = ecosystem;
        adminSecurity = security;
    }

    function setEntryPaused(bool value) external {
        if (msg.sender != adminSecurity) revert UnauthorizedPauseCaller();
        _requireMultisig(adminSecurity);
        if (value) _pause();
        else _unpause();
    }

    function scheduleMarketplaceAdmission(address operator) external {
        if (msg.sender != adminSecurity) revert UnauthorizedMarketplaceGovernor();
        _requireAdmissionQuorum();
        if (operator.code.length == 0 || marketplaceApprovalGeneration(operator) != 0 ||
            marketplaceAdmissionReadyAt[operator] != 0) revert InvalidMarketplaceChange();
        uint256 readyAt = block.timestamp + MARKETPLACE_ADMISSION_DELAY;
        marketplaceAdmissionReadyAt[operator] = readyAt;
        emit MarketplaceAdmissionScheduled(operator, readyAt);
    }

    /// @notice Anyone can execute the exact admission announced by the Safe once the delay has elapsed.
    function executeMarketplaceAdmission(address operator) external {
        uint256 readyAt = marketplaceAdmissionReadyAt[operator];
        if (readyAt == 0 || block.timestamp < readyAt) revert InvalidMarketplaceChange();
        _requireAdmissionQuorum();
        delete marketplaceAdmissionReadyAt[operator];
        _setExternalMarketplace(operator, true);
    }

    function cancelMarketplaceAdmission(address operator) external {
        _requireRevocationAuthority();
        if (marketplaceAdmissionReadyAt[operator] == 0) revert InvalidMarketplaceChange();
        delete marketplaceAdmissionReadyAt[operator];
        emit MarketplaceAdmissionCancelled(operator);
    }

    function disableMarketplace(address operator) external {
        _requireRevocationAuthority();
        _setExternalMarketplace(operator, false);
    }

    function _requireAdmissionQuorum() private view {
        ISafeOwnerConfiguration safe = ISafeOwnerConfiguration(adminSecurity);
        if (safe.getThreshold() != 2 || safe.getOwners().length != 3) revert InvalidMultisig(adminSecurity);
    }

    function _requireRevocationAuthority() private view {
        if (msg.sender != adminSecurity) revert UnauthorizedMarketplaceGovernor();
        _requireMultisig(adminSecurity);
    }

    function _requireMultisig(address account) private view {
        if (account.code.length == 0) revert InvalidMultisig(account);
        if (ISafeOwnerConfiguration(account).getThreshold() < 2) revert InvalidMultisig(account);
    }

    function _protocolRecipient() internal view override returns (address) {
        return protocolTreasury;
    }

    function _ecosystemRecipient() internal view override returns (address) {
        return ecosystemTreasury;
    }
}
