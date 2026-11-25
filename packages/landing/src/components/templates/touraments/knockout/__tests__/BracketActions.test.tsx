import { render, screen, fireEvent } from '@testing-library/react';
import { BracketActions } from '../BracketActions';

describe('BracketActions', () => {
  it('renders all three buttons', () => {
    const onReset = vi.fn();
    const onDownload = vi.fn();
    const onShare = vi.fn();
    render(
      <BracketActions
        onReset={onReset}
        onDownload={onDownload}
        onShare={onShare}
        copied={false}
      />
    );
    expect(screen.getByText('Reset bracket')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('Share')).toBeInTheDocument();
  });

  it('shows "Copied!" when copied is true', () => {
    render(
      <BracketActions
        onReset={vi.fn()}
        onDownload={vi.fn()}
        onShare={vi.fn()}
        copied={true}
      />
    );
    expect(screen.getByText('Copied!')).toBeInTheDocument();
    expect(screen.queryByText('Share')).not.toBeInTheDocument();
  });

  it('calls handlers on click', () => {
    const onReset = vi.fn();
    const onDownload = vi.fn();
    const onShare = vi.fn();
    render(
      <BracketActions
        onReset={onReset}
        onDownload={onDownload}
        onShare={onShare}
        copied={false}
      />
    );
    fireEvent.click(screen.getByText('Reset bracket'));
    fireEvent.click(screen.getByText('Download'));
    fireEvent.click(screen.getByText('Share'));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});
