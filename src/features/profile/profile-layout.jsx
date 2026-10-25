import {React} from '../../entries/react-runtime.js';
import {canSearch, createSearchState} from '../search/search-state.js';
import {MAX_PROFILE_SECTIONS, MAX_PROFILE_WORKS} from './profile-layout.js';
import {createProfileLayoutState, defaultProfileLayout, profileArtworkKey, profileArtworkPointer,
  canSelectProfileArtwork, selectedProfileArtworkKeys, moveProfileItem} from './profile-layout-state.js';

const currentWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
const artworkName = (pointer, cards) => cards.get(profileArtworkKey(pointer))?.title || `Artwork #${pointer.artwork_id}`;

export function ProfileLayoutPreview({layout, cards, config}) {
  const Card = window.ArtSoulArtworkCard?.ReactCard;
  const byKey = new Map(cards.map(card => [profileArtworkKey(profileArtworkPointer(card, config)), card]));
  const renderCard = pointer => {
    const card = byKey.get(profileArtworkKey(pointer));
    return card && Card ? <Card key={profileArtworkKey(pointer)} artwork={card}
      href={window.ArtSoulArtworkCard.detailHref(card)} surface="profile" /> : null;
  };
  const pinned = layout.pinned && renderCard(layout.pinned);
  const sections = layout.sections.map(section => {
    const visible = section.artworks.map(renderCard).filter(Boolean);
    return visible.length ? <section key={section.id} className="profile-curation-section">
      <h2>{section.label}</h2><div className="profile-curation-grid">{visible}</div>
    </section> : null;
  }).filter(Boolean);
  if (!pinned && !sections.length) return null;
  return <div className={`profile-curation profile-curation-${layout.template === 'featured' ? 'featured' : 'default'}`}>
    {pinned && <section className="profile-curation-pin" aria-label="Pinned artwork"><h2>Pinned artwork</h2>
      <div className="profile-curation-grid">{pinned}</div></section>}
    {sections}
  </div>;
}

