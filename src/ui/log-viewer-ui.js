/**
 * Log Viewer UI - Debug Cockpit for System Logs
 *
 * Features:
 * - Real-time log display
 * - Filters (level, component, search)
 * - Auto-scroll
 * - Export logs
 * - Collapsible panel
 */

class LogViewerUI {
    constructor(logger) {
        this.logger = logger;
        this.container = null;
        this.isOpen = false;
        this.autoScroll = true;
        this.filters = {
            level: null,
            component: null,
            search: ''
        };

        this.init();
    }

    /**
     * Check if current user is admin
     */
    isAdmin() {
        const ADMIN_WALLETS = [
            '0x742d35cc6634c0532925a3b844bc9e7595f0beb2',
            '0xccb4f41c302141a22169543dffa5298ea8a08058'
        ];
        const currentWallet = window.getCurrentWalletAddress?.()?.toLowerCase();
        return currentWallet && ADMIN_WALLETS.includes(currentWallet);
    }

    /**
     * Initialize UI
     */
    init() {
        // Only initialize if user is admin
        if (!this.isAdmin()) {
            console.log('LogViewerUI: Not admin, skipping initialization');
            return;
        }

        this.createUI();
        this.attachListeners();
        this.setupKeyboardShortcuts();

        console.log(' LogViewerUI initialized');
    }

    /**
     * Create UI elements
     */
    createUI() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'logViewer';
        this.container.className = 'log-viewer';
        this.container.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 400px;
            background: rgba(0, 0, 0, 0.95);
            border-top: 2px solid var(--c-accent);
            z-index: 9999;
            display: none;
            flex-direction: column;
            font-family: 'Courier New', monospace;
            font-size: 12px;
        `;

        // Header
        const header = document.createElement('div');
        header.className = 'log-viewer-header';
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            background: rgba(var(--c-accent-rgb), 0.1);
            border-bottom: 1px solid var(--c-accent);
        `;

        const title = document.createElement('div');
        title.style.cssText = 'color: var(--c-accent); font-weight: bold; font-size: 14px;';
        title.textContent = ' System Logs';

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; gap: 10px; align-items: center;';

        // Level filter
        const levelFilter = this.createSelect('levelFilter', [
            { value: '', label: 'All Levels' },
            { value: 'INFO', label: 'INFO' },
            { value: 'WARN', label: 'WARN' },
            { value: 'ERROR', label: 'ERROR' }
        ]);

        // Component filter
        const componentFilter = this.createSelect('componentFilter', [
            { value: '', label: 'All Components' },
            { value: 'Queue', label: 'Queue' },
            { value: 'WAL', label: 'WAL' },
            { value: 'RateLimiter', label: 'RateLimiter' },
            { value: 'Database', label: 'Database' },
            { value: 'Theme', label: 'Theme' },
            { value: 'Navigation', label: 'Navigation' }
        ]);

        // Search input
        const searchInput = document.createElement('input');
        searchInput.id = 'logSearch';
        searchInput.type = 'text';
        searchInput.placeholder = 'Search logs...';
        searchInput.style.cssText = `
            padding: 5px 10px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid var(--c-accent);
            border-radius: 4px;
            color: var(--c-accent);
            width: 200px;
        `;

        // Auto-scroll toggle
        const autoScrollBtn = document.createElement('button');
        autoScrollBtn.id = 'autoScrollBtn';
        autoScrollBtn.textContent = '📜 Auto-scroll: ON';
        autoScrollBtn.style.cssText = this.getButtonStyle();

        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.id = 'clearLogsBtn';
        clearBtn.textContent = '🗑️ Clear';
        clearBtn.style.cssText = this.getButtonStyle();

        // Export button
        const exportBtn = document.createElement('button');
        exportBtn.id = 'exportLogsBtn';
        exportBtn.textContent = ' Export';
        exportBtn.style.cssText = this.getButtonStyle();

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.id = 'closeLogViewerBtn';
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = this.getButtonStyle();

        controls.appendChild(levelFilter);
        controls.appendChild(componentFilter);
        controls.appendChild(searchInput);
        controls.appendChild(autoScrollBtn);
        controls.appendChild(clearBtn);
        controls.appendChild(exportBtn);
        controls.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(controls);

        // Stats bar
        const statsBar = document.createElement('div');
        statsBar.id = 'logStats';
        statsBar.style.cssText = `
            padding: 5px 15px;
            background: rgba(var(--c-accent-rgb), 0.05);
            border-bottom: 1px solid rgba(var(--c-accent-rgb), 0.3);
            color: var(--c-accent);
            font-size: 11px;
        `;

        // Logs container
        const logsContainer = document.createElement('div');
        logsContainer.id = 'logsContainer';
        logsContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 10px 15px;
            color: var(--c-accent);
        `;

        this.container.appendChild(header);
        this.container.appendChild(statsBar);
        this.container.appendChild(logsContainer);

        document.body.appendChild(this.container);

        // Create toggle button
        this.createToggleButton();
    }

    /**
     * Create select element
     */
    createSelect(id, options) {
        const select = document.createElement('select');
        select.id = id;
        select.style.cssText = `
            padding: 5px 10px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid var(--c-accent);
            border-radius: 4px;
            color: var(--c-accent);
        `;

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });

        return select;
    }

    /**
     * Get button style
     */
    getButtonStyle() {
        return `
            padding: 5px 10px;
            background: rgba(var(--c-accent-rgb), 0.2);
            border: 1px solid var(--c-accent);
            border-radius: 4px;
            color: var(--c-accent);
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s;
        `;
    }

    /**
     * Create toggle button
     */
    createToggleButton() {
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'logViewerToggle';
        toggleBtn.textContent = ' Logs';
        toggleBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9998;
            padding: 10px 15px;
            background: rgba(var(--c-accent-rgb), 0.9);
            border: 2px solid var(--c-accent);
            border-radius: 8px;
            color: var(--c-bg);
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
            transition: all 0.3s;
        `;

