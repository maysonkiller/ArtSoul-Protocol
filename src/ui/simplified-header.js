/**
 * Simplified Header Component
 * Clean navigation without clutter
 */

(function() {
    console.log('Loading Simplified Header...');

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHeader);
    } else {
        initHeader();
    }

    function initHeader() {
        const header = document.querySelector('header');
        if (!header) return;

        // Add mobile menu toggle
        addMobileMenu(header);

        // Hide admin controls by default
        hideAdminControls();

        console.log('Simplified Header initialized');
    }

    function addMobileMenu(header) {
        // Check if burger menu already exists
        if (document.getElementById('mobile-menu-toggle')) return;

        // Create burger button
        const burgerBtn = document.createElement('button');
        burgerBtn.id = 'mobile-menu-toggle';
        burgerBtn.className = 'mobile-menu-toggle';
        burgerBtn.setAttribute('aria-label', 'Toggle menu');
        burgerBtn.innerHTML = `
            <span></span>
            <span></span>
            <span></span>
        `;

        // Create mobile menu overlay
        const mobileMenu = document.createElement('div');
        mobileMenu.id = 'mobile-menu';
        mobileMenu.className = 'mobile-menu';

        // Get navigation links
        const nav = header.querySelector('nav');
        if (nav) {
            const navClone = nav.cloneNode(true);
            mobileMenu.appendChild(navClone);
        }

        // Toggle functionality
        burgerBtn.addEventListener('click', () => {
            burgerBtn.classList.toggle('active');
            mobileMenu.classList.toggle('active');
            document.body.classList.toggle('menu-open');
        });

        // Close on link click
        mobileMenu.addEventListener('click', (e) => {
            if (e.target.tagName === 'A') {
                burgerBtn.classList.remove('active');
                mobileMenu.classList.remove('active');
                document.body.classList.remove('menu-open');
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!header.contains(e.target) && !mobileMenu.contains(e.target)) {
                burgerBtn.classList.remove('active');
                mobileMenu.classList.remove('active');
                document.body.classList.remove('menu-open');
            }
        });

        // Add to header
        const container = header.querySelector('.container') || header;
        container.insertBefore(burgerBtn, container.firstChild);
        document.body.appendChild(mobileMenu);
    }

    function hideAdminControls() {
        // Admin controls are now hidden by default
        // They will only show when admin wallet is connected
        // This is handled by admin-control-panel.js and log-viewer-ui.js
    }

    // Export for use in other scripts
    window.SimplifiedHeader = {
        init: initHeader
    };

    console.log('Simplified Header module loaded');
})();
