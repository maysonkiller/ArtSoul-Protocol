/**
 * Admin Control Panel - System Operator Dashboard
 *
 * Features:
 * - Real-time system metrics
 * - Queue control (pause/resume/clear)
 * - WAL status and control
 * - Rate limiter status
 * - Memory usage
 * - Force recovery
 */

class AdminControlPanel {
    constructor() {
        this.container = null;
        this.isOpen = false;
        this.updateInterval = null;
        this.metrics = {
            queue: { size: 0, pending: 0, processing: 0 },
            wal: { size: 0, segments: 0, writes: 0 },
            rateLimiter: { tokens: 0, acquired: 0, rejected: 0 },
            memory: { used: 0, limit: 500 }
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
     * Initialize panel
     */
    init() {
        // Only initialize if user is admin
        if (!this.isAdmin()) {
            console.log('AdminControlPanel: Not admin, skipping initialization');
            return;
        }

        this.createUI();
        this.attachListeners();
        this.setupKeyboardShortcuts();

        console.log(' AdminControlPanel initialized');
    }

    /**
     * Create UI
     */
    createUI() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'adminPanel';
        this.container.className = 'admin-panel';
        this.container.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            width: 400px;
            max-height: 600px;
            background: rgba(0, 0, 0, 0.95);
            border: 2px solid var(--c-accent);
            border-radius: 12px;
            z-index: 9997;
            display: none;
            flex-direction: column;
            font-family: 'Inter', sans-serif;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background: rgba(var(--c-accent-rgb), 0.1);
            border-bottom: 1px solid var(--c-accent);
            border-radius: 10px 10px 0 0;
        `;

        const title = document.createElement('div');
        title.style.cssText = 'color: var(--c-accent); font-weight: bold; font-size: 16px;';
        title.textContent = ' Admin Control Panel';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = this.getButtonStyle();
        closeBtn.onclick = () => this.close();

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Content
        const content = document.createElement('div');
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        `;

        // Metrics sections
        content.appendChild(this.createQueueSection());
        content.appendChild(this.createWALSection());
        content.appendChild(this.createRateLimiterSection());
        content.appendChild(this.createMemorySection());
        content.appendChild(this.createControlsSection());

        this.container.appendChild(header);
        this.container.appendChild(content);

        document.body.appendChild(this.container);

        // Create toggle button
        this.createToggleButton();
    }

    /**
     * Create queue section
     */
    createQueueSection() {
        const section = this.createSection('Queue Status', 'queueSection');

        const metrics = document.createElement('div');
        metrics.id = 'queueMetrics';
        metrics.style.cssText = 'margin-bottom: 15px;';
        metrics.innerHTML = `
            <div class="metric-row">
                <span>Total Size:</span>
                <span id="queueSize" class="metric-value">0</span>
            </div>
            <div class="metric-row">
                <span>Pending:</span>
                <span id="queuePending" class="metric-value">0</span>
            </div>
            <div class="metric-row">
                <span>Processing:</span>
                <span id="queueProcessing" class="metric-value">0</span>
            </div>
        `;

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; gap: 10px;';

        const pauseBtn = this.createActionButton('⏸️ Pause', 'pauseQueue');
        const resumeBtn = this.createActionButton('▶️ Resume', 'resumeQueue');
        const clearBtn = this.createActionButton('🗑️ Clear', 'clearQueue', true);

        controls.appendChild(pauseBtn);
        controls.appendChild(resumeBtn);
        controls.appendChild(clearBtn);

        section.appendChild(metrics);
        section.appendChild(controls);

        return section;
    }

    /**
     * Create WAL section
     */
    createWALSection() {
        const section = this.createSection('WAL Status', 'walSection');

        const metrics = document.createElement('div');
        metrics.id = 'walMetrics';
        metrics.innerHTML = `
            <div class="metric-row">
                <span>Size:</span>
                <span id="walSize" class="metric-value">0 MB</span>
            </div>
            <div class="metric-row">
                <span>Segments:</span>
                <span id="walSegments" class="metric-value">0</span>
            </div>
            <div class="metric-row">
                <span>Writes:</span>
                <span id="walWrites" class="metric-value">0</span>
            </div>
            <div class="metric-row">
                <span>Status:</span>
                <span id="walStatus" class="metric-value status-ok">OK</span>
            </div>
        `;

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; gap: 10px; margin-top: 10px;';

        const recoveryBtn = this.createActionButton(' Force Recovery', 'forceRecovery', true);
        controls.appendChild(recoveryBtn);

        section.appendChild(metrics);
        section.appendChild(controls);

        return section;
    }

    /**
     * Create rate limiter section
     */
    createRateLimiterSection() {
        const section = this.createSection('Rate Limiter', 'rateLimiterSection');

        const metrics = document.createElement('div');
        metrics.id = 'rateLimiterMetrics';
        metrics.innerHTML = `
            <div class="metric-row">
                <span>Tokens:</span>
                <span id="rateLimiterTokens" class="metric-value">0 / 2000</span>
            </div>
            <div class="metric-row">
                <span>Acquired:</span>
                <span id="rateLimiterAcquired" class="metric-value">0</span>
            </div>
            <div class="metric-row">
                <span>Rejected:</span>
                <span id="rateLimiterRejected" class="metric-value">0</span>
            </div>
        `;

        section.appendChild(metrics);

        return section;
    }

    /**
     * Create memory section
     */
    createMemorySection() {
        const section = this.createSection('Memory Usage', 'memorySection');

        const metrics = document.createElement('div');
        metrics.id = 'memoryMetrics';
        metrics.innerHTML = `
            <div class="metric-row">
                <span>Heap Used:</span>
                <span id="memoryUsed" class="metric-value">0 MB</span>
            </div>
            <div class="metric-row">
                <span>Limit:</span>
                <span id="memoryLimit" class="metric-value">500 MB</span>
            </div>
        `;

        const progressBar = document.createElement('div');
        progressBar.style.cssText = `
            width: 100%;
            height: 20px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            margin-top: 10px;
            overflow: hidden;
        `;

        const progress = document.createElement('div');
        progress.id = 'memoryProgress';
        progress.style.cssText = `
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #0f0, #ff0, #f00);
            transition: width 0.3s ease;
        `;

        progressBar.appendChild(progress);
        section.appendChild(metrics);
        section.appendChild(progressBar);

        return section;
    }

    /**
     * Create controls section
     */
    createControlsSection() {
        const section = this.createSection('System Controls', 'controlsSection');

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

        const refreshBtn = this.createActionButton(' Refresh Metrics', 'refreshMetrics');
        const exportBtn = this.createActionButton(' Export Logs', 'exportLogs');

        controls.appendChild(refreshBtn);
        controls.appendChild(exportBtn);

        section.appendChild(controls);

        return section;
    }

    /**
     * Create section
     */
    createSection(title, id) {
        const section = document.createElement('div');
        section.id = id;
        section.style.cssText = `
            margin-bottom: 20px;
            padding: 15px;
            background: rgba(var(--c-accent-rgb), 0.05);
            border: 1px solid rgba(var(--c-accent-rgb), 0.2);
            border-radius: 8px;
        `;

        const sectionTitle = document.createElement('div');
        sectionTitle.style.cssText = `
            color: var(--c-accent);
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 10px;
        `;
        sectionTitle.textContent = title;

        section.appendChild(sectionTitle);

        // Add metric row styles
        const style = document.createElement('style');
        style.textContent = `
            .metric-row {
                display: flex;
                justify-content: space-between;
                padding: 5px 0;
                color: #ccc;
                font-size: 13px;
            }
            .metric-value {
                color: var(--c-accent);
                font-weight: bold;
            }
            .status-ok { color: #0f0; }
            .status-warning { color: #ff0; }
            .status-error { color: #f00; }
        `;
        document.head.appendChild(style);

        return section;
    }

    /**
     * Create action button
     */
    createActionButton(text, action, isDangerous = false) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            background: ${isDangerous ? 'rgba(255, 0, 0, 0.2)' : 'rgba(var(--c-accent-rgb), 0.2)'};
            border: 1px solid ${isDangerous ? '#f00' : 'var(--c-accent)'};
            border-radius: 6px;
            color: ${isDangerous ? '#f00' : 'var(--c-accent)'};
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
        `;

        btn.onclick = () => this.handleAction(action);

        return btn;
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
            font-size: 12px;
            transition: all 0.2s;
        `;
    }

