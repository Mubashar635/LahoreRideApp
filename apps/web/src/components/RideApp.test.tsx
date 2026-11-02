import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { deferred, makeRide, RIDER_ID } from '@/test/fixtures';
import { RideApp } from './RideApp';

describe('RideApp', () => {
  it('shows a loading state, then the booking form when there is no active ride', async () => {
    const pending = deferred<null>();
    vi.spyOn(api, 'getActiveRide').mockReturnValue(pending.promise);
    render(<RideApp riderId={RIDER_ID} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    pending.resolve(null);
    expect(await screen.findByRole('heading', { name: 'Where to?' })).toBeInTheDocument();
  });

  it('resumes an in-progress ride after a page reload', async () => {
    vi.spyOn(api, 'getActiveRide').mockResolvedValue(makeRide());
    render(<RideApp riderId={RIDER_ID} />);

    expect(await screen.findByRole('heading', { name: 'Finding your driver' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign nearest driver' })).toBeInTheDocument();
  });

  it('shows an error with a retry when the server is unreachable', async () => {
    vi.spyOn(api, 'getActiveRide')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(null);
    render(<RideApp riderId={RIDER_ID} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/offline or the server is unreachable/i);
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: 'Where to?' })).toBeInTheDocument();
  });
});
