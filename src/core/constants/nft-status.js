// NFT Status Constants
// Defines all possible NFT statuses in the system

/**
 * NFT Status Enum
 * Used consistently across frontend, services, and Supabase
 */
export const NFTStatus = {
    // Artwork is being created, not yet on blockchain
    DRAFT: 'draft',

    // Artwork is on auction (Auction V2)
    AUCTION: 'auction',

    // Auction ended, waiting for winner settlement
    SETTLEMENT_PENDING: 'settlement_pending',

    // Winner missed settlement; artwork remains unminted
    SETTLEMENT_DEFAULTED: 'settlement_defaulted',

    // Available for direct purchase (fixed price)
    DIRECT_SALE: 'direct_sale',

    // Artwork has been sold and minted
    SOLD: 'sold',

    // Owner removed from sale (still exists on blockchain)
    UNLISTED: 'unlisted',

    // Hidden from public view (soft delete, off-chain only)
    HIDDEN: 'hidden'
};

/**
 * Get user-friendly label for status
 */
export function getStatusLabel(status) {
    const labels = {
        [NFTStatus.DRAFT]: 'Draft',
        [NFTStatus.AUCTION]: 'Live Auction',
        [NFTStatus.SETTLEMENT_PENDING]: 'Awaiting settlement',
        [NFTStatus.SETTLEMENT_DEFAULTED]: 'Auction unsettled',
        [NFTStatus.DIRECT_SALE]: 'Listed for sale',
        [NFTStatus.SOLD]: 'Sold',
        [NFTStatus.UNLISTED]: 'Not listed',
        [NFTStatus.HIDDEN]: 'Hidden'
    };
    return labels[status] || status;
}

/**
 * Get status color for UI
 */
export function getStatusColor(status) {
    const colors = {
        [NFTStatus.DRAFT]: '#6b7280',           // gray
        [NFTStatus.AUCTION]: '#3b82f6',         // blue
        [NFTStatus.SETTLEMENT_PENDING]: '#f59e0b', // amber
        [NFTStatus.SETTLEMENT_DEFAULTED]: '#ef4444', // red
        [NFTStatus.DIRECT_SALE]: '#10b981',     // green
        [NFTStatus.SOLD]: '#8b5cf6',            // purple
        [NFTStatus.UNLISTED]: '#6b7280',        // gray
        [NFTStatus.HIDDEN]: '#374151'           // dark gray
    };
    return colors[status] || '#6b7280';
}

/**
 * Check if status is valid
 */
export function isValidStatus(status) {
    return Object.values(NFTStatus).includes(status);
}

/**
 * Get all statuses as array
 */
export function getAllStatuses() {
    return Object.values(NFTStatus);
}

// Make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.NFTStatus = NFTStatus;
    window.getStatusLabel = getStatusLabel;
    window.getStatusColor = getStatusColor;
    window.isValidStatus = isValidStatus;
}
