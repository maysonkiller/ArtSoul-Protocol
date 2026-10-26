import { React, createRoot } from './react-runtime.js';
import '../../docs-protocol.css';
import { PROTOCOL_DOC_SECTIONS as sections } from '../content/protocol-docs.js';

const { useEffect, useState } = React;

const Chevron = ({ className = '' }) => (
    <svg className={`protocol-chevron ${className}`} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M4 6l4 4 4-4"></path>
    </svg>
);

function ProtocolBlock({ block }) {
    if (block.type === 'paragraph') return <p>{block.text}</p>;
    if (block.type === 'formula') return <div className="protocol-formula">{block.text}</div>;
    if (block.type === 'ordered-list') return <ol>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ol>;
    if (block.type === 'table') return (
        <div className="protocol-table-wrap">
            <table>
                <thead><tr>{block.headings.map((heading, index) => <th key={index}>{heading}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
            </table>
        </div>
    );
    if (block.type === 'faq') return (
        <div className="protocol-faq">
            {block.items.map((item, index) => <React.Fragment key={index}><h3>{item.question}</h3><p>{item.answer}</p></React.Fragment>)}
        </div>
    );
    return null;
}

function ProtocolSection({ section, isOpen, onToggle }) {
    return (
        <section id={section.id} className={`protocol-section${isOpen ? ' is-open' : ''}`}>
            <button className="protocol-section-trigger" type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={`${section.id}-content`}>
                <span>{section.title}</span>
                <Chevron />
            </button>
            <div id={`${section.id}-content`} className="protocol-section-body" hidden={!isOpen}>
                {section.blocks.map((block, index) => <ProtocolBlock key={index} block={block} />)}
            </div>
        </section>
    );
}

function ProtocolDocsApp() {
    const [openSections, setOpenSections] = useState(() => ({ 'what-is-artsoul': true }));
    const [navOpen, setNavOpen] = useState(false);

    useEffect(() => {
        let frame;
        const reveal = hash => {
            cancelAnimationFrame(frame);
            const id = hash.slice(1);
            if (!sections.some(section => section.id === id)) return;
            setOpenSections(previous => ({ ...previous, [id]: true }));
            setNavOpen(false);
            frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
        };
        const onHashChange = () => reveal(window.location.hash);
        const onAnchorClick = event => {
            if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const link = event.target.closest?.('a[href]');
            if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
            const target = new URL(link.href, window.location.href);
            if (target.origin !== window.location.origin || !['/docs-protocol', '/docs-protocol.html'].includes(target.pathname)) return;
            // Reopening the current section hash does not emit hashchange.
            if (target.hash === window.location.hash) reveal(target.hash);
        };
        onHashChange();
        window.addEventListener('hashchange', onHashChange);
        document.addEventListener('click', onAnchorClick);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('hashchange', onHashChange);
            document.removeEventListener('click', onAnchorClick);
        };
    }, []);

    const openFromNav = (id) => {
        setOpenSections(previous => ({ ...previous, [id]: true }));
        setNavOpen(false);
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    return (
        <main className="protocol-docs-shell site-page-container">
            <div className="protocol-docs-intro">
                <p className="protocol-eyebrow">ArtSoul</p>
                <h1>Protocol Docs</h1>
                <p>Everything users need to publish, discover, bid, settle, collect, and resell artwork through ArtSoul.</p>
            </div>

            <button className="protocol-nav-toggle" type="button" onClick={() => setNavOpen(value => !value)} aria-expanded={navOpen} aria-controls="protocolSideNav">
                <span>On this page</span>
                <Chevron />
            </button>

            <div className="protocol-docs-layout">
                <aside id="protocolSideNav" className={`protocol-side-nav${navOpen ? ' is-open' : ''}`} aria-label="Protocol documentation sections">
                    <p>On this page</p>
                    <nav>
                        {sections.map(section => (
                            <button key={section.id} type="button" onClick={() => openFromNav(section.id)}>{section.title}</button>
                        ))}
                    </nav>
                </aside>

                <div className="protocol-content">
                    {sections.map(section => (
                        <ProtocolSection
                            key={section.id}
                            section={section}
                            isOpen={Boolean(openSections[section.id])}
                            onToggle={() => setOpenSections(previous => ({ ...previous, [section.id]: !previous[section.id] }))}
                        />
                    ))}
                </div>
            </div>
        </main>
    );
}

createRoot(document.getElementById('app')).render(<ProtocolDocsApp />);
