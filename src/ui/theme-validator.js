/**
 * Theme Validator - Ensures all UI components follow theme
 *
 * Checks:
 * - Buttons
 * - Headers
 * - Dropdowns
 * - Avatar button
 * - Network badge
 * - Cards
 * - Modals
 */

class ThemeValidator {
    constructor(themeManager) {
        this.themeManager = themeManager;
        this.issues = [];
    }

    /**
     * Validate all components
     */
    validate() {
        this.issues = [];

        console.log('🔍 Starting theme validation...');

        this.validateButtons();
        this.validateHeaders();
        this.validateDropdowns();
        this.validateAvatarButton();
        this.validateNetworkBadge();
        this.validateCards();
        this.validateModals();

        this.reportResults();

        return this.issues.length === 0;
    }

    /**
     * Validate buttons
     */
    validateButtons() {
        const buttons = document.querySelectorAll('button, .btn, .button');
        const theme = this.themeManager.getTheme();

        buttons.forEach((btn, index) => {
            // Check if button has theme class or inherits from body
            const hasThemeClass = btn.classList.contains(theme);
            const parentHasTheme = btn.closest(`.${theme}`) !== null;
            const bodyHasTheme = document.body.classList.contains(theme);

            if (!hasThemeClass && !parentHasTheme && !bodyHasTheme) {
                this.issues.push({
                    type: 'button',
                    element: btn,
                    message: `Button #${index} missing theme class`,
                    severity: 'warning'
                });
            }
        });
    }

    /**
     * Validate headers
     */
    validateHeaders() {
        const headers = document.querySelectorAll('h1, h2, h3, h4, h5, h6, .header, .title');
        const theme = this.themeManager.getTheme();

        headers.forEach((header, index) => {
            const computedStyle = window.getComputedStyle(header);
            const color = computedStyle.color;

            // Check if color matches theme expectations
            if (theme === 'classic') {
                // Classic should have dark text
                if (color.includes('rgb(255') || color.includes('rgb(240')) {
                    this.issues.push({
                        type: 'header',
                        element: header,
                        message: `Header #${index} has light color in classic theme`,
                        severity: 'warning'
                    });
                }
            } else if (theme === 'future') {
                // Future should have light text
                if (color.includes('rgb(0') || color.includes('rgb(20')) {
                    this.issues.push({
                        type: 'header',
                        element: header,
                        message: `Header #${index} has dark color in future theme`,
                        severity: 'warning'
                    });
                }
            }
        });
    }

    /**
     * Validate dropdowns
     */
    validateDropdowns() {
        const dropdowns = document.querySelectorAll('.dropdown, select, .select');
        const theme = this.themeManager.getTheme();

        dropdowns.forEach((dropdown, index) => {
            const hasThemeClass = dropdown.classList.contains(theme);
            const parentHasTheme = dropdown.closest(`.${theme}`) !== null;

            if (!hasThemeClass && !parentHasTheme) {
                this.issues.push({
                    type: 'dropdown',
                    element: dropdown,
                    message: `Dropdown #${index} missing theme class`,
                    severity: 'warning'
                });
            }
        });
    }

    /**
     * Validate avatar button
     */
    validateAvatarButton() {
        const avatarBtn = document.querySelector('.avatar-button, #avatarButton, [class*="avatar"]');

        if (avatarBtn) {
            const theme = this.themeManager.getTheme();
            const hasThemeClass = avatarBtn.classList.contains(theme);
            const parentHasTheme = avatarBtn.closest(`.${theme}`) !== null;

            if (!hasThemeClass && !parentHasTheme) {
                this.issues.push({
                    type: 'avatar',
                    element: avatarBtn,
                    message: 'Avatar button missing theme class',
                    severity: 'error'
                });
            }
        }
    }

    /**
     * Validate network badge
     */
    validateNetworkBadge() {
        const networkBadge = document.querySelector('.network-badge, #networkBadge, [class*="network"]');

        if (networkBadge) {
            const theme = this.themeManager.getTheme();
            const hasThemeClass = networkBadge.classList.contains(theme);
            const parentHasTheme = networkBadge.closest(`.${theme}`) !== null;

            if (!hasThemeClass && !parentHasTheme) {
                this.issues.push({
                    type: 'network-badge',
                    element: networkBadge,
                    message: 'Network badge missing theme class',
                    severity: 'error'
                });
            }
        }
    }

    /**
     * Validate cards
     */
    validateCards() {
        const cards = document.querySelectorAll('.card, .nft-card, [class*="card"]');
        const theme = this.themeManager.getTheme();

        cards.forEach((card, index) => {
            const hasThemeClass = card.classList.contains(theme);
            const parentHasTheme = card.closest(`.${theme}`) !== null;

            if (!hasThemeClass && !parentHasTheme) {
                this.issues.push({
                    type: 'card',
                    element: card,
                    message: `Card #${index} missing theme class`,
                    severity: 'warning'
                });
            }
        });
    }

    /**
     * Validate modals
     */
    validateModals() {
        const modals = document.querySelectorAll('.modal, [class*="modal"]');
        const theme = this.themeManager.getTheme();

        modals.forEach((modal, index) => {
            const hasThemeClass = modal.classList.contains(theme);

            if (!hasThemeClass) {
                this.issues.push({
                    type: 'modal',
                    element: modal,
                    message: `Modal #${index} missing theme class`,
                    severity: 'error'
                });
            }
        });
    }

    /**
     * Report validation results
     */
    reportResults() {
        const errors = this.issues.filter(i => i.severity === 'error');
        const warnings = this.issues.filter(i => i.severity === 'warning');

        console.log(`🔍 Theme validation complete:`);
        console.log(`    Errors: ${errors.length}`);
        console.log(`     Warnings: ${warnings.length}`);

        if (errors.length > 0) {
            console.error('🔍 Theme errors found:');
            errors.forEach(issue => {
                console.error(`   - ${issue.type}: ${issue.message}`);
            });
        }

        if (warnings.length > 0) {
            console.warn('🔍 Theme warnings found:');
            warnings.forEach(issue => {
                console.warn(`   - ${issue.type}: ${issue.message}`);
            });
        }

        if (this.issues.length === 0) {
            console.log('🔍  All components follow theme correctly!');
        }
    }

    /**
     * Get validation report
     */
    getReport() {
        return {
            passed: this.issues.length === 0,
            errors: this.issues.filter(i => i.severity === 'error').length,
            warnings: this.issues.filter(i => i.severity === 'warning').length,
            issues: this.issues
        };
    }

    /**
     * Auto-fix issues (where possible)
     */
    autoFix() {
        const theme = this.themeManager.getTheme();
        let fixed = 0;

        this.issues.forEach(issue => {
            try {
                // Add theme class to element
                issue.element.classList.add(theme);
                fixed++;
            } catch (error) {
                console.error(`Failed to fix ${issue.type}:`, error);
            }
        });

        console.log(` Auto-fixed ${fixed} issues`);

        // Re-validate
        return this.validate();
    }
}

// Export
window.ThemeValidator = ThemeValidator;

console.log('🔍 ThemeValidator module loaded');
