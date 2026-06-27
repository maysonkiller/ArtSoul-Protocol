import { ARTWORK_STATES } from './types.js';

class VisibilityEngine {
    isVisibleInGallery(artworkData, state) {
        if (state === ARTWORK_STATES.DRAFT) return false;
        if (state === ARTWORK_STATES.SOLD) return false;

        if (artworkData && artworkData.hidden === true) return false;

        return true;
    }

    isFeatured(artworkData) {
        return artworkData && artworkData.featured === true;
    }

    isCurated(artworkData) {
        return artworkData && artworkData.curated === true;
    }

    filterForGallery(artworks, currentTime) {
        return artworks.filter(artwork => {
            return this.isVisibleInGallery(artwork.data, artwork.state);
        });
    }

    sortForGallery(artworks, currentTime) {
        return [...artworks].sort((a, b) => {
            if (a.data.featured && !b.data.featured) return -1;
            if (!a.data.featured && b.data.featured) return 1;

            if (a.data.curated && !b.data.curated) return -1;
            if (!a.data.curated && b.data.curated) return 1;

            if (a.state === ARTWORK_STATES.AUCTION && b.state === ARTWORK_STATES.AUCTION) {
                const aEndTime = a.metadata?.endTime || 0;
                const bEndTime = b.metadata?.endTime || 0;
                return aEndTime - bEndTime;
            }

            if (a.state === ARTWORK_STATES.AUCTION && b.state !== ARTWORK_STATES.AUCTION) return -1;
            if (a.state !== ARTWORK_STATES.AUCTION && b.state === ARTWORK_STATES.AUCTION) return 1;

            const aCreated = a.data.createdAt || 0;
            const bCreated = b.data.createdAt || 0;
            return bCreated - aCreated;
        });
    }
}

export default VisibilityEngine;
