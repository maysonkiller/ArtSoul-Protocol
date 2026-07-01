import React from 'react';

function SkeletonBlock({ className = '' }) {
    return <div className={`artsoul-skeleton ${className}`.trim()} aria-hidden="true"></div>;
}

export function CardGridSkeleton({ count = 12, className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3' }) {
    return (
        <div className={className} role="status" aria-label="Loading artworks" aria-busy="true">
            {Array.from({ length: count }, (_, index) => (
                <div className="artsoul-skeleton-card" key={index} aria-hidden="true">
                    <SkeletonBlock className="artsoul-skeleton-media" />
                    <div className="artsoul-skeleton-card-copy">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-title" />
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-short" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ArtworkPageSkeleton() {
    return (
        <main className="artwork-page-shell" role="status" aria-label="Loading artwork" aria-busy="true">
            <div className="artwork-page-layout">
                <div className="artwork-page-left">
                    <header className="artwork-page-header artwork-mobile-header">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-heading" />
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-short" />
                    </header>
                    <section className="artwork-detail-stage artwork-mobile-media">
                        <SkeletonBlock className="artsoul-skeleton-media artwork-page-skeleton-media" />
                    </section>
                    <section className="artwork-page-panel artwork-page-ai artwork-mobile-ai">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-short" />
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-title" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                    </section>
                    <section className="artwork-page-panel artwork-page-description artwork-mobile-description">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-title" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                    </section>
                    <section className="artwork-page-panel artwork-page-trust artwork-mobile-trust">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-title" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                    </section>
                </div>
                <aside className="artwork-page-right">
                    <section className="artwork-page-panel artwork-mobile-auction">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-title" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-short" />
                        <SkeletonBlock className="artsoul-skeleton-button" />
                    </section>
                    <section className="artwork-page-panel artwork-mobile-people">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-title" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                    </section>
                </aside>
            </div>
        </main>
    );
}

export function ProfilePageSkeleton({ className = '' }) {
    return (
        <main className={`container mx-auto px-4 py-8 ${className}`.trim()} role="status" aria-label="Loading profile" aria-busy="true">
            <section className="profile-skeleton-header rounded-xl p-6 mb-6">
                <div className="profile-skeleton-identity">
                    <SkeletonBlock className="profile-skeleton-avatar" />
                    <div className="profile-skeleton-copy">
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-heading" />
                        <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-short" />
                        <SkeletonBlock className="artsoul-skeleton-line" />
                    </div>
                </div>
            </section>
            <section className="profile-skeleton-tabs rounded-xl p-6 mb-6">
                <SkeletonBlock className="artsoul-skeleton-line artsoul-skeleton-line-title" />
                <div className="profile-skeleton-tab-row">
                    {Array.from({ length: 4 }, (_, index) => <SkeletonBlock className="artsoul-skeleton-button" key={index} />)}
                </div>
            </section>
            <CardGridSkeleton count={6} />
        </main>
    );
}
