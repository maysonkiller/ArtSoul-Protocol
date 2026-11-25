import { React } from '../../entries/react-runtime.js';
import { auraFrameClassName, auraFrameLabels } from '../../ui/components/aura-frame.js';

export function WalletNftMedia({ item, className, children }) {
  const verified = item.aura_kind === 'genesis';
  return <div className={verified ? className + ' ' + auraFrameClassName('genesis') : className}
    role={verified ? 'group' : undefined} aria-label={verified ? auraFrameLabels.genesis : undefined}>
    {children}
    {verified && item.aura_border_text === true && <span className="artsoul-aura-caption" aria-hidden="true">{auraFrameLabels.genesis}</span>}
  </div>;
}
