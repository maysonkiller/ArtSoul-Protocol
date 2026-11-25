// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {OrdinaryMarket} from "./OrdinaryMarket.sol";

/// @notice Ordinary market with creditor-selected delivery of accrued ETH credits.
contract OrdinaryPayoutMarket is OrdinaryMarket {
    error InvalidCreditRecipient();
    event CreditRouted(address indexed creditor, address indexed recipient);

    constructor(address protocol, address ecosystem, address security, uint256 batchLimit, uint256 transferGas)
        OrdinaryMarket(protocol, ecosystem, security, batchLimit, transferGas)
    {}

    /// @notice Pay the caller's entire available credit to the chosen recipient, including during an entry pause.
    function withdrawTo(address payable recipient) external nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert InvalidCreditRecipient();
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        delete credits[msg.sender];
        (bool paid,) = recipient.call{value: amount}("");
        if (!paid) revert CreditTransferFailed();
        emit CreditRouted(msg.sender, recipient);
        emit CreditWithdrawn(msg.sender, amount);
    }
}
