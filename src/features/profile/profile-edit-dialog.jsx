import { React } from '../../entries/react-runtime.js';
import { createPortal } from 'react-dom';

// Keep the summary stable and let the native modal contain keyboard focus.
export function ProfileEditDialog({ children, onCancel }) {
    const dialog = React.useRef(null);
    React.useEffect(() => {
        const element = dialog.current;
        const trigger = document.activeElement;
        element.showModal();
        return () => {
            element.close();
            if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        };
    }, []);
    return createPortal(<dialog ref={dialog} className="profile-edit-dialog"
        aria-labelledby="profileEditTitle"
        onCancel={event => { event.preventDefault(); onCancel(); }}>
        <header className="profile-edit-heading">
            <h2 id="profileEditTitle">Edit profile</h2>
            <button type="button" className="btn-secondary" aria-label="Close profile editor" onClick={onCancel}>Close</button>
        </header>
        {children}
    </dialog>, document.body);
}
