// Modal System for ArtSoul
// Replaces native alert() and confirm() with styled modals

(function() {
    'use strict';

    class ModalSystem {
        constructor() {
            this.currentModal = null;
            this.init();
        }

        init() {
            // Wait for DOM to be ready before creating container
            if (document.body) {
                this.createContainer();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    this.createContainer();
                });
            }
        }

        createContainer() {
            // Create modal container
            const container = document.createElement('div');
            container.id = 'modal-container';
            container.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                padding: 1rem;
            `;
            document.body.appendChild(container);
        }

        /**
         * Show alert modal
         * @param {string} message - Message to display
         * @param {string} title - Optional title (default: "Notice")
         * @returns {Promise<void>}
         */
        alert(message, title = 'Notice') {
            return new Promise((resolve) => {
                this.show({
                    title,
                    message,
                    buttons: [
                        {
                            text: 'OK',
                            primary: true,
                            onClick: () => {
                                this.close();
                                resolve();
                            }
                        }
                    ]
                });
            });
        }

        /**
         * Show confirm modal
         * @param {string} message - Message to display
         * @param {string} title - Optional title (default: "Confirm")
         * @returns {Promise<boolean>}
         */
        confirm(message, title = 'Confirm') {
            return new Promise((resolve) => {
                this.show({
                    title,
                    message,
                    buttons: [
                        {
                            text: 'Cancel',
                            primary: false,
                            onClick: () => {
                                this.close();
                                resolve(false);
                            }
                        },
                        {
                            text: 'OK',
                            primary: true,
                            onClick: () => {
                                this.close();
                                resolve(true);
                            }
                        }
                    ]
                });
            });
        }

        /**
         * Show custom modal
         * @param {Object} options - Modal options
         */
        show(options) {
            const { title, message, buttons } = options;
            const theme = localStorage.getItem('artsoul_theme') || 'classic';
            const isClassic = theme === 'classic';

            const container = document.getElementById('modal-container');

            // Backdrop
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
            `;
            backdrop.onclick = () => {
                // Close on backdrop click (same as Cancel)
                if (buttons.length > 1) {
                    buttons[0].onClick();
                }
            };

            // Modal
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.cssText = `
                position: relative;
                max-width: 500px;
                width: 100%;
                border-radius: 1rem;
                padding: 2rem;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                animation: modalSlideIn 0.3s ease-out;
                ${isClassic
                    ? 'background: #1a1a1a; border: 2px solid #4a4a4a; color: #a9ddd3;'
                    : 'background: #0a0a0a; border: 2px solid rgba(0, 245, 255, 0.3); color: #00f5ff; box-shadow: 0 0 40px rgba(0, 245, 255, 0.2), 0 20px 60px rgba(0, 0, 0, 0.5);'
                }
            `;

            // Title
            const titleEl = document.createElement('h2');
            titleEl.textContent = title;
            titleEl.style.cssText = `
                margin: 0 0 1rem 0;
                font-size: 1.5rem;
                font-weight: 600;
                ${!isClassic ? 'background: linear-gradient(90deg, #00f5ff, #bf00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;' : ''}
            `;

            // Message
            const messageEl = document.createElement('p');
            messageEl.textContent = message;
            messageEl.style.cssText = `
                margin: 0 0 2rem 0;
                font-size: 1rem;
                line-height: 1.6;
                opacity: 0.9;
                white-space: pre-wrap;
            `;

            // Buttons container
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = `
                display: flex;
                gap: 1rem;
                justify-content: flex-end;
            `;

            // Create buttons
            buttons.forEach(btn => {
                const button = document.createElement('button');
                button.textContent = btn.text;
                button.onclick = btn.onClick;
                button.style.cssText = `
                    padding: 1rem 2.5rem;
                    border-radius: 0.5rem;
                    font-size: 1.125rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: none;
                    min-width: 120px;
                    ${btn.primary
                        ? isClassic
                            ? 'background: #a9ddd3; color: #000; border: 2px solid #a9ddd3;'
                            : 'background: linear-gradient(135deg, #00f5ff, #bf00ff); color: #fff; border: 2px solid transparent; box-shadow: 0 0 20px rgba(0, 245, 255, 0.3);'
                        : isClassic
                            ? 'background: transparent; color: #a9ddd3; border: 2px solid #4a4a4a;'
                            : 'background: transparent; color: #00f5ff; border: 2px solid rgba(0, 245, 255, 0.3);'
                    }
                `;

                // Hover effects
                button.onmouseenter = () => {
                    if (btn.primary) {
                        button.style.transform = 'translateY(-2px)';
                        button.style.boxShadow = isClassic
                            ? '0 4px 12px rgba(169, 221, 211, 0.3)'
                            : '0 0 30px rgba(0, 245, 255, 0.5)';
                    } else {
                        button.style.background = isClassic
                            ? 'rgba(169, 221, 211, 0.1)'
                            : 'rgba(0, 245, 255, 0.1)';
                    }
                };

                button.onmouseleave = () => {
                    button.style.transform = 'translateY(0)';
                    button.style.boxShadow = btn.primary && !isClassic
                        ? '0 0 20px rgba(0, 245, 255, 0.3)'
                        : 'none';
                    if (!btn.primary) {
                        button.style.background = 'transparent';
                    }
                };

                buttonsContainer.appendChild(button);
            });

            // Assemble modal
            modal.appendChild(titleEl);
            modal.appendChild(messageEl);
            modal.appendChild(buttonsContainer);

            // Clear and show
            container.innerHTML = '';
            container.appendChild(backdrop);
            container.appendChild(modal);
            container.style.display = 'flex';

            this.currentModal = container;

            // Add animation keyframes if not exists
            if (!document.getElementById('modal-animations')) {
                const style = document.createElement('style');
                style.id = 'modal-animations';
                style.textContent = `
                    @keyframes modalSlideIn {
                        from {
                            opacity: 0;
                            transform: translateY(-20px) scale(0.95);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                `;
                document.head.appendChild(style);
            }
        }

        /**
         * Close current modal
         */
        close() {
            if (this.currentModal) {
                this.currentModal.style.display = 'none';
                this.currentModal.innerHTML = '';
                this.currentModal = null;
            }
        }
    }

    // Create singleton instance
    window.ArtSoulModal = new ModalSystem();

    // Override native alert and confirm
    window.alert = (message) => window.ArtSoulModal.alert(message);
    window.confirm = (message) => window.ArtSoulModal.confirm(message);

    console.log('📦 Modal System loaded');
})();
