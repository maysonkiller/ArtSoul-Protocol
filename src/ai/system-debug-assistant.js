/**
 * System AI Debug Assistant - Log Analysis Service
 *
 * Features:
 * - Error explanation (human-readable)
 * - Bottleneck detection
 * - Warning analysis
 * - Fix suggestions
 * - Severity assessment
 * - NO chat, NO training, stateless
 *
 * Input: logs/errors
 * Output: { explanation, severity, fix, category }
 */

class SystemDebugAssistant {
    constructor() {
        // Error pattern database
        this.errorPatterns = [
            {
                pattern: /ECONNREFUSED/i,
                category: 'connection',
                severity: 'high',
                explanation: 'Cannot connect to database or service',
                fix: 'Check if the service is running and connection string is correct'
            },
            {
                pattern: /ETIMEDOUT/i,
                category: 'connection',
                severity: 'high',
                explanation: 'Connection timed out',
                fix: 'Check network connectivity and increase timeout if needed'
            },
            {
                pattern: /duplicate key/i,
                category: 'data',
                severity: 'medium',
                explanation: 'Attempted to insert duplicate data',
                fix: 'Check idempotency key or use INSERT ... ON CONFLICT'
            },
            {
                pattern: /out of memory|heap out of memory/i,
                category: 'memory',
                severity: 'critical',
                explanation: 'System ran out of memory',
                fix: 'Reduce memory usage, increase heap size, or add memory limits'
            },
            {
                pattern: /queue full|backpressure/i,
                category: 'queue',
                severity: 'high',
                explanation: 'Queue is full or under backpressure',
                fix: 'Increase queue size, add more workers, or implement rate limiting'
            },
            {
                pattern: /WAL.*full|WAL.*limit/i,
                category: 'wal',
                severity: 'high',
                explanation: 'Write-Ahead Log reached size limit',
                fix: 'Increase WAL size limit or improve checkpoint frequency'
            },
            {
                pattern: /rate limit exceeded/i,
                category: 'rate_limit',
                severity: 'medium',
                explanation: 'Too many requests in short time',
                fix: 'Implement exponential backoff or reduce request rate'
            },
            {
                pattern: /transaction.*deadlock/i,
                category: 'database',
                severity: 'high',
                explanation: 'Database deadlock detected',
                fix: 'Retry transaction or reorder operations to avoid deadlock'
            },
            {
                pattern: /ENOSPC|no space left/i,
                category: 'disk',
                severity: 'critical',
                explanation: 'Disk is full',
                fix: 'Free up disk space or increase storage capacity'
            },
            {
                pattern: /permission denied|EACCES/i,
                category: 'permissions',
                severity: 'high',
                explanation: 'Insufficient permissions',
                fix: 'Check file/directory permissions or run with appropriate privileges'
            }
        ];

        // Warning patterns
        this.warningPatterns = [
            {
                pattern: /slow query|query took \d+ms/i,
                category: 'performance',
                severity: 'medium',
                explanation: 'Database query is slow',
                fix: 'Add indexes, optimize query, or use caching'
            },
            {
                pattern: /memory usage.*high/i,
                category: 'memory',
                severity: 'medium',
                explanation: 'Memory usage is high',
                fix: 'Monitor for memory leaks or increase available memory'
            },
            {
                pattern: /deprecated/i,
                category: 'code',
                severity: 'low',
                explanation: 'Using deprecated API or feature',
                fix: 'Update to recommended alternative'
            }
        ];

        // Bottleneck indicators
        this.bottleneckIndicators = [
            {
                pattern: /COUNT\(\*\).*spillover/i,
                category: 'database',
                explanation: 'Frequent COUNT(*) queries on large table',
                impact: 'high',
                fix: 'Use local counter with background sync'
            },
            {
                pattern: /fsync|fdatasync/i,
                category: 'io',
                explanation: 'Synchronous disk writes',
                impact: 'medium',
                fix: 'Batch writes or use async I/O if durability allows'
            },
            {
                pattern: /lock.*contention/i,
                category: 'concurrency',
                explanation: 'Lock contention detected',
                impact: 'high',
                fix: 'Reduce lock scope or use optimistic locking'
            }
        ];

        console.log(' SystemDebugAssistant initialized');
    }

