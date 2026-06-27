// Performance Utilities
// Debounce, throttle, and optimization helpers

/**
 * Debounce function - delays execution until after wait time
 * Useful for search inputs, resize handlers
 */
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function - limits execution to once per wait time
 * Useful for scroll handlers, rapid clicks
 */
function throttle(func, wait = 300) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, wait);
        }
    };
}

/**
 * Prevent double clicks on buttons
 */
function preventDoubleClick(button, duration = 1000) {
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';

    setTimeout(() => {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
    }, duration);
}

/**
 * Add lazy loading to images
 */
function enableLazyLoading() {
    // Native lazy loading
    const images = document.querySelectorAll('img:not([loading])');
    images.forEach(img => {
        img.loading = 'lazy';
    });

    const videos = document.querySelectorAll('video:not([loading])');
    videos.forEach(video => {
        video.loading = 'lazy';
    });

    console.log(`Lazy loading enabled for ${images.length} images and ${videos.length} videos`);
}

/**
 * Optimize React re-renders
 * Call this to wrap expensive operations
 */
function optimizeReactRender(callback) {
    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
        callback();
    });
}

/**
 * Preload critical images
 */
function preloadCriticalImages(urls) {
    urls.forEach(url => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = url;
        document.head.appendChild(link);
    });
}

/**
 * Intersection Observer for lazy loading
 * More control than native lazy loading
 */
function setupIntersectionObserver() {
    const options = {
        root: null,
        rootMargin: '50px',
        threshold: 0.01
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const element = entry.target;

                // Load image
                if (element.dataset.src) {
                    element.src = element.dataset.src;
                    element.removeAttribute('data-src');
                }

                // Load background image
                if (element.dataset.bg) {
                    element.style.backgroundImage = `url(${element.dataset.bg})`;
                    element.removeAttribute('data-bg');
                }

                observer.unobserve(element);
            }
        });
    }, options);

    // Observe all elements with data-src or data-bg
    document.querySelectorAll('[data-src], [data-bg]').forEach(el => {
        observer.observe(el);
    });

    return observer;
}

/**
 * Reduce animation complexity on low-end devices
 */
function optimizeAnimations() {
    // Check if device prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
        document.body.classList.add('reduce-motion');
        console.log('Reduced motion enabled');
    }

    // Detect low-end device (simple heuristic)
    const isLowEnd = navigator.hardwareConcurrency <= 4 ||
                     navigator.deviceMemory <= 4;

    if (isLowEnd) {
        document.body.classList.add('low-end-device');
        console.log('Low-end device optimizations enabled');
    }
}

/**
 * Initialize all performance optimizations
 */
function initPerformanceOptimizations() {
    console.log('Initializing performance optimizations...');

    // Enable lazy loading
    enableLazyLoading();

    // Setup intersection observer
    setupIntersectionObserver();

    // Optimize animations
    optimizeAnimations();

    // Debounce window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            window.dispatchEvent(new Event('optimizedResize'));
        }, 150);
    });

    // Prevent rapid button clicks globally
    document.addEventListener('click', (e) => {
        const button = e.target.closest('button, [role="button"]');
        if (button && !button.disabled) {
            // Don't prevent if it's a toggle or has data-allow-rapid
            if (!button.dataset.allowRapid && !button.classList.contains('toggle')) {
                preventDoubleClick(button, 500);
            }
        }
    }, true);

    console.log('Performance optimizations initialized');
}

// Auto-initialize when DOM is ready
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPerformanceOptimizations);
    } else {
        initPerformanceOptimizations();
    }
}

// Export for use in other modules
export {
    debounce,
    throttle,
    preventDoubleClick,
    enableLazyLoading,
    optimizeReactRender,
    preloadCriticalImages,
    setupIntersectionObserver,
    optimizeAnimations,
    initPerformanceOptimizations
};

// Make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.PerformanceUtils = {
        debounce,
        throttle,
        preventDoubleClick,
        enableLazyLoading,
        optimizeReactRender,
        preloadCriticalImages
    };
}
