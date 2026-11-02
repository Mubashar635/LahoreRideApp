import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { deferred, makeRide } from '@/test/fixtures';
import { RideTracker } from './RideTracker';

const DRIVER = { id: 'd1', name: 'Usman Tariq', phone: '+92', vehicleModel: 'Suzuki Alto', vehiclePlate: 'LEA-1021' };

function setup(ride = makeRide()) {
  const onRideChange = vi.fn();
  const onBookAnother = vi.fn();
  const utils = render(<RideTracker ride={ride} onRideChange={onRideChange} onBookAnother={onBookAnother} />);
  return { ...utils, onRideChange, onBookAnother };
}

afterEach(() => vi.useRealTimers());

describe('RideTracker', () => {
  it('shows a requested ride with its fare and a cancel action', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Finding your driver' })).toBeInTheDocument();
    expect(screen.getByText('Rs 410')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel ride' })).toBeInTheDocument();
  });

  it('shows the assigned driver once accepted', () => {
    setup(makeRide({ status: 'ACCEPTED', driver: DRIVER, allowedActions: ['cancel', 'complete'] }));
    expect(screen.getByRole('heading', { name: 'Driver on the way' })).toBeInTheDocument();
    expect(screen.getByText('Usman Tariq')).toBeInTheDocument();
    expect(screen.getByText('LEA-1021')).toBeInTheDocument();
  });

  it('offers no cancel button when the API does not permit it', () => {
    setup(makeRide({ status: 'COMPLETED', driver: DRIVER, allowedActions: [], fare: { ...makeRide().fare, final: 410 } }));
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.getByText('Fare paid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book another ride' })).toBeInTheDocument();
  });

  it('shows a loading state while cancelling, then the cancelled ride', async () => {
    const pending = deferred<ReturnType<typeof makeRide>>();
    vi.spyOn(api, 'cancelRide').mockReturnValue(pending.promise);
    const { onRideChange } = setup();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Cancel ride' }));
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();

    const cancelled = makeRide({ status: 'CANCELLED', allowedActions: [] });
    pending.resolve(cancelled);
    await waitFor(() => expect(onRideChange).toHaveBeenCalledWith(cancelled));
  });

  it('shows an error if cancelling fails, keeping the button available', async () => {
    vi.spyOn(api, 'cancelRide').mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));
    setup();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Cancel ride' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('button', { name: 'Cancel ride' })).toBeEnabled();
  });

  it('if the ride changed before the cancel landed, it refreshes to the real status', async () => {
    vi.spyOn(api, 'cancelRide').mockRejectedValue(new ApiError(409, 'INVALID_STATE_TRANSITION', 'x'));
    const completed = makeRide({ status: 'COMPLETED', allowedActions: [] });
    vi.spyOn(api, 'getRide').mockResolvedValue(completed);
    const { onRideChange } = setup();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel ride' }));
    await waitFor(() => expect(onRideChange).toHaveBeenCalledWith(completed));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already changed/i);
  });

  it('polls for updates, warns when the connection drops, and recovers', async () => {
    vi.useFakeTimers();
    const getRide = vi
      .spyOn(api, 'getRide')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(makeRide());
    setup();

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finding your driver' })).toBeInTheDocument(); // last known state kept

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument();
    expect(getRide).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the ride is finished', async () => {
    vi.useFakeTimers();
    const getRide = vi.spyOn(api, 'getRide');
    setup(makeRide({ status: 'CANCELLED', allowedActions: [], cancellation: { by: 'RIDER', reason: null } }));

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getRide).not.toHaveBeenCalled();
  });
});