    /**
     * Analyze error and provide explanation
     */
    analyzeError(error) {
        console.log(' Analyzing error:', error.message || error);

        const errorText = typeof error === 'string' ? error : error.message || error.toString();

        // Match against known patterns
        for (const pattern of this.errorPatterns) {
            if (pattern.pattern.test(errorText)) {
                return {
                    category: pattern.category,
                    severity: pattern.severity,
                    explanation: pattern.explanation,
                    fix: pattern.fix,
                    originalError: errorText,
                    matched: true
                };
            }
        }

        // Unknown error - provide generic analysis
        return this.analyzeUnknownError(errorText);
    }

    /**
     * Analyze unknown error
     */
    analyzeUnknownError(errorText) {
        let category = 'unknown';
        let severity = 'medium';
        let explanation = 'Unknown error occurred';
        let fix = 'Check logs for more details';

        // Try to infer category from keywords
        if (/network|socket|connection/i.test(errorText)) {
            category = 'connection';
            severity = 'high';
            explanation = 'Network or connection issue';
            fix = 'Check network connectivity and service availability';
        } else if (/database|sql|query/i.test(errorText)) {
            category = 'database';
            severity = 'high';
            explanation = 'Database operation failed';
            fix = 'Check database connection and query syntax';
        } else if (/file|ENOENT|EEXIST/i.test(errorText)) {
            category = 'filesystem';
            severity = 'medium';
            explanation = 'File system operation failed';
            fix = 'Check file path and permissions';
        } else if (/timeout/i.test(errorText)) {
            category = 'timeout';
            severity = 'high';
            explanation = 'Operation timed out';
            fix = 'Increase timeout or optimize operation';
        }

        return {
            category,
            severity,
            explanation,
            fix,
            originalError: errorText,
            matched: false
        };
    }

    /**
     * Analyze warning
     */
    analyzeWarning(warning) {
        console.log(' Analyzing warning:', warning);

        const warningText = typeof warning === 'string' ? warning : warning.message || warning.toString();

        // Match against known patterns
        for (const pattern of this.warningPatterns) {
            if (pattern.pattern.test(warningText)) {
                return {
                    category: pattern.category,
                    severity: pattern.severity,
                    explanation: pattern.explanation,
                    fix: pattern.fix,
                    originalWarning: warningText,
                    matched: true
                };
            }
        }

        // Unknown warning
        return {
            category: 'unknown',
            severity: 'low',
            explanation: 'Warning detected',
            fix: 'Review warning message for details',
            originalWarning: warningText,
            matched: false
        };
    }

    /**
     * Detect bottlenecks from logs
     */
    detectBottlenecks(logs) {
        console.log(' Detecting bottlenecks in', logs.length, 'logs');

        const bottlenecks = [];
        const seenCategories = new Set();

        for (const log of logs) {
            const logText = typeof log === 'string' ? log : log.message || log.toString();

            for (const indicator of this.bottleneckIndicators) {
                if (indicator.pattern.test(logText) && !seenCategories.has(indicator.category)) {
                    bottlenecks.push({
                        category: indicator.category,
                        explanation: indicator.explanation,
                        impact: indicator.impact,
                        fix: indicator.fix,
                        detectedIn: logText.substring(0, 100)
                    });
                    seenCategories.add(indicator.category);
                }
            }
        }

        return {
            detected: bottlenecks.length > 0,
            bottlenecks,
            count: bottlenecks.length
        };
    }

