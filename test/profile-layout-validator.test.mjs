import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultProfileLayout, validateProfileLayout, layoutArtworks, canFeatureArtwork } from '../src/features/profile/profile-layout.js';

const A = `0x${'1'.repeat(40)}`, B = `0x${'2'.repeat(40)}`, CORE = `0x${'3'.repeat(40)}`;
const item = id => ({ chain_id: 84532, core_address: CORE, artwork_id: String(id) });
const section = (id, artworks = []) => ({ id, label: 'Selected works', artworks });

test('layout normalization preserves order and exact uint256 identities without display mechanics', () => {
  const layout = validateProfileLayout({ ...defaultProfileLayout(), template: 'featured', pinned: item(1),
    sections: [{ ...section('first', [item(2), item(1)]), label: '  Gallery 🎨  ' }, section('second', [item(2n ** 256n - 1n)])] });
  assert.equal(layout.sections[0].label, 'Gallery 🎨');
  assert.deepEqual(layoutArtworks(layout).map(work => work.artwork_id), ['1', '2', String(2n ** 256n - 1n)]);
  assert.deepEqual(defaultProfileLayout(), { version: 1, template: 'default', cover_url: null, pinned: null, sections: [] });
  assert.equal(canFeatureArtwork({ creator: A, current_owner_address: B }, A, 'owned-or-created'), true);
  assert.equal(canFeatureArtwork({ creator: A, minted: true, current_owner_address: B }, B, 'owned-or-created'), true);
  assert.equal(canFeatureArtwork({ creator: A, minted: false, current_owner_address: B }, B, 'owned-or-created'), false);
  assert.equal(canFeatureArtwork({ creator: A, current_owner_address: B }, B, 'owned-or-created'), false);
  assert.equal(canFeatureArtwork({ creator: A, current_owner_address: B }, CORE, 'owned-or-created'), false);
  assert.equal(canFeatureArtwork({ creator: A, moderation_hidden: true }, A, 'owned-or-created'), false);
  assert.equal(canFeatureArtwork({ creator: A }, B, 'unknown'), false);
  assert.equal(canFeatureArtwork({}, '', 'owned-or-created'), false);
  assert.equal(canFeatureArtwork({ creator: `0x${'0'.repeat(40)}` }, `0x${'0'.repeat(40)}`, 'owned-or-created'), false);
});

test('unknown fields, malformed identities and unbounded or ambiguous layouts are rejected', () => {
  const base = defaultProfileLayout();
  const invalid = [null, [], {}, { ...base, version: 2 }, { ...base, template: 'css' },
    { ...base, html: '<script>' }, { ...base, aura: 'official' }, { ...base, price: '1' },
    { ...base, cover_url: 'javascript:alert(1)' }, { ...base, cover_url: 'https://test/\nimage.png' },
    { ...base, pinned: { ...item(1), artwork_id: 1 } }, { ...base, pinned: { ...item(1), artwork_id: '01' } },
    { ...base, pinned: item(2n ** 256n) }, { ...base, pinned: { ...item(1), chain_id: '84532' } },
    { ...base, pinned: { ...item(1), creator: A } }, { ...base, pinned: { ...item(1), core_address: `0x${'0'.repeat(40)}` } },
    { ...base, sections: Array.from({ length: 4 }, (_, n) => section(String(n))) },
    { ...base, sections: [section('same'), section('same')] },
    ...['', ' ', 'a'.repeat(61), 'NUL\u0000', '\ud800', 'line\nbreak'].map(label => ({ ...base, sections: [{ ...section('first'), label }] })),
    { ...base, sections: [section('one', [item(1), item(1)])] },
    { ...base, sections: [{ ...section('one'), arbitrary_style: 'fixed' }] },
    { ...base, sections: [section('one', Array.from({ length: 20 }, (_, n) => item(n + 1)))], pinned: item(21) }
  ];
  for (const input of invalid) assert.throws(() => validateProfileLayout(input), { code: 'INVALID_PROFILE_LAYOUT' });
  assert.equal(layoutArtworks(validateProfileLayout({ ...base, pinned: item(1),
    sections: [section('one', Array.from({ length: 20 }, (_, n) => item(n + 1)))] })).length, 20);
});
