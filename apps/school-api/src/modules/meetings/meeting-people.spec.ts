import { appOf, samePersonError, withoutSelf } from './meeting-people';

describe('meeting people', () => {
  it('rings the Staff app for the teacher side and the Parent app for the parent side', () => {
    expect(appOf('teacher')).toBe('staff');
    expect(appOf('parent')).toBe('parent');
  });

  it('leaves the signed-in person out of the people they can book or chat with', () => {
    const people = [
      { id: 7, name: 'Arun Prakash' },
      { id: 9, name: 'Priya Venkatesh' },
    ];
    expect(withoutSelf(people, 7)).toEqual([{ id: 9, name: 'Priya Venkatesh' }]);
    expect(withoutSelf(people, 1)).toEqual(people);
  });

  it('refuses a meeting or chat with yourself with a clear code', () => {
    expect(samePersonError().getResponse()).toMatchObject({ code: 'SAME_PERSON' });
  });
});