    /**
     * Analyze system health from logs
     */
    analyzeSystemHealth(logs) {
        console.log(' Analyzing system health from', logs.length, 'logs');

        const analysis = {
            errors: [],
            warnings: [],
            bottlenecks: [],
            healthScore: 100
        };

        // Categorize logs
        for (const log of logs) {
            const level = log.level || 'info';
            const message = log.message || log.toString();

            if (level === 'error') {
                const errorAnalysis = this.analyzeError(message);
                analysis.errors.push(errorAnalysis);

                // Deduct health score based on severity
                if (errorAnalysis.severity === 'critical') {
                    analysis.healthScore -= 20;
                } else if (errorAnalysis.severity === 'high') {
                    analysis.healthScore -= 10;
                } else {
                    analysis.healthScore -= 5;
                }
            } else if (level === 'warn') {
                const warningAnalysis = this.analyzeWarning(message);
                analysis.warnings.push(warningAnalysis);
                analysis.healthScore -= 2;
            }
        }

        // Detect bottlenecks
        const bottleneckAnalysis = this.detectBottlenecks(logs);
        analysis.bottlenecks = bottleneckAnalysis.bottlenecks;
        analysis.healthScore -= bottleneckAnalysis.count * 5;

        // Ensure health score is in range [0, 100]
        analysis.healthScore = Math.max(0, Math.min(100, analysis.healthScore));

        // Determine health level
        if (analysis.healthScore >= 90) {
            analysis.healthLevel = 'excellent';
        } else if (analysis.healthScore >= 70) {
            analysis.healthLevel = 'good';
        } else if (analysis.healthScore >= 50) {
            analysis.healthLevel = 'fair';
        } else if (analysis.healthScore >= 30) {
            analysis.healthLevel = 'poor';
        } else {
            analysis.healthLevel = 'critical';
        }

        return analysis;
    }

    /**
     * Generate system report
     */
    generateReport(logs) {
        console.log(' Generating system report');

        const health = this.analyzeSystemHealth(logs);

        // Build summary
        const summary = [];

        if (health.errors.length === 0 && health.warnings.length === 0 && health.bottlenecks.length === 0) {
            summary.push(' System is healthy - no issues detected');
        } else {
            if (health.errors.length > 0) {
                summary.push(` ${health.errors.length} error(s) detected`);
            }
            if (health.warnings.length > 0) {
                summary.push(` ${health.warnings.length} warning(s) detected`);
            }
            if (health.bottlenecks.length > 0) {
                summary.push(`🐌 ${health.bottlenecks.length} bottleneck(s) detected`);
            }
        }

        // Build recommendations
        const recommendations = [];

        // Critical errors first
        const criticalErrors = health.errors.filter(e => e.severity === 'critical');
        if (criticalErrors.length > 0) {
            recommendations.push({
                priority: 'critical',
                action: criticalErrors[0].fix,
                reason: criticalErrors[0].explanation
            });
        }

        // High-impact bottlenecks
        const highImpactBottlenecks = health.bottlenecks.filter(b => b.impact === 'high');
        if (highImpactBottlenecks.length > 0) {
            recommendations.push({
                priority: 'high',
                action: highImpactBottlenecks[0].fix,
                reason: highImpactBottlenecks[0].explanation
            });
        }

        // High severity errors
        const highErrors = health.errors.filter(e => e.severity === 'high');
        if (highErrors.length > 0 && recommendations.length < 3) {
            recommendations.push({
                priority: 'high',
                action: highErrors[0].fix,
                reason: highErrors[0].explanation
            });
        }

        return {
            summary: summary.join('. '),
            healthScore: health.healthScore,
            healthLevel: health.healthLevel,
            errors: health.errors,
            warnings: health.warnings,
            bottlenecks: health.bottlenecks,
            recommendations,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Quick diagnosis (single error/warning)
     */
    diagnose(input) {
        console.log(' Quick diagnosis');

        if (!input) {
            return {
                category: 'unknown',
                severity: 'low',
                explanation: 'No input provided',
                fix: 'Provide error message or log for analysis'
            };
        }

        const text = typeof input === 'string' ? input : input.message || input.toString();

        // Determine if error or warning
        if (/error|fail|exception/i.test(text)) {
            return this.analyzeError(text);
        } else if (/warn|warning/i.test(text)) {
            return this.analyzeWarning(text);
        } else {
            // Try error analysis first
            const errorAnalysis = this.analyzeError(text);
            if (errorAnalysis.matched) {
                return errorAnalysis;
            }

            // Try warning analysis
            const warningAnalysis = this.analyzeWarning(text);
            if (warningAnalysis.matched) {
                return warningAnalysis;
            }

            // Unknown
            return {
                category: 'unknown',
                severity: 'low',
                explanation: 'Unable to categorize message',
                fix: 'Review message manually',
                originalMessage: text
            };
        }
    }
}

// Export
window.SystemDebugAssistant = SystemDebugAssistant;

console.log(' SystemDebugAssistant module loaded');
