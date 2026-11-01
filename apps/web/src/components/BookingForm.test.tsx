import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { deferred, ESTIMATES, makeRide, RIDER_ID } from '@/test/fixtures';
import { BookingForm } from './BookingForm';

beforeEach(() => {
  vi.spyOn(api, 'estimateFares').mockResolvedValue(ESTIMATES);
});

function setup() {
  const onRideCreated = vi.fn();
  const onActiveRideFound = vi.fn();
  const user = userEvent.setup();
  render(<BookingForm riderId={RIDER_ID} onRideCreated={onRideCreated} onActiveRideFound={onActiveRideFound} />);
  return { user, onRideCreated, onActiveRideFound };
}

async function chooseTrip(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Pickup'), 'Liberty Market, Gulberg');
  await user.type(screen.getByLabelText('Destination'), 'Model Town Park');
}

describe('BookingForm', () => {
  it('shows the empty state and disables requesting until a trip is chosen', () => {
    setup();
    expect(screen.getByText(/choose a pickup and destination to see fares/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request ride/i })).toBeDisabled();
  });

  it('shows a loading state while fares are calculated, then the fares', async () => {
    const pending = deferred<typeof ESTIMATES>();
    vi.mocked(api.estimateFares).mockReturnValue(pending.promise);
    const { user } = setup();

    await chooseTrip(user);
    expect(screen.getByRole('status')).toHaveTextContent(/calculating fares/i);

    pending.resolve(ESTIMATES);
    expect(await screen.findByText('Rs 410')).toBeInTheDocument();
    expect(screen.getByText('Pickup in 3 min')).toBeInTheDocument();
    expect(screen.getByText('No drivers nearby')).toBeInTheDocument(); // Comfort has none
    expect(screen.getByRole('button', { name: 'Request Economy · Rs 410' })).toBeEnabled();
  });

  it('shows an error when fares fail to load and recovers on "Try again"', async () => {
    vi.mocked(api.estimateFares)
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(ESTIMATES);
    const { user } = setup();

    await chooseTrip(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Rs 410')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('flags places that are not in the list and identical pickup/destination', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Pickup'), 'Somewhere unknown');
    expect(screen.getByText(/choose a place from the suggestions/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Pickup'));
    await user.type(screen.getByLabelText('Pickup'), 'Model Town Park');
    await user.type(screen.getByLabelText('Destination'), 'Model Town Park');
    expect(screen.getByText(/must be different/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request/i })).toBeDisabled();
  });

  it('disables the button while requesting and reports success', async () => {
    const pending = deferred<ReturnType<typeof makeRide>>();
    const create = vi.spyOn(api, 'createRide').mockReturnValue(pending.promise);
    const { user, onRideCreated } = setup();
    await chooseTrip(user);

    await user.click(await screen.findByRole('button', { name: /request economy/i }));
    expect(screen.getByRole('button', { name: 'Requesting…' })).toBeDisabled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ riderId: RIDER_ID, category: 'ECONOMY' }),
      expect.any(String),
    );

    const ride = makeRide();
    pending.resolve(ride);
    await waitFor(() => expect(onRideCreated).toHaveBeenCalledWith(ride));
  });

  it('after a network failure, retrying reuses the same Idempotency-Key (no duplicate ride)', async () => {
    const create = vi
      .spyOn(api, 'createRide')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(makeRide());
    const { user, onRideCreated } = setup();
    await chooseTrip(user);

    await user.click(await screen.findByRole('button', { name: /request economy/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);

    await user.click(screen.getByRole('button', { name: /request economy/i }));
    await waitFor(() => expect(onRideCreated).toHaveBeenCalled());
    expect(create.mock.calls[0]![1]).toBe(create.mock.calls[1]![1]);
  });

  it('after a definite rejection, the next attempt uses a new key', async () => {
    const create = vi
      .spyOn(api, 'createRide')
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'Pickup is outside the service area'))
      .mockResolvedValueOnce(makeRide());
    const { user } = setup();
    await chooseTrip(user);

    await user.click(await screen.findByRole('button', { name: /request economy/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/outside the service area/i);
    await user.click(screen.getByRole('button', { name: /request economy/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]![1]).not.toBe(create.mock.calls[1]![1]);
  });

  it('opens the existing ride when the rider already has one in progress', async () => {
    vi.spyOn(api, 'createRide').mockRejectedValue(
      new ApiError(409, 'ACTIVE_RIDE_EXISTS', 'x', { activeRideId: 'existing-ride' }),
    );
    const { user, onActiveRideFound } = setup();
    await chooseTrip(user);

    await user.click(await screen.findByRole('button', { name: /request economy/i }));
    await waitFor(() => expect(onActiveRideFound).toHaveBeenCalledWith('existing-ride'));
  });
});
