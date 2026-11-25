import {
  assetsToAdd,
  canChangeLockerStatus,
  DEFAULT_CHECKLIST,
  inspectionResult,
  inspectionScore,
  issueSummary,
  lockerAfterReturn,
  lockerCounts,
  lockerNumbers,
  missingKeys,
  returnNote,
} from './hostel-rooms.logic';

describe('hostel rooms logic', () => {
  describe('inspectionScore', () => {
    it('is the share of ok among ok and issue items, rounded', () => {
      expect(inspectionScore([{ result: 'ok' }, { result: 'ok' }, { result: 'issue' }, { result: 'na' }])).toBe(67);
    });

    it('is 100 when nothing is marked ok or issue', () => {
      expect(inspectionScore([])).toBe(100);
      expect(inspectionScore([{ result: 'na' }, { result: 'na' }])).toBe(100);
    });

    it('is 0 when every marked item is an issue', () => {
      expect(inspectionScore([{ result: 'issue' }, { result: 'na' }])).toBe(0);
    });
  });

  describe('inspectionResult', () => {
    it('is issues when any item is an issue', () => {
      expect(inspectionResult([{ result: 'ok' }, { result: 'issue' }])).toBe('issues');
    });

    it('is ok otherwise', () => {
      expect(inspectionResult([{ result: 'ok' }, { result: 'na' }])).toBe('ok');
      expect(inspectionResult([])).toBe('ok');
    });
  });

  describe('issueSummary', () => {
    it('lists the issue items with their notes', () => {
      expect(
        issueSummary([
          { item: 'Fan & lights', result: 'issue', note: 'Tube light flickers' },
          { item: 'Cupboard', result: 'ok' },
          { item: 'Windows & doors', result: 'issue' },
        ]),
      ).toBe('Room inspection issues: Fan & lights: Tube light flickers; Windows & doors');
    });

    it('is null when there are no issues', () => {
      expect(issueSummary([{ item: 'Cupboard', result: 'ok' }])).toBeNull();
    });

    it('is cut to the limit', () => {
      expect(issueSummary([{ item: 'x'.repeat(50), result: 'issue' }], 30)).toHaveLength(30);
    });
  });

  it('has the default checklist', () => {
    expect(DEFAULT_CHECKLIST).toContain('Bed & mattress');
    expect(DEFAULT_CHECKLIST).toContain('No banned items');
    expect(DEFAULT_CHECKLIST).toHaveLength(9);
  });

  describe('lockers', () => {
    it('numbers lockers with prefix and padding', () => {
      expect(lockerNumbers('L-', 9, 3, 3)).toEqual(['L-009', 'L-010', 'L-011']);
      expect(lockerNumbers('', 1, 2, 0)).toEqual(['1', '2']);
    });

    it('changes status only when not allotted', () => {
      expect(canChangeLockerStatus('allotted')).toBe(false);
      expect(canChangeLockerStatus('available')).toBe(true);
      expect(canChangeLockerStatus('damaged')).toBe(true);
      expect(canChangeLockerStatus('blocked')).toBe(true);
    });

    it('counts missing keys', () => {
      expect(missingKeys(2, 1)).toBe(1);
      expect(missingKeys(1, 1)).toBe(0);
      expect(missingKeys(0, 0)).toBe(0);
    });

    it('is available after return unless damaged', () => {
      expect(lockerAfterReturn(false)).toBe('available');
      expect(lockerAfterReturn(true)).toBe('damaged');
    });

    it('notes missing keys on return', () => {
      expect(returnNote(1, null)).toBe('1 key not returned');
      expect(returnNote(2, 'Hinge loose')).toBe('2 keys not returned · Hinge loose');
      expect(returnNote(0, 'Clean')).toBe('Clean');
      expect(returnNote(0, null)).toBeNull();
    });

    it('sums locker counts by status', () => {
      expect(
        lockerCounts([
          { status: 'available', count: 3 },
          { status: 'allotted', count: '5' },
          { status: 'blocked', count: 1 },
        ]),
      ).toEqual({ total: 9, available: 3, allotted: 5, damaged: 0, blocked: 1 });
    });
  });

  describe('assetsToAdd', () => {
    it('skips items the room already has, ignoring case and spaces', () => {
      expect(
        assetsToAdd(
          ['Ceiling fan', 'cot'],
          [
            { item_name: 'ceiling FAN ', quantity: 1 },
            { item_name: 'Study table', quantity: 4 },
            { item_name: 'Cot', quantity: 4 },
          ],
        ),
      ).toEqual([{ item_name: 'Study table', quantity: 4 }]);
    });

    it('adds a repeated item only once', () => {
      expect(
        assetsToAdd(
          [],
          [
            { item_name: 'Chair', quantity: 2 },
            { item_name: 'chair', quantity: 3 },
          ],
        ),
      ).toEqual([{ item_name: 'Chair', quantity: 2 }]);
    });
  });
});
