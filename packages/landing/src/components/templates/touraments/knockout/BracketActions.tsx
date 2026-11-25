import type { FC } from 'react';

export const BracketActions: FC<{
  onReset: () => void;
  onDownload: () => void;
  onShare: () => void;
  copied: boolean;
}> = ({ onReset, onDownload, onShare, copied }) => (
  <div className="mt-8 flex flex-wrap justify-center gap-4">
    <button
      className="border-base-300 bg-base-100 text-base-content hover:border-primary cursor-pointer rounded-full border px-5 py-2.5 text-sm font-semibold transition-all duration-150 hover:-translate-y-px active:translate-y-0"
      onClick={onReset}>
      Reset bracket
    </button>
    <button
      className="border-base-300 bg-base-100 text-base-content hover:border-primary cursor-pointer rounded-full border px-5 py-2.5 text-sm font-semibold transition-all duration-150 hover:-translate-y-px active:translate-y-0"
      onClick={onDownload}>
      Download
    </button>
    <button
      className="border-primary bg-primary text-primary-content cursor-pointer rounded-full border px-5 py-2.5 text-sm font-semibold transition-all duration-150 hover:-translate-y-px active:translate-y-0"
      onClick={onShare}>
      {copied ? 'Copied!' : 'Share'}
    </button>
  </div>
);
BracketActions.displayName = 'BracketActions';
