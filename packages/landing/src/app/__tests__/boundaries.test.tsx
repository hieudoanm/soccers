import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorPage from '../error';
import GlobalError from '../global-error';
import Loading from '../loading';
import NotFound from '../not-found';

describe('app boundaries', () => {
  it('renders the not-found page', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('renders the error page and calls reset', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<ErrorPage error={new Error('Boom')} reset={reset} />);

    expect(screen.getByText('Boom')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('renders the global error page', () => {
    render(<GlobalError error={new Error('Global boom')} reset={() => {}} />);

    expect(
      screen.getByRole('heading', { name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(screen.getByText('Global boom')).toBeInTheDocument();
  });

  it('renders the loading page', () => {
    const { container } = render(<Loading />);

    expect(container.querySelector('.loading')).toBeInTheDocument();
  });
});
