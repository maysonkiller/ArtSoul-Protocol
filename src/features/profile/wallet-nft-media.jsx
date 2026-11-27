import { React } from '../../entries/react-runtime.js';
import { auraFrameClassName, auraFrameLabels, auraWords, auraCaption } from '../../ui/components/aura-frame.js';

export function WalletNftMedia({ item, className, children }) {
  const kind = item.aura_kind;
  const verified = kind === 'genesis' || kind === 'partner' || kind === 'platform';
  return <div className={verified ? className + ' ' + auraFrameClassName(kind) : className}
    role={verified ? 'group' : undefined} aria-label={verified ? auraFrameLabels[kind] : undefined}>
    {children}
    {verified && item.aura_border_text === true && auraCaption(React.createElement, auraWords[kind])}
  </div>;
}

export function WalletNftName({item, children}) {
  return <>{children}{item.aura_kind === 'platform' && <> <img className="artsoul-official-nft" src="/favicon.jpg"
    alt="Official ArtSoul NFT" title="Official ArtSoul NFT" width="16" height="16" /></>}</>;
}
