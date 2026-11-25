import { fireEvent, render, screen } from '@testing-library/react';
import { Lineups } from '@/components/molecules/Lineups';
import { makeSquad } from '@/test/fixtures';

describe('Lineups', () => {
  it('shows a hint when no lineups are saved', () => {
    render(
      <Lineups
        squad={makeSquad()}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText(/No lineups saved yet/)).toBeInTheDocument();
  });

  it('saves the current lineup', () => {
    const onSave = vi.fn();
    render(
      <Lineups
        squad={makeSquad()}
        onSave={onSave}
        onApply={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('Lineup name'), {
      target: { value: 'Plan A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save lineup' }));
    expect(onSave).toHaveBeenCalledWith('Plan A');
  });

  it('lists lineups with formation and slot count', () => {
    render(
      <Lineups
        squad={makeSquad({
          lineups: [
            {
              id: 'lu1',
              name: 'Plan A',
              formationId: '433',
              assignments: { '433-0-0': ['p1'] },
            },
          ],
        })}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText('Plan A')).toBeInTheDocument();
    expect(screen.getByText(/4-3-3/)).toBeInTheDocument();
    expect(screen.getByText(/1 slots/)).toBeInTheDocument();
  });

  it('applies a saved lineup', () => {
    const onApply = vi.fn();
    render(
      <Lineups
        squad={makeSquad({
          lineups: [
            {
              id: 'lu1',
              name: 'Plan A',
              formationId: '442',
              assignments: {},
            },
          ],
        })}
        onSave={vi.fn()}
        onApply={onApply}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply lineup Plan A' })
    );
    expect(onApply).toHaveBeenCalledWith('lu1');
  });

  it('renames a lineup inline', () => {
    const onRename = vi.fn();
    render(
      <Lineups
        squad={makeSquad({
          lineups: [
            {
              id: 'lu1',
              name: 'Plan A',
              formationId: '442',
              assignments: {},
            },
          ],
        })}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onRename={onRename}
        onRemove={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename lineup Plan A' })
    );
    fireEvent.change(screen.getByLabelText('Rename lineup Plan A'), {
      target: { value: 'Plan B' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save lineup name' }));
    expect(onRename).toHaveBeenCalledWith('lu1', 'Plan B');
  });

  it('removes a saved lineup', () => {
    const onRemove = vi.fn();
    render(
      <Lineups
        squad={makeSquad({
          lineups: [
            {
              id: 'lu1',
              name: 'Plan A',
              formationId: '442',
              assignments: {},
            },
          ],
        })}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onRename={vi.fn()}
        onRemove={onRemove}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove lineup Plan A' })
    );
    expect(onRemove).toHaveBeenCalledWith('lu1');
  });
});