        toggleBtn.onclick = () => this.toggle();

        document.body.appendChild(toggleBtn);
    }

    /**
     * Attach event listeners
     */
    attachListeners() {
        // Level filter
        document.getElementById('levelFilter').addEventListener('change', (e) => {
            this.filters.level = e.target.value || null;
            this.render();
        });

        // Component filter
        document.getElementById('componentFilter').addEventListener('change', (e) => {
            this.filters.component = e.target.value || null;
            this.render();
        });

        // Search
        document.getElementById('logSearch').addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.render();
        });

        // Auto-scroll toggle
        document.getElementById('autoScrollBtn').addEventListener('click', () => {
            this.autoScroll = !this.autoScroll;
            document.getElementById('autoScrollBtn').textContent =
                `📜 Auto-scroll: ${this.autoScroll ? 'ON' : 'OFF'}`;
        });

        // Clear logs
        document.getElementById('clearLogsBtn').addEventListener('click', () => {
            this.logger.clear();
            this.render();
        });

        // Export logs
        document.getElementById('exportLogsBtn').addEventListener('click', () => {
            this.logger.download();
        });

        // Close viewer
        document.getElementById('closeLogViewerBtn').addEventListener('click', () => {
            this.close();
        });

        // Listen for new logs
        this.logger.addListener((entry) => {
            this.addLogEntry(entry);
            this.updateStats();
        });
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+L to toggle (admin only)
            if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                if (this.isAdmin()) {
                    this.toggle();
                }
            }
        });
    }

    /**
     * Check if current user is admin
     */
    isAdmin() {
        // Admin wallet address (lowercase)
        const ADMIN_WALLET = '0x742d35cc6634c0532925a3b844bc9e7595f0beb2';

        // Get current wallet from ArtSoulApp
        const currentWallet = window.ArtSoulApp?.wallet?.toLowerCase();

        return currentWallet === ADMIN_WALLET;
    }

    /**
     * Toggle viewer
     */
    toggle() {
        // Only allow if admin
        if (!this.isAdmin()) {
            return;
        }

        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Open viewer
     */
    open() {
        this.container.style.display = 'flex';
        this.isOpen = true;
        this.render();
        console.log(' Log viewer opened');
    }

    /**
     * Close viewer
     */
    close() {
        this.container.style.display = 'none';
        this.isOpen = false;
        console.log(' Log viewer closed');
    }

    /**
     * Render logs
     */
    render() {
        const logsContainer = document.getElementById('logsContainer');
        logsContainer.innerHTML = '';

        const logs = this.logger.getLogs(this.filters);

        logs.forEach(log => {
            this.addLogEntry(log, false);
        });

        this.updateStats();

        if (this.autoScroll) {
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }
    }

    /**
     * Add log entry to UI
     */
    addLogEntry(log, shouldScroll = true) {
        const logsContainer = document.getElementById('logsContainer');

        const entry = document.createElement('div');
        entry.className = `log-entry log-${log.level.toLowerCase()}`;
        entry.style.cssText = `
            padding: 5px 0;
            border-bottom: 1px solid rgba(var(--c-accent-rgb), 0.1);
            font-size: 11px;
            line-height: 1.4;
        `;

        const timestamp = document.createElement('span');
        timestamp.style.cssText = 'color: #888; margin-right: 10px;';
        timestamp.textContent = new Date(log.timestamp).toLocaleTimeString();

        const level = document.createElement('span');
        level.style.cssText = `
            margin-right: 10px;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: bold;
            ${this.getLevelStyle(log.level)}
        `;
        level.textContent = log.level;

        const component = document.createElement('span');
        component.style.cssText = 'color: var(--c-accent); margin-right: 10px; font-weight: bold;';
        component.textContent = `[${log.component}]`;

        const message = document.createElement('span');
        message.style.cssText = 'color: #ccc;';
        message.textContent = log.message;

        entry.appendChild(timestamp);
        entry.appendChild(level);
        entry.appendChild(component);
        entry.appendChild(message);

        logsContainer.appendChild(entry);

        if (shouldScroll && this.autoScroll) {
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }
    }

    /**
     * Get level style
     */
    getLevelStyle(level) {
        switch (level) {
            case 'INFO':
                return 'background: rgba(0, 255, 0, 0.2); color: #0f0;';
            case 'WARN':
                return 'background: rgba(255, 255, 0, 0.2); color: #ff0;';
            case 'ERROR':
                return 'background: rgba(255, 0, 0, 0.2); color: #f00;';
            default:
                return 'background: rgba(255, 255, 255, 0.1); color: #fff;';
        }
    }

    /**
     * Update stats bar
     */
    updateStats() {
        const statsBar = document.getElementById('logStats');
        const stats = this.logger.getStats();

        statsBar.textContent = `Total: ${stats.total} | INFO: ${stats.byLevel.INFO} | WARN: ${stats.byLevel.WARN} | ERROR: ${stats.byLevel.ERROR}`;
    }
}

// Export
window.LogViewerUI = LogViewerUI;

console.log(' LogViewerUI module loaded');
