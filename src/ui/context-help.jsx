import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const topics = {
    reactions: {
        title: 'Your reactions', label: 'About community reactions',
        paragraphs: [
            'Like shows appreciation. Would Buy expresses interest; it does not place a bid or make a purchase.',
            'Watching records a discovery signal. It is separate from your private Saved list and does not itself promise a reminder.'
        ],
        links: [['Read the guide', '/docs-protocol#trust-community']]
    },
    trust: {
        title: 'About Trust', label: 'About Trust',
        paragraphs: [
            'Trust describes community signals used for discovery. Its influence affects discovery ordering only.',
            'It does not change price, floor, ownership, settlement or fees. A higher score is not a promise of quality or financial return.'
        ],
        links: [['Read the guide', '/docs-protocol#trust-community']]
    },
    auction: {
        title: 'Before you bid', label: 'About bids, payment and floor',
        paragraphs: [
            'Review the bid, required deposit, payment deadline and network before confirming in your wallet. The highest bid alone does not create an NFT.',
            'The winner completes payment within the displayed deadline. The deposit counts toward the auction price; any excess becomes withdrawable credit. Successful settlement creates the NFT and sets its floor to the paid auction price.',
            'ArtSoul resale listings cannot be below that floor. The floor is not an estimate or guarantee of market value.'
        ],
        links: [['Read the payment and minting guide', '/docs-protocol#settlement'], ['How deposits work', '/docs-protocol#deposits']]
    }
};

// Like the existing profile editor, use the native top layer and return focus
// without moving the page. Help never invokes the action it describes.
export function ContextHelp({ topic }) {
    const content = topics[topic];
    const id = useId();
    const dialog = useRef(null);
    const trigger = useRef(null);
    useEffect(() => {
        const element = dialog.current;
        return () => element?.close();
    }, []);
    if (!content) return null;
    return <>
        <button ref={trigger} type="button" className="context-help-trigger" data-allow-rapid="true"
            aria-label={content.label} aria-haspopup="dialog" aria-controls={`${id}-help`}
            onClick={() => dialog.current?.showModal()}>?</button>
        {typeof document !== 'undefined' && createPortal(
            <dialog ref={dialog} id={`${id}-help`} className="context-help-dialog" aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-description`}
                onClick={event => {
                    if (event.target !== event.currentTarget) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
                }}
                onCancel={event => event.stopPropagation()}
                onClose={event => {
                    event.stopPropagation();
                    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
                }}>
                <header className="context-help-heading">
                    <h2 id={`${id}-title`}>{content.title}</h2>
                    <button type="button" className="context-help-close" aria-label="Close help" autoFocus data-allow-rapid="true"
                        onClick={() => dialog.current?.close()}>×</button>
                </header>
                <div id={`${id}-description`}>{content.paragraphs.map(text => <p key={text}>{text}</p>)}</div>
                <nav className="context-help-links" aria-label="Further guidance">
                    {content.links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
                </nav>
            </dialog>, document.body)}
    </>;
}
