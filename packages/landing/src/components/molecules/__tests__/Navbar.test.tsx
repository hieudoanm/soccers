import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '../Navbar';

const PROPS = {
  name: 'soccers',
  logoSrc: '/icons/icon.svg',
  links: [],
  groups: [
    {
      label: 'Foods',
      items: [
        { href: '/foods/wheel/', label: 'Wheel' },
        { href: '/foods/randomizer', label: 'Randomizer' },
      ],
    },
    {
      label: 'Schedules',
      items: [{ href: '/schedule/vietnam', label: 'Vietnam' }],
    },
  ],
  githubUrl: 'https://github.com/hieudoanm/soccers',
};

describe('Navbar', () => {
  it('renders the brand and GitHub link', () => {
    render(<Navbar {...PROPS} />);
    expect(screen.getByText('soccers')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/hieudoanm/soccers'
    );
  });

  it('renders flat links', () => {
    render(
      <Navbar
        {...PROPS}
        groups={[]}
        links={[{ label: 'Docs', href: '/docs' }]}
      />
    );
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute(
      'href',
      '/docs'
    );
  });

  it('opens a dropdown and links its items', async () => {
    const user = userEvent.setup();
    render(<Navbar {...PROPS} />);
    await user.click(screen.getByRole('button', { name: 'Foods' }));
    expect(screen.getByRole('link', { name: 'Randomizer' })).toHaveAttribute(
      'href',
      '/foods/randomizer'
    );
    await user.click(screen.getByRole('button', { name: 'Schedules' }));
    expect(screen.getByRole('link', { name: 'Vietnam' })).toHaveAttribute(
      'href',
      '/schedule/vietnam'
    );
  });

  it('closes a dropdown when its button is clicked again', async () => {
    const user = userEvent.setup();
    render(<Navbar {...PROPS} />);
    const foods = screen.getByRole('button', { name: 'Foods' });
    await user.click(foods);
    expect(screen.getByRole('link', { name: 'Wheel' })).toBeInTheDocument();
    await user.click(foods);
    expect(
      screen.queryByRole('link', { name: 'Wheel' })
    ).not.toBeInTheDocument();
  });

  it('renders external flat links', () => {
    render(
      <Navbar
        {...PROPS}
        groups={[]}
        links={[{ label: 'Site', href: 'https://example.com' }]}
      />
    );
    expect(screen.getByRole('link', { name: 'Site' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
  });
});