    /**
     * Create toggle button
     */
    createToggleButton() {
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'adminPanelToggle';
        toggleBtn.textContent = ' Admin';
        toggleBtn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9996;
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
     * Attach listeners
     */
    attachListeners() {
        // Auto-update metrics when open
        this.updateInterval = setInterval(() => {
            if (this.isOpen) {
                this.updateMetrics();
            }
        }, 2000); // Update every 2 seconds
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+A to toggle (admin only)
            if (e.ctrlKey && e.shiftKey && e.key === 'A' && !e.target.matches('input, textarea')) {
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
     * Toggle panel
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
     * Open panel
     */
    open() {
        this.container.style.display = 'flex';
        this.isOpen = true;
        this.updateMetrics();
        console.log(' Admin panel opened');
    }

    /**
     * Close panel
     */
    close() {
        this.container.style.display = 'none';
        this.isOpen = false;
        console.log(' Admin panel closed');
    }

    /**
     * Update metrics
     */
    async updateMetrics() {
        // Simulate metrics (in real app, fetch from backend)
        this.metrics.queue.size = Math.floor(Math.random() * 1000);
        this.metrics.queue.pending = Math.floor(Math.random() * 500);
        this.metrics.queue.processing = Math.floor(Math.random() * 100);

        this.metrics.wal.size = (Math.random() * 50).toFixed(2);
        this.metrics.wal.segments = Math.floor(Math.random() * 10);
        this.metrics.wal.writes = Math.floor(Math.random() * 10000);

        this.metrics.rateLimiter.tokens = Math.floor(Math.random() * 2000);
        this.metrics.rateLimiter.acquired = Math.floor(Math.random() * 5000);
        this.metrics.rateLimiter.rejected = Math.floor(Math.random() * 100);

        this.metrics.memory.used = (Math.random() * 200).toFixed(2);

        // Update UI
        document.getElementById('queueSize').textContent = this.metrics.queue.size;
        document.getElementById('queuePending').textContent = this.metrics.queue.pending;
        document.getElementById('queueProcessing').textContent = this.metrics.queue.processing;

        document.getElementById('walSize').textContent = `${this.metrics.wal.size} MB`;
        document.getElementById('walSegments').textContent = this.metrics.wal.segments;
        document.getElementById('walWrites').textContent = this.metrics.wal.writes;

        const walStatus = document.getElementById('walStatus');
        if (this.metrics.wal.size < 80) {
            walStatus.textContent = 'OK';
            walStatus.className = 'metric-value status-ok';
        } else if (this.metrics.wal.size < 95) {
            walStatus.textContent = 'DEGRADED';
            walStatus.className = 'metric-value status-warning';
        } else {
            walStatus.textContent = 'FULL';
            walStatus.className = 'metric-value status-error';
        }

        document.getElementById('rateLimiterTokens').textContent = `${this.metrics.rateLimiter.tokens} / 2000`;
        document.getElementById('rateLimiterAcquired').textContent = this.metrics.rateLimiter.acquired;
        document.getElementById('rateLimiterRejected').textContent = this.metrics.rateLimiter.rejected;

        document.getElementById('memoryUsed').textContent = `${this.metrics.memory.used} MB`;

        const memoryPercent = (this.metrics.memory.used / this.metrics.memory.limit) * 100;
        document.getElementById('memoryProgress').style.width = `${memoryPercent}%`;
    }

    /**
     * Handle action
     */
    handleAction(action) {
        console.log(` Action: ${action}`);

        switch (action) {
            case 'pauseQueue':
                alert('Queue paused (simulated)');
                break;
            case 'resumeQueue':
                alert('Queue resumed (simulated)');
                break;
            case 'clearQueue':
                if (confirm('Are you sure you want to clear the queue? This cannot be undone.')) {
                    alert('Queue cleared (simulated)');
                }
                break;
            case 'forceRecovery':
                if (confirm('Force WAL recovery? This will replay all WAL segments.')) {
                    alert('Recovery started (simulated)');
                }
                break;
            case 'refreshMetrics':
                this.updateMetrics();
                break;
            case 'exportLogs':
                if (window.SystemLogger) {
                    window.SystemLogger.download();
                }
                break;
        }
    }
}

// Export
window.AdminControlPanel = AdminControlPanel;

console.log(' AdminControlPanel module loaded');
