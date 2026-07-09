// ProfileButton Component
// "Go to Profile" button for quick navigation

class ProfileButton {
    constructor() {
        this.currentUser = null;
    }

    /**
     * Render profile button in specified container
     */
    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('ProfileButton: Container not found:', containerId);
            return;
        }

        const button = document.createElement('button');
        button.className = 'btn-main flex items-center gap-2';
        button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
            </svg>
            <span>Profile</span>
        `;

        button.onclick = () => this.goToProfile();
        container.appendChild(button);
    }

    /**
     * Navigate to profile
     */
    async goToProfile() {
        // Open the wallet modal on tap when not connected, then continue.
        const walletAddress = window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
        if (!walletAddress) return;

        window.location.href = 'profile.html';
    }

    /**
     * Set current user
     */
    setUser(address) {
        this.currentUser = address;
    }
}

// Export for use in other modules
export default ProfileButton;

// Also make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.ProfileButton = ProfileButton;
}