function LayoutEditor({state, controller, cards, config, wallet, candidates}) {
  const [search, setSearch] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [picker, setPicker] = React.useState('');
  const [expandedSection, setExpandedSection] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const selectedCards = React.useRef(new Map());
  const pickerPanel = React.useRef(null);
  const pickerTrigger = React.useRef(null);
  const searchController = React.useMemo(() => createSearchState({onChange: setSearch}), []);
  React.useEffect(() => () => searchController.cancel(), [searchController]);
  React.useEffect(() => {
    if (!pickerPanel.current) return;
    pickerPanel.current.scrollIntoView({block: 'nearest'});
    pickerPanel.current.focus({preventScroll: true});
  }, [picker]);
  const openPicker = (value, button) => {pickerTrigger.current = button; setPicker(picker === value ? '' : value);};
  const closePicker = () => {setPicker(''); pickerTrigger.current?.focus();};
  const draft = state.draft;
  const byKey = new Map([...selectedCards.current, ...cards.map(card => [profileArtworkKey(profileArtworkPointer(card, config)), card])]);
  const choices = new Map([...candidates, ...(search?.groups.artworks.items || [])].filter(card => canSelectProfileArtwork(card, wallet, config))
    .map(card => [profileArtworkKey(profileArtworkPointer(card, config)), card]));
  for (const [key, card] of choices) byKey.set(key, card);
  const selected = selectedProfileArtworkKeys(draft);
  selectedCards.current = new Map([...byKey].filter(([key]) => selected.has(key)));
  const targetSection = draft.sections.find(section => `section:${section.id}` === picker);
  const targetId = targetSection?.id || '';
  const changeSection = (id, update) => controller.change(value => ({...value, sections: value.sections.map(section => section.id === id ? update(section) : section)}));
  function choose(card, pin) {
    const pointer = profileArtworkPointer(card, config), key = profileArtworkKey(pointer);
    if (!pointer || !canSelectProfileArtwork(card, wallet, config)) return;
    const next = JSON.parse(JSON.stringify(draft));
    if (pin) next.pinned = pointer;
    else {
      const section = next.sections.find(item => item.id === targetId);
      if (!section) return;
      if (!section.artworks.some(item => profileArtworkKey(item) === key)) section.artworks.push(pointer);
    }
    if (selectedProfileArtworkKeys(next).size > MAX_PROFILE_WORKS) {setNotice(`Choose up to ${MAX_PROFILE_WORKS} different artworks. Remove one before adding another.`); return;}
    selectedCards.current.set(key, card);
    setNotice('');
    controller.change(next);
    return true;
  }
  const previewCards = [...byKey.values()];
  return <section className="profile-layout-editor" aria-label="Customize profile" aria-busy={Boolean(state.busy)}>
    <div className="profile-layout-toolbar profile-layout-heading"><h2>{state.preview ? 'Preview profile layout' : 'Customize profile'}</h2>
      <button type="button" className="btn-secondary" disabled={Boolean(state.busy)} onClick={() => controller.preview(!state.preview)}>{state.preview ? 'Continue editing' : 'Preview'}</button></div>
    <p className="profile-layout-help">Choose what visitors see first. Changes stay private until you save.</p>
    {state.preview ? <ProfileLayoutPreview layout={draft} cards={previewCards} config={config} /> : <>
      <div className="profile-layout-fields">
        <label>Display style<select value={draft.template} disabled={Boolean(state.busy)} onChange={event => controller.change(value => ({...value, template: event.target.value}))}>
          <option value="default">Standard grid</option><option value="featured">Featured artwork</option></select></label>
      </div>
      <div className="profile-layout-pin">
        <div><h3>Pinned artwork</h3><p className="profile-layout-help">{draft.pinned ? artworkName(draft.pinned, byKey) : 'Feature one artwork at the top of your profile.'}</p></div>
        <div className="profile-layout-toolbar">
          <button type="button" className="btn-secondary" disabled={Boolean(state.busy)} aria-expanded={picker === 'pin'} aria-controls="profile-layout-picker" onClick={event => openPicker('pin', event.currentTarget)}>{draft.pinned ? 'Change artwork' : 'Choose artwork'}</button>
          {draft.pinned && <button type="button" className="btn-secondary" disabled={Boolean(state.busy)} onClick={() => controller.change(value => ({...value, pinned: null}))}>Remove pin</button>}
        </div>
      </div>
      <div className="profile-layout-toolbar profile-layout-heading"><h3>Artwork sections</h3><button type="button" className="btn-secondary" disabled={Boolean(state.busy) || draft.sections.length >= MAX_PROFILE_SECTIONS} onClick={() => {
        const id = crypto.randomUUID();
        controller.change(value => ({...value, sections: [...value.sections, {id, label: 'Selected artworks', artworks: []}]}));
        setExpandedSection(id); setPicker('');
      }}>Add section</button></div>
      <p className="profile-layout-help">{draft.sections.length}/{MAX_PROFILE_SECTIONS} sections · {selected.size}/{MAX_PROFILE_WORKS} artworks. Creator credits stay visible.</p>
      {draft.sections.map((section, index) => <details key={section.id} className="profile-layout-section-editor" open={expandedSection === section.id}>
        <summary onClick={event => {event.preventDefault(); setExpandedSection(expandedSection === section.id ? '' : section.id);}}><span>{section.label || `Section ${index + 1}`}</span><span>{section.artworks.length} {section.artworks.length === 1 ? 'artwork' : 'artworks'}</span></summary>
        <fieldset disabled={Boolean(state.busy)}><legend className="sr-only">Edit section {index + 1}</legend><label>Section name<input type="text" value={section.label} maxLength={60} onChange={event => changeSection(section.id, value => ({...value, label: event.target.value}))} /></label>
        <div className="profile-layout-toolbar profile-layout-order">
          <button type="button" className="btn-secondary" aria-label="Move section up" disabled={index === 0} onClick={() => controller.change(value => ({...value, sections: moveProfileItem(value.sections, index, -1)}))}>Up</button>
          <button type="button" className="btn-secondary" aria-label="Move section down" disabled={index === draft.sections.length - 1} onClick={() => controller.change(value => ({...value, sections: moveProfileItem(value.sections, index, 1)}))}>Down</button>
          <button type="button" className="btn-secondary" onClick={() => controller.change(value => ({...value, sections: value.sections.filter(item => item.id !== section.id)}))}>Remove section</button>
        </div>
        <ol className="profile-layout-selection">{section.artworks.map((pointer, position) => <li key={profileArtworkKey(pointer)}>
          <span>{artworkName(pointer, byKey)}</span><div className="profile-layout-toolbar profile-layout-order">
            <button type="button" className="btn-secondary" aria-label={`Move ${artworkName(pointer, byKey)} up`} disabled={position === 0} onClick={() => changeSection(section.id, value => ({...value, artworks: moveProfileItem(value.artworks, position, -1)}))}>Up</button>
            <button type="button" className="btn-secondary" aria-label={`Move ${artworkName(pointer, byKey)} down`} disabled={position === section.artworks.length - 1} onClick={() => changeSection(section.id, value => ({...value, artworks: moveProfileItem(value.artworks, position, 1)}))}>Down</button>
            <button type="button" className="btn-secondary" aria-label={`Remove ${artworkName(pointer, byKey)} from section`} onClick={() => changeSection(section.id, value => ({...value, artworks: value.artworks.filter(item => profileArtworkKey(item) !== profileArtworkKey(pointer))}))}>Remove</button>
          </div></li>)}</ol>
        {!section.artworks.length && <p className="profile-layout-help">No artworks in this section yet.</p>}
        <button type="button" className="btn-secondary" aria-expanded={picker === `section:${section.id}`} aria-controls="profile-layout-picker" onClick={event => openPicker(`section:${section.id}`, event.currentTarget)}>Add artworks</button>
        </fieldset>
      </details>)}
      {(picker === 'pin' || targetSection) && <section id="profile-layout-picker" ref={pickerPanel} tabIndex={-1} className="profile-layout-picker" aria-label="Choose artworks">
        <div className="profile-layout-toolbar profile-layout-heading"><h3>{picker === 'pin' ? 'Choose your pinned artwork' : `Add to ${targetSection.label || 'section'}`}</h3><button type="button" className="btn-secondary" onClick={closePicker}>Done choosing</button></div>
        <p className="profile-layout-help">{config.selectionPolicy === 'public' ? 'Choose public artworks.' : 'Choose your own works or NFTs you currently own.'} Search by title, artist, wallet or artwork number.</p>
        <form className="profile-layout-toolbar" role="search" onSubmit={event => {event.preventDefault(); void searchController.search(query, 'artworks');}}>
          <label>Find artworks<input type="search" value={query} maxLength={100} onChange={event => {setQuery(event.target.value); searchController.reset(event.target.value, 'artworks');}} /></label>
          <button type="submit" className="btn-secondary" disabled={!canSearch(query) || search?.status === 'loading'}>Search</button>
        </form>
        {search?.status === 'loading' && <p role="status">Searching artworks…</p>}
        {search?.error && <p role="status">{search.error}</p>}
        <ul className="profile-layout-selection">{[...choices.values()].map(card => {
          const pointer = profileArtworkPointer(card, config), key = profileArtworkKey(pointer);
          const inSection = draft.sections.find(section => section.id === targetId)?.artworks.some(item => profileArtworkKey(item) === key);
          return <li key={key}><span>{card.title || `Artwork #${pointer.artwork_id}`}</span><div className="profile-layout-toolbar">
            {picker === 'pin' ? <button type="button" className="btn-secondary" disabled={Boolean(state.busy) || profileArtworkKey(draft.pinned) === key} onClick={() => {if (choose(card, true)) closePicker();}}>{profileArtworkKey(draft.pinned) === key ? 'Pinned' : 'Pin artwork'}</button> :
              <button type="button" className="btn-secondary" disabled={Boolean(state.busy) || inSection} onClick={() => choose(card, false)}>{inSection ? 'Added' : 'Add artwork'}</button>}
          </div></li>;
        })}</ul>
        {!choices.size && <p className="profile-layout-help">No selectable artworks here yet. Try searching for one of your works.</p>}
        {search?.nextCursor && <button type="button" className="btn-secondary" disabled={search.status !== 'ready'} onClick={() => searchController.search(query, 'artworks', true)}>More results</button>}
      </section>}
    </>}
    {notice && <p role="status">{notice}</p>}
    {state.busy && <p role="status">Saving layout…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.conflict && <button type="button" className="btn-secondary" disabled={Boolean(state.busy)} onClick={() => controller.load()}>Discard draft and load latest layout</button>}
    <div className="profile-layout-toolbar profile-layout-footer">
      <button type="button" className="btn-main" disabled={Boolean(state.busy) || state.conflict || draft.sections.some(section => !section.label.trim())} onClick={() => controller.save()}>Save layout</button>
      <button type="button" className="btn-secondary" disabled={state.busy === 'saving'} onClick={() => controller.cancel()}>Cancel</button>
      <button type="button" className="btn-secondary" disabled={Boolean(state.busy)} onClick={() => {controller.change(value => ({...defaultProfileLayout(), cover_url: value.cover_url})); setPicker(''); setNotice('Default layout selected. Save layout to publish it, or Cancel to keep your previous layout.');}}>Restore default</button>
    </div>
  </section>;
}

