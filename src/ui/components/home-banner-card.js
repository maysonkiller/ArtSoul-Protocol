// A promotion discloses the separate banner arrangement outside the artwork card.
export function discloseHomePromotion(card, promotion) {
    if (!card || !promotion) return card;
    const notice = document.createElement('div');
    notice.className = 'p-3';
    const label = document.createElement('strong');
    label.textContent = 'Promoted';
    const sponsor = document.createElement('p');
    sponsor.textContent = promotion.sponsor + ' (' + promotion.relationship + ')';
    const terms = document.createElement('p');
    terms.textContent = promotion.consideration;
    notice.append(label, sponsor, terms);
    const tile = document.createElement('article');
    tile.className = 'min-w-0 break-words';
    tile.append(notice, card);
    return tile;
}
