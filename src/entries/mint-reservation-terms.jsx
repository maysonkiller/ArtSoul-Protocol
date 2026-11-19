import { React } from './react-runtime.js';
import { Field } from './collection-components.jsx';
import { parseEth, previewMintReservation, reservationPayout } from '../features/collections/launch-config.js';

function displayUtc(iso) {
    return iso.replace('T', ' ').replace(/:00\.000Z$/, ' UTC').replace(/Z$/, ' UTC');
}

export function MintReservationTerms({ phase, updateReservation, publicPriceEth }) {
    const [resalePrice, setResalePrice] = React.useState('');
    const terms = phase.reservation || {};
    const opening = previewMintReservation(phase);
    const resale = previewMintReservation(phase, resalePrice);
    const payout = reservationPayout(phase.pricing.priceEth, terms.mintPriceEth);
    const expiry = reservationPayout(phase.pricing.priceEth, '0');
    const publicPrice = parseEth(publicPriceEth);
    return <section className="launch-stack" aria-label="Mint reservation terms">
        <div className="launch-grid">
            <Field label="Additional payment to mint one NFT (ETH)" inputMode="decimal" maxLength={80}
                value={terms.mintPriceEth ?? ''} onChange={event => updateReservation('mintPriceEth', event.target.value)} />
            <Field label="Time to redeem after resale closes (hours)" inputMode="numeric" maxLength={10}
                value={terms.redemptionHours ?? ''} onChange={event => updateReservation('redemptionHours', event.target.value)} />
        </div>
        <dl className="launch-definition">
            <div><dt>Total at the minimum bid, before gas</dt><dd>{opening.totalEth === null ? 'Enter both amounts' : opening.totalEth + ' ETH'}</dd></div>
            <div><dt>Public mint per NFT</dt><dd>{publicPrice > 0n ? publicPriceEth + ' ETH' : 'Set in the next public mint phase'}</dd></div>
        </dl>
        <p className="launch-help">Each place reserves one NFT. Confirming the auction result starts a 24-hour window for one optional resale. The full redemption window follows.
            {opening.resaleEndsAt && opening.redemptionEndsAt && <> If the auction settles on schedule, redemption runs from <time dateTime={opening.resaleEndsAt}>{displayUtc(opening.resaleEndsAt)}</time> to <time dateTime={opening.redemptionEndsAt}>{displayUtc(opening.redemptionEndsAt)}</time>.</>}
        </p>
        <details className="launch-details"><summary>Estimate a resale buyer’s total</summary>
            <Field label="Example price for the place (ETH)" inputMode="decimal" maxLength={80}
                value={resalePrice} onChange={event => setResalePrice(event.target.value)} />
            <p className="launch-help" aria-live="polite">{resale.totalEth === null ? 'Enter a resale price and the mint payment.' :
                `Buyer pays ${resalePrice} ETH for the place and ${terms.mintPriceEth} ETH to mint. Total before gas is ${resale.totalEth} ETH.`}</p>
        </details>
        <details className="launch-details"><summary>Winning bids, expiry and refunds</summary>
            <p className="launch-help">If all places sell, winners pay the lowest winning bid. Otherwise winners pay the minimum. Losing bids and excess funding are fully withdrawable.</p>
            <p className="launch-help">ArtSoul takes 2.5% of the amount the creator earns from the place and the mint together. The seller receives the full resale price of a place.</p>
            {payout && <p className="launch-help">At the minimum winning bid, a completed mint credits {payout.creatorEth} ETH to the creator and {payout.feeEth} ETH to ArtSoul.</p>}
            {expiry && <p className="launch-help">If the holder lets the mint window expire, the creator receives {expiry.creatorEth} ETH and ArtSoul receives {expiry.feeEth} ETH at that bid.</p>}
            <p className="launch-help">An emergency pause can interrupt resale. Holders can still redeem during their mint window, and withdrawals remain available.</p>
            <p className="launch-help">Place payments stay in escrow until mint or normal expiry. If the launch fails before providing the full mint window, each buyer can withdraw their payment in full. ArtSoul receives zero. Network gas is separate.</p>
        </details>
    </section>;
}
