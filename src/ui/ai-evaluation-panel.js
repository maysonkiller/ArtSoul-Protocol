/**
 * AI Evaluation Panel
 *
 * UI component to display AI insights:
 * - NFT valuation
 * - Auction analysis
 * - System diagnostics
 *
 * Keyboard: Ctrl+I (AI Insights)
 */

class AIEvaluationPanel {
    constructor() {
        this.isVisible = false;
        this.panel = null;
        this.currentTab = 'nft'; // nft, auction, system

        this.init();
        console.log('🤖 AIEvaluationPanel initialized');
    }

    init() {
        // Create panel
        this.createPanel();

        // Keyboard shortcut: Ctrl+I
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'i') {
                e.preventDefault();
                this.toggle();
            }
        });
    }

    createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'ai-evaluation-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            background: var(--bg-primary, #1a1a1a);
            border: 2px solid var(--accent-primary, #00ff88);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 255, 136, 0.3);
            z-index: 10000;
            display: none;
            flex-direction: column;
            overflow: hidden;
        `;

        this.panel.innerHTML = `
            <div style="padding: 20px; border-bottom: 1px solid var(--accent-primary, #00ff88);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; color: var(--text-primary, #fff); font-size: 24px;">
                        🤖 AI Insights
                    </h2>
                    <button id="ai-panel-close" style="
                        background: transparent;
                        border: none;
                        color: var(--text-primary, #fff);
                        font-size: 24px;
                        cursor: pointer;
                        padding: 0;
                        width: 32px;
                        height: 32px;
                    ">×</button>
                </div>
                <div style="margin-top: 15px; display: flex; gap: 10px;">
                    <button class="ai-tab" data-tab="nft" style="
                        padding: 8px 16px;
                        background: var(--accent-primary, #00ff88);
                        color: var(--bg-primary, #1a1a1a);
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: bold;
                    ">NFT Valuation</button>
                    <button class="ai-tab" data-tab="auction" style="
                        padding: 8px 16px;
                        background: transparent;
                        color: var(--text-primary, #fff);
                        border: 1px solid var(--accent-primary, #00ff88);
                        border-radius: 6px;
                        cursor: pointer;
                    ">Auction Analysis</button>
                    <button class="ai-tab" data-tab="system" style="
                        padding: 8px 16px;
                        background: transparent;
                        color: var(--text-primary, #fff);
                        border: 1px solid var(--accent-primary, #00ff88);
                        border-radius: 6px;
                        cursor: pointer;
                    ">System Diagnostics</button>
                </div>
            </div>
            <div id="ai-panel-content" style="
                padding: 20px;
                overflow-y: auto;
                flex: 1;
                color: var(--text-primary, #fff);
            ">
                <p style="color: var(--text-secondary, #888);">Select a tab to view AI insights</p>
            </div>
        `;

        document.body.appendChild(this.panel);

        // Event listeners
        this.panel.querySelector('#ai-panel-close').addEventListener('click', () => this.hide());

        this.panel.querySelectorAll('.ai-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    show() {
        this.panel.style.display = 'flex';
        this.isVisible = true;
        this.loadCurrentTab();
    }

    hide() {
        this.panel.style.display = 'none';
        this.isVisible = false;
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        // Update tab styles
        this.panel.querySelectorAll('.ai-tab').forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.style.background = 'var(--accent-primary, #00ff88)';
                tab.style.color = 'var(--bg-primary, #1a1a1a)';
                tab.style.border = 'none';
            } else {
                tab.style.background = 'transparent';
                tab.style.color = 'var(--text-primary, #fff)';
                tab.style.border = '1px solid var(--accent-primary, #00ff88)';
            }
        });

        this.loadCurrentTab();
    }

    loadCurrentTab() {
        const content = this.panel.querySelector('#ai-panel-content');

        switch (this.currentTab) {
            case 'nft':
                this.loadNFTValuation(content);
                break;
            case 'auction':
                this.loadAuctionAnalysis(content);
                break;
            case 'system':
                this.loadSystemDiagnostics(content);
                break;
        }
    }

    async loadNFTValuation(content) {
        content.innerHTML = `
            <h3 style="margin-top: 0;">NFT Price Estimation</h3>
            <p style="color: var(--text-secondary, #888); margin-bottom: 20px;">
                Analyze NFT artwork and estimate market value
            </p>
            <button id="ai-demo-nft" style="
                padding: 10px 20px;
                background: var(--accent-primary, #00ff88);
                color: var(--bg-primary, #1a1a1a);
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: bold;
            ">Run Demo Evaluation</button>
            <div id="ai-nft-result" style="margin-top: 20px;"></div>
        `;

        content.querySelector('#ai-demo-nft').addEventListener('click', async () => {
            const resultDiv = content.querySelector('#ai-nft-result');
            resultDiv.innerHTML = '<p style="color: var(--text-secondary, #888);">Analyzing...</p>';

            // Demo NFT
            const demoNFT = {
                name: 'Cyberpunk Sunset #42',
                traits: {
                    style: 'cyberpunk',
                    colors: ['#ff00ff', '#00ffff', '#ff0080', '#0080ff', '#ffff00', '#00ff00'],
                    detail: 'high',
                    rarity: 'rare',
                    unique: ['holographic', 'animated']
                },
                metadata: {
                    resolution: '2048x2048',
                    format: 'png'
                },
                artist: {
                    verified: true
                },
                category: 'art',
                edition: {
                    total: 50
                }
            };

            const result = await window.AIServices.evaluateNFT(demoNFT);

            resultDiv.innerHTML = `
                <div style="background: rgba(0, 255, 136, 0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--accent-primary, #00ff88);">
                    <h4 style="margin-top: 0;">Estimated Price Range</h4>
                    <p style="font-size: 24px; font-weight: bold; color: var(--accent-primary, #00ff88); margin: 10px 0;">
                        ${result.priceRange.min} - ${result.priceRange.max} ${result.priceRange.currency}
                    </p>
                    <p style="color: var(--text-secondary, #888);">
                        Confidence: ${result.confidence.score}% (${result.confidence.level})
                    </p>
                </div>

                <h4 style="margin-top: 20px;">Analysis Breakdown</h4>
                ${result.reasons.map(reason => `
                    <div style="margin-bottom: 15px; padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <strong>${reason.category}</strong>
                            <span style="
                                padding: 2px 8px;
                                border-radius: 4px;
                                font-size: 12px;
                                background: ${reason.impact === 'positive' ? 'rgba(0, 255, 136, 0.2)' : reason.impact === 'negative' ? 'rgba(255, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)'};
                                color: ${reason.impact === 'positive' ? '#00ff88' : reason.impact === 'negative' ? '#ff0000' : '#888'};
                            ">${reason.impact}</span>
                        </div>
                        <ul style="margin: 5px 0; padding-left: 20px; color: var(--text-secondary, #888);">
                            ${reason.details.map(detail => `<li>${detail}</li>`).join('')}
                        </ul>
                    </div>
                `).join('')}

                <h4 style="margin-top: 20px;">Score Breakdown</h4>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                    <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px;">Style</div>
                        <div style="font-size: 20px; font-weight: bold;">${(result.breakdown.style * 100).toFixed(0)}%</div>
                    </div>
                    <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px;">Rarity</div>
                        <div style="font-size: 20px; font-weight: bold;">${(result.breakdown.rarity * 100).toFixed(0)}%</div>
                    </div>
                    <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px;">Quality</div>
                        <div style="font-size: 20px; font-weight: bold;">${(result.breakdown.quality * 100).toFixed(0)}%</div>
                    </div>
                    <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px;">Market</div>
                        <div style="font-size: 20px; font-weight: bold;">${(result.breakdown.market * 100).toFixed(0)}%</div>
                    </div>
                </div>
            `;
        });
    }

    async loadAuctionAnalysis(content) {
        content.innerHTML = `
            <h3 style="margin-top: 0;">Auction Bid Analysis</h3>
            <p style="color: var(--text-secondary, #888); margin-bottom: 20px;">
                Analyze bid patterns and detect market manipulation
            </p>
            <button id="ai-demo-auction" style="
                padding: 10px 20px;
                background: var(--accent-primary, #00ff88);
                color: var(--bg-primary, #1a1a1a);
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: bold;
            ">Run Demo Analysis</button>
            <div id="ai-auction-result" style="margin-top: 20px;"></div>
        `;

        content.querySelector('#ai-demo-auction').addEventListener('click', async () => {
            const resultDiv = content.querySelector('#ai-auction-result');
            resultDiv.innerHTML = '<p style="color: var(--text-secondary, #888);">Analyzing...</p>';

            // Demo auction with suspicious activity
            const now = Date.now();
            const demoAuction = {
                id: 'auction-123',
                startingPrice: 0.5,
                bids: [
                    { bidder: '0xaaa', amount: 0.6, timestamp: now - 300000 },
                    { bidder: '0xbbb', amount: 0.7, timestamp: now - 240000 },
                    { bidder: '0xaaa', amount: 0.8, timestamp: now - 180000 },
                    { bidder: '0xccc', amount: 0.9, timestamp: now - 120000 },
                    { bidder: '0xaaa', amount: 1.0, timestamp: now - 60000 },
                    { bidder: '0xaaa', amount: 1.2, timestamp: now - 30000 },
                    { bidder: '0xaaa', amount: 1.5, timestamp: now - 10000 },
                    { bidder: '0xaaa', amount: 2.0, timestamp: now - 5000 }
                ]
            };

            const result = await window.AIServices.analyzeAuction(demoAuction);

            const trendEmoji = {
                'bullish': '',
                'rising': '↗️',
                'volatile': '',
                'stable': '➡️',
                'moderate': '↗️'
            };

            const signalEmoji = {
                'entry': '',
                'wait': '⏸️',
                'hold': '⏳',
                'caution': '',
                'avoid': '🚫'
            };

            resultDiv.innerHTML = `
                <div style="background: rgba(0, 255, 136, 0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--accent-primary, #00ff88); margin-bottom: 20px;">
                    <h4 style="margin-top: 0;">Market Signal</h4>
                    <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">
                        ${signalEmoji[result.signal.action]} ${result.signal.action.toUpperCase()}
                    </p>
                    <p style="color: var(--text-secondary, #888);">
                        Confidence: ${(result.signal.confidence * 100).toFixed(0)}%
                    </p>
                    <p style="margin-top: 10px;">${result.signal.reason}</p>
                </div>

                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px; margin-bottom: 5px;">Trend</div>
                        <div style="font-size: 20px; font-weight: bold;">
                            ${trendEmoji[result.trend]} ${result.trend}
                        </div>
                    </div>
                    <div style="padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px; margin-bottom: 5px;">Risk Level</div>
                        <div style="font-size: 20px; font-weight: bold; color: ${result.risk.level === 'high' ? '#ff0000' : result.risk.level === 'medium' ? '#ffaa00' : '#00ff88'};">
                            ${result.risk.level.toUpperCase()}
                        </div>
                    </div>
                </div>

                <h4>Analysis</h4>
                <p style="padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; line-height: 1.6;">
                    ${result.explanation}
                </p>

                ${result.risk.factors.length > 0 ? `
                    <h4 style="margin-top: 20px;">Risk Factors</h4>
                    <ul style="margin: 0; padding-left: 20px; color: var(--text-secondary, #888);">
                        ${result.risk.factors.map(factor => `<li style="margin-bottom: 8px;">${factor}</li>`).join('')}
                    </ul>
                ` : ''}

                <h4 style="margin-top: 20px;">Auction Metrics</h4>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px;">Total Bids</div>
                        <div style="font-size: 20px; font-weight: bold;">${result.metadata.totalBids}</div>
                    </div>
                    <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px;">Velocity</div>
                        <div style="font-size: 20px; font-weight: bold;">${result.metadata.velocity.toFixed(1)}/min</div>
                    </div>
                    <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                        <div style="color: var(--text-secondary, #888); font-size: 12px;">Price Range</div>
                        <div style="font-size: 20px; font-weight: bold;">${result.metadata.priceRange.min}-${result.metadata.priceRange.max}</div>
                    </div>
                </div>
            `;
        });
    }

    loadSystemDiagnostics(content) {
        content.innerHTML = `
            <h3 style="margin-top: 0;">System Health Diagnostics</h3>
            <p style="color: var(--text-secondary, #888); margin-bottom: 20px;">
                Analyze system logs and detect issues
            </p>
            <button id="ai-demo-system" style="
                padding: 10px 20px;
                background: var(--accent-primary, #00ff88);
                color: var(--bg-primary, #1a1a1a);
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: bold;
            ">Run System Analysis</button>
            <div id="ai-system-result" style="margin-top: 20px;"></div>
        `;

        content.querySelector('#ai-demo-system').addEventListener('click', () => {
            const resultDiv = content.querySelector('#ai-system-result');
            resultDiv.innerHTML = '<p style="color: var(--text-secondary, #888);">Analyzing...</p>';

            // Get logs from SystemLogger if available
            const logs = window.SystemLogger ? window.SystemLogger.getLogs() : [
                { level: 'info', message: 'System started', timestamp: Date.now() - 60000 },
                { level: 'warn', message: 'Memory usage high: 450MB', timestamp: Date.now() - 30000 },
                { level: 'error', message: 'ECONNREFUSED: Connection refused to database', timestamp: Date.now() - 10000 }
            ];

            const report = window.AIServices.generateHealthReport(logs);

            const healthColor = {
                'excellent': '#00ff88',
                'good': '#88ff00',
                'fair': '#ffaa00',
                'poor': '#ff6600',
                'critical': '#ff0000'
            };

            resultDiv.innerHTML = `
                <div style="background: rgba(0, 255, 136, 0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--accent-primary, #00ff88); margin-bottom: 20px;">
                    <h4 style="margin-top: 0;">System Health Score</h4>
                    <p style="font-size: 48px; font-weight: bold; color: ${healthColor[report.healthLevel]}; margin: 10px 0;">
                        ${report.healthScore}/100
                    </p>
                    <p style="color: var(--text-secondary, #888); text-transform: uppercase;">
                        ${report.healthLevel}
                    </p>
                </div>

                <h4>Summary</h4>
                <p style="padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">
                    ${report.summary}
                </p>

                ${report.recommendations.length > 0 ? `
                    <h4 style="margin-top: 20px;">Recommendations</h4>
                    ${report.recommendations.map(rec => `
                        <div style="padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; margin-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <strong>${rec.reason}</strong>
                                <span style="
                                    padding: 2px 8px;
                                    border-radius: 4px;
                                    font-size: 12px;
                                    background: ${rec.priority === 'critical' ? 'rgba(255, 0, 0, 0.2)' : 'rgba(255, 170, 0, 0.2)'};
                                    color: ${rec.priority === 'critical' ? '#ff0000' : '#ffaa00'};
                                ">${rec.priority.toUpperCase()}</span>
                            </div>
                            <p style="margin: 0; color: var(--text-secondary, #888);">${rec.action}</p>
                        </div>
                    `).join('')}
                ` : ''}

                ${report.errors.length > 0 ? `
                    <h4 style="margin-top: 20px;">Errors (${report.errors.length})</h4>
                    ${report.errors.slice(0, 3).map(error => `
                        <div style="padding: 10px; background: rgba(255, 0, 0, 0.1); border-left: 3px solid #ff0000; border-radius: 4px; margin-bottom: 10px;">
                            <div style="font-weight: bold; margin-bottom: 5px;">${error.category} - ${error.severity}</div>
                            <div style="color: var(--text-secondary, #888); font-size: 14px; margin-bottom: 5px;">${error.explanation}</div>
                            <div style="color: var(--accent-primary, #00ff88); font-size: 14px;"> ${error.fix}</div>
                        </div>
                    `).join('')}
                ` : ''}

                ${report.warnings.length > 0 ? `
                    <h4 style="margin-top: 20px;">Warnings (${report.warnings.length})</h4>
                    ${report.warnings.slice(0, 3).map(warning => `
                        <div style="padding: 10px; background: rgba(255, 170, 0, 0.1); border-left: 3px solid #ffaa00; border-radius: 4px; margin-bottom: 10px;">
                            <div style="font-weight: bold; margin-bottom: 5px;">${warning.category}</div>
                            <div style="color: var(--text-secondary, #888); font-size: 14px; margin-bottom: 5px;">${warning.explanation}</div>
                            <div style="color: var(--accent-primary, #00ff88); font-size: 14px;"> ${warning.fix}</div>
                        </div>
                    `).join('')}
                ` : ''}

                ${report.bottlenecks.length > 0 ? `
                    <h4 style="margin-top: 20px;">Bottlenecks (${report.bottlenecks.length})</h4>
                    ${report.bottlenecks.map(bottleneck => `
                        <div style="padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 4px; margin-bottom: 10px;">
                            <div style="font-weight: bold; margin-bottom: 5px;">${bottleneck.category} - ${bottleneck.impact} impact</div>
                            <div style="color: var(--text-secondary, #888); font-size: 14px; margin-bottom: 5px;">${bottleneck.explanation}</div>
                            <div style="color: var(--accent-primary, #00ff88); font-size: 14px;"> ${bottleneck.fix}</div>
                        </div>
                    `).join('')}
                ` : ''}
            `;
        });
    }
}

// Initialize on load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        window.AIEvaluationPanel = new AIEvaluationPanel();
    });
}

console.log('🤖 AIEvaluationPanel module loaded');
