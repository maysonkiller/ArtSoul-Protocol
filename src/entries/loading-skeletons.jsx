import { React } from './react-runtime.js';

// Keep the pre-module and React loading frames identical. Historical export
// names remain compatible with page entries; no synthetic artwork is rendered.
const PLACEHOLDER = 'artsoul-placeholder';

// Delay visibility, not motion: fast responses never flash a loading frame.
function usePlaceholderClass(immediate) {
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        if (immediate) return;
        const timer = window.setTimeout(() => setReady(true), 320);
        return () => window.clearTimeout(timer);
    }, [immediate]);
    return immediate || ready ? '' : PLACEHOLDER;
}

function LoadingMark({ label }) {
    return (
        <div className="artsoul-wait" role="status" aria-label={label} aria-busy="true" aria-live="polite">
            <div className="artsoul-wait-mark" aria-hidden="true">
                <span className="artsoul-wait-word">ArtSoul</span>
                <span className="artsoul-wait-dots">
                    <span className="artsoul-wait-dot"></span>
                    <span className="artsoul-wait-dot"></span>
                    <span className="artsoul-wait-dot"></span>
                </span>
            </div>
        </div>
    );
}

export function CardGridSkeleton({
    className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3',
    immediate = false
}) {
    const placeholder = usePlaceholderClass(immediate);
    return (
        <div className={`${className} ${placeholder}`.trim()} role="status" aria-label="Loading artworks" aria-busy="true">
            <span className="col-span-full profile-gallery-loading-note">Loading artworks…</span>
        </div>
    );
}

export function ArtworkPageSkeleton({ immediate = false, artworkId = '' }) {
    const placeholder = usePlaceholderClass(immediate);
    return (
        <main className={`artsoul-wait-stage ${placeholder}`.trim()}>
            <LoadingMark label={artworkId ? `Loading artwork ${artworkId}` : 'Loading artwork'} />
        </main>
    );
}

export function ProfilePageSkeleton({ className = '', immediate = false }) {
    const placeholder = usePlaceholderClass(immediate);
    return (
        <main className={`artsoul-wait-stage ${className} ${placeholder}`.trim()}>
            <LoadingMark label="Loading profile" />
        </main>
    );
}
