// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Processes displaced deposits in bid order after the issuing auction closes.
abstract contract OutbidRefunds is ReentrancyGuard {
    struct Refund {
        address creditor;
        uint256 amount;
    }

    struct RefundQueue {
        Refund[] entries;
        uint256 cursor;
    }

    uint256 public immutable refundBatchLimit;
    uint256 public immutable refundTransferGas;
    mapping(uint256 => RefundQueue) private refundQueues;
    mapping(address => uint256) public credits;

    error InvalidRefundLimits();
    error InvalidOutbidRefund();
    error RefundsUnavailable();
    error InvalidRefundBatch();
    error NoCredit();
    error CreditTransferFailed();

    event OutbidRefundQueued(uint256 indexed auctionId, uint256 indexed index, address indexed creditor, uint256 amount);
    event OutbidRefundProcessed(uint256 indexed auctionId, uint256 indexed index, address indexed creditor, uint256 amount, bool paid);
    event CreditWithdrawn(address indexed creditor, uint256 amount);

    constructor(uint256 batchLimit, uint256 transferGas) {
        if (batchLimit == 0 || transferGas == 0) revert InvalidRefundLimits();
        refundBatchLimit = batchLimit;
        refundTransferGas = transferGas;
    }

    function _refundsOpen(uint256 auctionId) internal view virtual returns (bool);

    function _queueOutbidRefund(uint256 auctionId, address creditor, uint256 amount) internal {
        if (creditor == address(0) || amount == 0) revert InvalidOutbidRefund();
        Refund[] storage entries = refundQueues[auctionId].entries;
        uint256 index = entries.length;
        entries.push(Refund(creditor, amount));
        emit OutbidRefundQueued(auctionId, index, creditor, amount);
    }

    function refundProgress(uint256 auctionId) external view returns (uint256 cursor, uint256 total) {
        RefundQueue storage queue = refundQueues[auctionId];
        return (queue.cursor, queue.entries.length);
    }

    function processRefunds(uint256 auctionId, uint256 count) external nonReentrant {
        if (!_refundsOpen(auctionId)) revert RefundsUnavailable();
        if (count == 0 || count > refundBatchLimit) revert InvalidRefundBatch();
        RefundQueue storage queue = refundQueues[auctionId];
        uint256 remaining = queue.entries.length - queue.cursor;
        uint256 end = queue.cursor + (count < remaining ? count : remaining);
        while (queue.cursor < end) {
            uint256 index = queue.cursor++;
            Refund memory refund = queue.entries[index];
            delete queue.entries[index];
            bool paid = _pay(refund.creditor, refund.amount, refundTransferGas);
            if (!paid) credits[refund.creditor] += refund.amount;
            emit OutbidRefundProcessed(auctionId, index, refund.creditor, refund.amount, paid);
        }
    }

    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        delete credits[msg.sender];
        if (!_pay(msg.sender, amount, gasleft())) revert CreditTransferFailed();
        emit CreditWithdrawn(msg.sender, amount);
    }

    function _pay(address creditor, uint256 amount, uint256 gasBudget) private returns (bool paid) {
        // Only the success flag is needed. Keep recipient return data out of the batch's memory budget.
        assembly ("memory-safe") {
            paid := call(gasBudget, creditor, amount, 0, 0, 0, 0)
        }
    }
}