function ProfileLayoutBody({wallet, isOwnProfile, availableArtworks, config}) {
  const [state, setState] = React.useState(null);
  const controller = React.useMemo(() => createProfileLayoutState({wallet, getWallet: currentWallet, onChange: setState,
    authenticate: () => window.ensureAuthenticated?.()}), [wallet]);
  React.useEffect(() => {
    void controller.load();
    const onAuth = () => controller.authChanged(window.SupabaseAuth?.getAuthenticatedWallet?.());
    window.addEventListener('artsoul:auth-state-changed', onAuth);
    return () => {window.removeEventListener('artsoul:auth-state-changed', onAuth); controller.dispose();};
  }, [controller]);
  React.useEffect(() => {if (!isOwnProfile) controller.cancel();}, [isOwnProfile, controller]);
  const current = state || controller.getState();
  const owner = isOwnProfile && currentWallet() === wallet;
  if (!owner && !current.error && current.cards.length === 0) return null;
  return <section className="profile-layout" aria-label="Profile selections">
    {owner && !current.editing && <div className="profile-layout-toolbar"><button type="button" className="btn-secondary" disabled={current.status !== 'ready'} onClick={() => controller.edit()}>Customize profile</button>
      {current.status === 'loading' && <span role="status">Loading layout…</span>}</div>}
    {owner && current.editing ? <LayoutEditor state={current} controller={controller} cards={current.cards} config={config} wallet={wallet} candidates={availableArtworks} /> : <>
      {current.status === 'ready' && <ProfileLayoutPreview layout={current.layout} cards={current.cards} config={config} />}
      {current.error && <p role="status">{current.error} <button type="button" className="btn-secondary" onClick={() => controller.load()}>Reload layout</button></p>}
    </>}
  </section>;
}

export function ProfileLayout({wallet, isOwnProfile, availableArtworks = []}) {
  const [config, setConfig] = React.useState(null);
  React.useEffect(() => {let active = true;
    Promise.resolve(window.ArtSoulPublicConfig?.load?.()).then(data => {if (active) setConfig(data?.profileLayout || null);}, () => {});
    return () => {active = false;};
  }, []);
  const address = String(wallet || '').toLowerCase();
  return config?.enabled === true && /^0x[0-9a-f]{40}$/.test(address) ? <ProfileLayoutBody key={address} wallet={address} isOwnProfile={isOwnProfile} availableArtworks={availableArtworks} config={config} /> : null;
}
