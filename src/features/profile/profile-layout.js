// Public presentation only. No identities, permissions, prices or styles.
export const PROFILE_LAYOUT_VERSION = 1;
export const MAX_PROFILE_SECTIONS = 3;
export const MAX_PROFILE_WORKS = 20;

const fail = () => { throw Object.assign(new Error('Choose a supported profile layout and valid artwork selections.'),
  { code: 'INVALID_PROFILE_LAYOUT', statusCode: 400 }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) {
  if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function validText(value, max) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return ![...value].some(char => { const code = char.codePointAt(0); return code >= 0xd800 && code <= 0xdfff; });
}
export function defaultProfileLayout() {
  return { version: 1, template: 'default', cover_url: null, pinned: null, sections: [] };
}
export function profileArtworkKey(item) {
  return `${item.chain_id}:${item.core_address}:${item.artwork_id}`;
}
function pointer(value) {
  exact(value, ['chain_id', 'core_address', 'artwork_id']);
  if (!Number.isSafeInteger(value.chain_id) || value.chain_id <= 0 ||
      typeof value.core_address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value.core_address) || /^0x0{40}$/.test(value.core_address) ||
      typeof value.artwork_id !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value.artwork_id) || BigInt(value.artwork_id) >= 2n ** 256n) fail();
  return { chain_id: value.chain_id, core_address: value.core_address.toLowerCase(), artwork_id: value.artwork_id };
}
export function layoutArtworks(layout) {
  const all = [...(layout.pinned ? [layout.pinned] : []), ...layout.sections.flatMap(section => section.artworks)];
  return [...new Map(all.map(item => [profileArtworkKey(item), item])).values()];
}
export function validateProfileLayout(value) {
  exact(value, ['version', 'template', 'cover_url', 'pinned', 'sections']);
  if (value.version !== PROFILE_LAYOUT_VERSION || !['default', 'featured'].includes(value.template) ||
      !Array.isArray(value.sections) || value.sections.length > MAX_PROFILE_SECTIONS) fail();
  if (value.cover_url !== null && (typeof value.cover_url !== 'string' || value.cover_url.length > 2048 ||
      !/^https:\/\//.test(value.cover_url) || /[\u0000-\u0020\u007f\\]/.test(value.cover_url))) fail();
  const sectionIds = new Set();
  const sections = value.sections.map(section => {
    exact(section, ['id', 'label', 'artworks']);
    if (typeof section.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(section.id) || sectionIds.has(section.id) ||
        !validText(section.label, 60) || !Array.isArray(section.artworks) || section.artworks.length > MAX_PROFILE_WORKS) fail();
    sectionIds.add(section.id);
    const artworks = section.artworks.map(pointer);
    if (new Set(artworks.map(profileArtworkKey)).size !== artworks.length) fail();
    return { id: section.id, label: section.label.trim(), artworks };
  });
  const layout = { version: 1, template: value.template, cover_url: value.cover_url,
    pinned: value.pinned === null ? null : pointer(value.pinned), sections };
  if (layoutArtworks(layout).length > MAX_PROFILE_WORKS) fail();
  return layout;
}

// Keep the founder's selection policy separate from storage and presentation.
export function canFeatureArtwork(card, wallet, policy) {
  if (!card || card.moderation_hidden === true) return false;
  if (policy === 'public') return true;
  if (policy !== 'owned-or-created') return false;
  const owner = String(wallet || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(owner) || /^0x0{40}$/.test(owner)) return false;
  return String(card.creator || card.creator_id || '').toLowerCase() === owner ||
    (card.minted === true && String(card.current_owner_address || '').toLowerCase() === owner);
}
