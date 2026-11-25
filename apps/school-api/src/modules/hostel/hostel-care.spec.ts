import {
  appendNote,
  averageRating,
  dayOfWeek,
  doseOverdue,
  duplicateIds,
  duplicateSlots,
  headcount,
  healthMessage,
  laundryMove,
  MenuRow,
  medicationRunsOn,
  missingItems,
  OverrideRow,
  resolveDay,
  skipCovers,
  skipErrors,
  skipsOverlap,
  timeIn,
  uniqueTimes,
  weekGrid,
  withinBackDays,
} from './hostel-care.logic';

const menu = (hostelId: number | null, day: number, meal: MenuRow['meal'], items: string): MenuRow => ({
  hostel_id: hostelId,
  day_of_week: day,
  meal,
  items,
  non_veg_items: null,
});

describe('hostel care logic', () => {
  describe('dayOfWeek', () => {
    it('counts from Sunday', () => {
      expect(dayOfWeek('2026-07-05')).toBe(0);
      expect(dayOfWeek('2026-07-06')).toBe(1);
      expect(dayOfWeek('2026-07-11')).toBe(6);
    });
  });

  describe('weekGrid', () => {
    it('returns 7 days of 4 meals with the hostel row winning over the school row', () => {
      const grid = weekGrid([
        menu(null, 1, 'lunch', 'Rice'),
        menu(4, 1, 'lunch', 'Biryani'),
        menu(null, 2, 'dinner', 'Chapati'),
      ]);
      expect(grid).toHaveLength(7);
      expect(grid.every((day) => day.meals.length === 4)).toBe(true);
      expect(grid[1].meals.find((meal) => meal.meal === 'lunch')).toMatchObject({
        items: 'Biryani',
        source: 'hostel_week',
      });
      expect(grid[2].meals.find((meal) => meal.meal === 'dinner')).toMatchObject({ source: 'school_week' });
      expect(grid[0].meals[0]).toMatchObject({ items: null, source: 'none' });
    });
  });

  describe('resolveDay', () => {
    const menus = [
      menu(null, 1, 'breakfast', 'Idli'),
      menu(4, 1, 'breakfast', 'Pongal'),
      menu(null, 1, 'lunch', 'Rice'),
    ];
    const override: OverrideRow = {
      id: 1,
      hostel_id: null,
      meal: 'lunch',
      items: 'Feast',
      non_veg_items: null,
      note: 'Festival',
    };

    it('prefers a date override, then the hostel week, then the school week', () => {
      const day = resolveDay('2026-07-06', menus, [override]);
      expect(day.find((meal) => meal.meal === 'breakfast')).toMatchObject({ items: 'Pongal', source: 'hostel_week' });
      expect(day.find((meal) => meal.meal === 'lunch')).toMatchObject({
        items: 'Feast',
        source: 'override',
        note: 'Festival',
      });
      expect(day.find((meal) => meal.meal === 'dinner')).toMatchObject({ items: null, source: 'none' });
    });

    it('prefers a hostel override over a school-wide override', () => {
      const day = resolveDay('2026-07-06', menus, [
        override,
        { ...override, id: 2, hostel_id: 4, items: 'Hostel feast' },
      ]);
      expect(day.find((meal) => meal.meal === 'lunch')?.items).toBe('Hostel feast');
    });

    it('ignores rows for other days', () => {
      const day = resolveDay('2026-07-07', menus, []);
      expect(day.every((meal) => meal.source === 'none')).toBe(true);
    });
  });

  describe('duplicateSlots', () => {
    it('names day and meal entered twice', () => {
      expect(
        duplicateSlots([
          { day_of_week: 1, meal: 'lunch' },
          { day_of_week: 1, meal: 'lunch' },
          { day_of_week: 2, meal: 'lunch' },
        ]),
      ).toEqual(['Monday lunch']);
    });
  });

  describe('meal skips', () => {
    const skip = {
      from_date: '2026-07-04',
      to_date: '2026-07-06',
      meals: ['lunch', 'dinner'] as const,
      status: 'active',
    };

    it('covers dates inside the range for its meals only', () => {
      expect(skipCovers({ ...skip, meals: [...skip.meals] }, '2026-07-05', 'lunch')).toBe(true);
      expect(skipCovers({ ...skip, meals: [...skip.meals] }, '2026-07-05', 'breakfast')).toBe(false);
      expect(skipCovers({ ...skip, meals: [...skip.meals] }, '2026-07-07', 'lunch')).toBe(false);
      expect(skipCovers({ ...skip, meals: [...skip.meals], status: 'cancelled' }, '2026-07-05', 'lunch')).toBe(false);
    });

    it('overlaps only when dates and a meal are shared', () => {
      const a = { ...skip, meals: [...skip.meals] };
      expect(
        skipsOverlap(a, { from_date: '2026-07-06', to_date: '2026-07-08', meals: ['dinner'], status: 'active' }),
      ).toBe(true);
      expect(
        skipsOverlap(a, { from_date: '2026-07-06', to_date: '2026-07-08', meals: ['breakfast'], status: 'active' }),
      ).toBe(false);
      expect(
        skipsOverlap(a, { from_date: '2026-07-07', to_date: '2026-07-08', meals: ['lunch'], status: 'active' }),
      ).toBe(false);
    });

    it('checks the window', () => {
      expect(skipErrors('2026-07-04', '2026-07-05', '2026-07-04')).toEqual([]);
      expect(skipErrors('2026-07-03', '2026-07-05', '2026-07-04')[0].field).toBe('from_date');
      expect(skipErrors('2026-07-06', '2026-07-05', '2026-07-04')[0].field).toBe('to_date');
      expect(skipErrors('2026-07-04', '2026-08-03', '2026-07-04')).toEqual([]);
      expect(skipErrors('2026-07-04', '2026-08-04', '2026-07-04')[0].field).toBe('to_date');
    });
  });

  describe('withinBackDays', () => {
    it('allows today and the given days back', () => {
      expect(withinBackDays('2026-07-04', '2026-07-04', 1)).toBe(true);
      expect(withinBackDays('2026-07-03', '2026-07-04', 1)).toBe(true);
      expect(withinBackDays('2026-07-02', '2026-07-04', 1)).toBe(false);
      expect(withinBackDays('2026-07-05', '2026-07-04', 1)).toBe(false);
    });
  });

  describe('headcount', () => {
    it('removes residents on leave and skipping, splits the rest by diet and counts marks', () => {
      const result = headcount([
        { diet: 'veg', status: 'ate', skip_id: null, on_leave: false },
        { diet: 'non_veg', status: null, skip_id: null, on_leave: false },
        { diet: 'eggetarian', status: null, skip_id: null, on_leave: false },
        { diet: 'veg', status: null, skip_id: 3, on_leave: false },
        { diet: 'veg', status: 'skipped', skip_id: 4, on_leave: true },
      ]);
      expect(result).toEqual({
        residents: 5,
        on_leave: 1,
        skipping: 1,
        expected: 3,
        by_diet: { veg: 1, non_veg: 1, eggetarian: 1 },
        ate: 1,
        skipped: 1,
        unmarked: 3,
      });
    });
  });

  describe('averageRating', () => {
    it('rounds to one decimal and is null without ratings', () => {
      expect(averageRating(11, 3)).toBe(3.7);
      expect(averageRating(0, 0)).toBeNull();
    });
  });

  describe('medications', () => {
    it('sorts and dedupes times', () => {
      expect(uniqueTimes(['20:00', '08:00', '08:00'])).toEqual(['08:00', '20:00']);
    });

    it('runs between from and to while active', () => {
      const course = { from_date: '2026-07-01', to_date: '2026-07-05', active: true };
      expect(medicationRunsOn(course, '2026-07-03')).toBe(true);
      expect(medicationRunsOn(course, '2026-07-06')).toBe(false);
      expect(medicationRunsOn({ ...course, to_date: null }, '2026-09-01')).toBe(true);
      expect(medicationRunsOn({ ...course, active: false }, '2026-07-03')).toBe(false);
    });

    it('marks pending doses past their time as overdue', () => {
      expect(doseOverdue('pending', '2026-07-04', '08:00', '2026-07-04', '09:15')).toBe(true);
      expect(doseOverdue('pending', '2026-07-04', '20:00', '2026-07-04', '09:15')).toBe(false);
      expect(doseOverdue('pending', '2026-07-03', '20:00', '2026-07-04', '09:15')).toBe(true);
      expect(doseOverdue('given', '2026-07-03', '20:00', '2026-07-04', '09:15')).toBe(false);
    });

    it('reads the clock in a time zone', () => {
      expect(timeIn('Asia/Kolkata', new Date('2026-07-04T02:45:00Z'))).toBe('08:15');
    });
  });

  describe('laundry', () => {
    it('moves collected to sent to returned to closed', () => {
      expect(laundryMove('collected', 'items')).toBe('collected');
      expect(laundryMove('collected', 'sent')).toBe('sent');
      expect(laundryMove('sent', 'returned')).toBe('returned');
      expect(laundryMove('collected', 'returned')).toBe('returned');
      expect(laundryMove('returned', 'close')).toBe('closed');
      expect(laundryMove('sent', 'items')).toBeNull();
      expect(laundryMove('closed', 'returned')).toBeNull();
      expect(laundryMove('sent', 'close')).toBeNull();
    });

    it('counts missing items only once returned', () => {
      expect(missingItems(6, 5)).toBe(1);
      expect(missingItems(6, 6)).toBe(0);
      expect(missingItems(6, null)).toBe(0);
    });

    it('finds ids listed twice', () => {
      expect(duplicateIds([1, 2, 1, 3, 2])).toEqual([1, 2]);
      expect(duplicateIds([1, 2])).toEqual([]);
    });
  });

  describe('healthMessage', () => {
    it('describes the condition and what was done', () => {
      expect(
        healthMessage({
          kind: 'illness',
          symptoms: 'Fever',
          temperature: 100.4,
          action_taken: 'Paracetamol given.',
          hospital_visit: false,
          in_sick_bay: true,
        }),
      ).toEqual({
        what: 'Not feeling well - Fever, temperature 100.4',
        action: 'Paracetamol given. Resting in the sick bay.',
      });
    });

    it('leaves the action empty when nothing was done', () => {
      expect(
        healthMessage({
          kind: 'checkup',
          symptoms: 'Routine',
          temperature: null,
          action_taken: null,
          hospital_visit: false,
          in_sick_bay: false,
        }).action,
      ).toBe('');
    });
  });

  describe('appendNote', () => {
    it('joins notes and keeps the current text when there is no note', () => {
      expect(appendNote('Given rest', 'Better now')).toBe('Given rest · Better now');
      expect(appendNote(null, 'Better now')).toBe('Better now');
      expect(appendNote('Given rest', null)).toBe('Given rest');
    });
  });
});
