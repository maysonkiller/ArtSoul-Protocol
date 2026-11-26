import { React } from '../../entries/react-runtime.js';
import { auraFrameClassName, auraFrameLabels, auraWords, auraCaption } from '../../ui/components/aura-frame.js';

export function WalletNftMedia({ item, className, children }) {
  const kind = item.aura_kind;
  const verified = kind === 'genesis' || kind === 'partner';
  return <div className={verified ? className + ' ' + auraFrameClassName(kind) : className}
    role={verified ? 'group' : undefined} aria-label={verified ? auraFrameLabels[kind] : undefined}>
    {children}
    {verified && item.aura_border_text === true && auraCaption(React.createElement, auraWords[kind])}
  </div>;
}
