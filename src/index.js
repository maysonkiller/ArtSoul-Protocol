// Services Index - Initialize and export all services
// This file sets up the service layer for the entire application

import AuctionService from './features/auction/auction-service.js';
import FileService from './features/artwork/file-service.js';
import ArtworkService from './features/artwork/artwork-service.js';
import { initializeUIComponents } from './ui/components/index.js';
import { NFTStatus, getStatusLabel, getStatusColor, isValidStatus } from './core/constants/nft-status.js';
import ErrorHandler from './core/utils/error-handler.js';
import LoadingHandler from './core/utils/loading-handler.js';
import {
    debounce,
    throttle,
    preventDoubleClick,
    enableLazyLoading,
    optimizeReactRender,
    preloadCriticalImages,
    setupIntersectionObserver,
    optimizeAnimations,
    initPerformanceOptimizations
} from './core/utils/performance-utils.js';
import './ai/index.js';
import './ui/ai-evaluation-panel.js';

/**
 * Initialize all services
 * Call this after contracts and supabase are initialized
 */
function initializeServices() {
    console.log('Initializing services...');

    // Check dependencies
    if (!window.ArtSoulContracts) {
        console.error('ArtSoulContracts not found. Load contracts-integration.js first.');
        return false;
    }

    if (!window.ArtSoulDB) {
        console.error('ArtSoulDB not found. Load supabase-client.js first.');
        return false;
    }

    try {
        // Make NFTStatus available globally
        window.NFTStatus = NFTStatus;
        window.getStatusLabel = getStatusLabel;
        window.getStatusColor = getStatusColor;
        window.isValidStatus = isValidStatus;
        console.log('NFTStatus constants initialized');

        // Initialize FileService (no dependencies)
        window.FileService = new FileService();
        console.log('FileService initialized');

        // Initialize AuctionService (depends on contracts)
        window.AuctionService = new AuctionService(window.ArtSoulContracts);
        console.log('AuctionService initialized');

        // Initialize ArtworkService (depends on supabase and auction service)
        window.ArtworkService = new ArtworkService(
            window.ArtSoulDB,
            window.AuctionService
        );
        console.log('ArtworkService initialized');

        // Initialize UI components
        initializeUIComponents();

        console.log('All services initialized successfully');
        return true;
    } catch (error) {
        console.error('Failed to initialize services:', error);
        return false;
    }
}

async function initializeServicesWhenReady(maxWaitMs = 10000, pollMs = 50) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        if (window.ArtSoulContracts && window.ArtSoulDB) {
            return initializeServices();
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    console.error('ArtSoul runtime dependencies did not initialize in time.');
    return false;
}

// Auto-initialize when DOM is ready
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            void initializeServicesWhenReady();
        });
    } else {
        void initializeServicesWhenReady();
    }
}

// Export for manual initialization if needed
export {
    initializeServices,
    initializeServicesWhenReady,
    AuctionService,
    FileService,
    ArtworkService,
    NFTStatus,
    ErrorHandler,
    LoadingHandler
};
