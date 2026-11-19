import { stopsLeft } from './trip-handover.service';

describe('stopsLeft', () => {
  const stop = (stop_id: number, status: string) => ({ stop_id, status });

  it('keeps the stops the bus has not left yet, including the one it is at', () => {
    expect(
      stopsLeft([
        stop(1, 'departed'),
        stop(2, 'skipped'),
        stop(3, 'arrived'),
        stop(4, 'approaching'),
        stop(5, 'pending'),
      ]),
    ).toEqual([3, 4, 5]);
  });

  it('keeps the last stop when every stop is done, so the new bus can still finish the trip', () => {
    expect(stopsLeft([stop(1, 'departed'), stop(2, 'departed')])).toEqual([2]);
  });
});
