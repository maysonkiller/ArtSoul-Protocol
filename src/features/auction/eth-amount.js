// User-entered ETH amounts only. Protocol read values have separate schemas.
export function parseUserEthAmount(value) {
    if (typeof value !== 'string') throw new Error('Enter an ETH amount using digits and one decimal separator.');
    const text = value.trim();
    if (!/^\d+(?:[.,]\d+)?$/.test(text)) {
        throw new Error('Enter an ETH amount using digits and one decimal point or comma.');
    }
    const [whole, fraction = ''] = text.replace(',', '.').split('.');
    if (fraction.length > 18) throw new Error('ETH amounts can have at most 18 decimal places.');
    // Bound input before BigInt conversion; uint256 holds at most 78 digits.
    const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
    if (normalizedWhole.length > 60) throw new Error('The ETH amount is too large.');
    const wei = BigInt(normalizedWhole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
    if (wei <= 0n) throw new Error('The ETH amount must be greater than 0.');
    if (wei >= 2n ** 256n) throw new Error('The ETH amount is too large.');
    const normalizedFraction = fraction.replace(/0+$/, '');
    return { wei, eth: normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole };
}
