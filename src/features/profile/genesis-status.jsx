import { React } from '../../entries/react-runtime.js';

export function GenesisStatus({ wallet, enabled }) {
    const [status, setStatus] = React.useState(null);
    React.useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        async function load() {
            const response = await fetch(`/api/public/profile?address=${encodeURIComponent(wallet)}&view=genesis`, {
                credentials: 'omit', cache: 'no-store', signal: controller.signal
            });
            if (!response.ok) throw new Error('Grant lookup unavailable');
            const result = await response.json();
            if (controller.signal.aborted) return;
            if (result.wallet === wallet.toLowerCase() && Number.isInteger(result.serial) && result.serial >= 0 && result.serial < 10000) {
                setStatus({ label: `Genesis #${result.serial}`, detail: 'Verified Base mainnet grant' });
            } else {
                setStatus({ label: 'Unconfirmed', detail: 'No verified grant available.' });
            }
        }
        load().catch(() => {
            if (!controller.signal.aborted) setStatus({ label: 'Unavailable', detail: 'Grant status could not be checked.' });
        });
        return () => controller.abort();
    }, [wallet, enabled]);
    const display = enabled ? status ?? { label: 'Checking grant…', detail: 'Base mainnet' }
        : { label: 'Mainnet only', detail: 'Testnet does not qualify.' };
    return <>
        <div className="text-lg font-bold">{display.label}</div>
        <div className="text-xs opacity-70">{display.detail}</div>
    </>;
}
