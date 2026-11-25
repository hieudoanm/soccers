import { render, screen } from '@testing-library/react';
import MatchAnalysis from '../MatchAnalysis';

describe('MatchAnalysis', () => {
  it('renders the card heading and xG badge', () => {
    render(<MatchAnalysis />);
    expect(
      screen.getByRole('heading', { name: 'Match analysis' })
    ).toBeInTheDocument();
    expect(screen.getByText('xG 1.8 – 0.9')).toBeInTheDocument();
  });

  it('renders the pitch visual with an accessible label', () => {
    render(<MatchAnalysis />);
    expect(
      screen.getByRole('img', {
        name: 'Shot map and event positions on a football pitch',
      })
    ).toBeInTheDocument();
  });

  it('renders the event legend', () => {
    render(<MatchAnalysis />);
    expect(screen.getByText('Shot on target')).toBeInTheDocument();
    expect(screen.getByText('Shot off target')).toBeInTheDocument();
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
  });
});
