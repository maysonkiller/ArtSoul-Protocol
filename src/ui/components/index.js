// UI Components Index
// Export all UI components

import BackButton from './BackButton.js';
import ProfileButton from './ProfileButton.js';

/**
 * Initialize UI components
 */
function initializeUIComponents() {
    console.log(' Initializing UI components...');

    // Make components globally available
    window.BackButton = BackButton;
    window.ProfileButton = ProfileButton;

    console.log('UI components initialized');
}

// Auto-initialize when DOM is ready
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUIComponents);
    } else {
        initializeUIComponents();
    }
}

export { BackButton, ProfileButton, initializeUIComponents };
