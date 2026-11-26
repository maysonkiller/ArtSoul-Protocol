import { React } from '../../entries/react-runtime.js';
import './verification-mark.css';

export function VerificationMark({ label }) {
    return <svg className="artsoul-verification-mark" width="24" height="24" viewBox="0 0 24 24"
        role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
        {label && <title>{label}</title>}
        <circle cx="12" cy="12" r="10.5" />
        <path d="m7.5 12.2 3 3 6-6.3" fill="none" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}
