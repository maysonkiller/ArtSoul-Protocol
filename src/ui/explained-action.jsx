import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import './explained-action.css';

// A restricted action remains discoverable. Activating it explains the reason;
// the underlying action is never called. Pending operations stay natively disabled.
export function ExplainedAction({ reason = '', explanationTitle = 'Action unavailable', contextKey = '', disabled = false, onClick, children, className = '', ...props }) {
    const dialog = useRef(null);
    const id = useId();
    useEffect(() => {
        dialog.current?.close();
    }, [reason, contextKey, disabled]);

    return <>
        <button {...props} type={props.type || 'button'} className={`${className} explained-action`}
            disabled={disabled} aria-disabled={reason ? true : undefined}
            data-allow-rapid={reason ? 'true' : props['data-allow-rapid']}
            aria-haspopup={reason ? 'dialog' : undefined} aria-describedby={reason ? `${id}-reason` : undefined}
            onClick={event => {
                if (disabled) return;
                if (reason) {
                    event.preventDefault();
                    event.stopPropagation();
                    dialog.current?.showModal();
                    return;
                }
                onClick?.(event);
            }}>
            {children}
        </button>
        {typeof document !== 'undefined' && createPortal(<dialog ref={dialog} className="action-explanation" aria-labelledby={`${id}-title`} aria-describedby={`${id}-reason`}
            onCancel={event => event.stopPropagation()} onClose={event => event.stopPropagation()}>
            <div className="action-explanation-heading">
                <span className="action-explanation-symbol" aria-hidden="true">i</span>
                <h2 id={`${id}-title`}>{explanationTitle}</h2>
            </div>
            <p id={`${id}-reason`}>{reason}</p>
            <button type="button" className="btn-secondary" autoFocus data-allow-rapid="true" onClick={() => dialog.current?.close()}>Got it</button>
        </dialog>, document.body)}
    </>;
}
