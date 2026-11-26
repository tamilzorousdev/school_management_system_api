import { GallerySettings } from './entities/gallery.entity';
import { csvEscape, toCsv } from './gallery-export';
import { scrubIsoMetadata } from './gallery-media.service';
import { destructiveChanges } from './gallery-settings.service';
import { GallerySigner } from './gallery-signer';
import {
  addPeriod,
  AlbumAccessFacts,
  bindNamed,
  canDeleteMedia,
  canManageAlbum,
  canUploadTo,
  canViewAlbum,
  classKey,
  expiryFor,
  holdActive,
  isoVideoSeconds,
  nextRunAfter,
  normalizeTags,
  parseRange,
  PolicyRule,
  resolveRetention,
  RetentionSubject,
  sniffFormat,
  storageLevel,
  trashDateFor,
  Viewer,
  visibilityProblem,
} from './gallery.logic';

const box = (type: string, payload: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
};

function mvhd(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(100);
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(duration, 16);
  return box('mvhd', payload);
}

function mp4(seconds: number, extra: Buffer[] = []): Buffer {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomavc1', 'latin1'));
  return Buffer.concat([
    ftyp,
    box('moov', Buffer.concat([mvhd(1000, seconds * 1000), ...extra])),
    box('mdat', Buffer.alloc(16)),
  ]);
}

const viewer = (patch: Partial<Viewer> = {}): Viewer => ({
  user_id: 7,
  can_view_all: false,
  can_manage_all: false,
  is_staff: false,
  is_parent: false,
  teaching_sections: [],
  teaching_classes: [],
  class_teacher_sections: [],
  class_teacher_classes: [],
  child_sections: [],
  child_classes: [],
  ...patch,
});

const album = (patch: Partial<AlbumAccessFacts> = {}): AlbumAccessFacts => ({
  scope: 'section',
  status: 'published',
  visibility: 'everyone',
  academic_year_id: 5,
  class_id: 3,
  section_id: 12,
  class_ids: null,
  section_ids: null,
  created_by: 99,
  ...patch,
});

const policy = (patch: Partial<PolicyRule>): PolicyRule => ({
  id: 1,
  target: 'category',
  album_id: null,
  category_id: null,
  academic_year_id: null,
  scope: null,
  media_type: null,
  retention_value: 5,
  retention_unit: 'years',
  keep_forever: false,
  is_active: true,
  ...patch,
});

const subject: RetentionSubject = {
  album_id: 9,
  album_status: 'published',
  category_id: 4,
  academic_year_id: 5,
  scope: 'section',
  media_type: 'image',
};

describe('gallery file checks', () => {
  it('recognises formats by their bytes, not the name', () => {
    expect(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(12).fill(0)]))?.format).toBe('jpeg');
    expect(sniffFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))?.format).toBe('png');
    expect(sniffFormat(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))?.format).toBe('webp');
    expect(sniffFormat(mp4(3))).toMatchObject({ media_type: 'video', format: 'mp4' });
    expect(sniffFormat(box('ftyp', Buffer.from('qt  \0\0\0\0', 'latin1')))?.format).toBe('mov');
    expect(sniffFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(12).fill(0)]))?.format).toBe('webm');
  });

  it('refuses scripts, HEIC and short junk', () => {
    expect(sniffFormat(Buffer.from('<?php echo 1; ?>  ', 'latin1'))).toBeNull();
    expect(sniffFormat(box('ftyp', Buffer.from('heic\0\0\0\0', 'latin1')))).toBeNull();
    expect(sniffFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('reads MP4 duration from the movie header and survives broken files', () => {
    expect(isoVideoSeconds(mp4(42))).toBe(42);
    expect(isoVideoSeconds(Buffer.from('not a video at all', 'latin1'))).toBeNull();
    expect(isoVideoSeconds(mp4(42).subarray(0, 40))).toBeNull();
  });

  it('turns location boxes inside moov into free boxes without moving any bytes', () => {
    const file = mp4(5, [box('udta', Buffer.from('\xa9xyz+12.97+077.59/', 'latin1')), box('meta', Buffer.alloc(8))]);
    const before = file.length;
    expect(scrubIsoMetadata(file)).toBe(2);
    expect(file.length).toBe(before);
    expect(file.includes(Buffer.from('udta'))).toBe(false);
    expect(isoVideoSeconds(file)).toBe(5);
  });

  it('parses byte ranges for video seeking', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=2000-', 1000)).toBe('invalid');
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});

describe('gallery retention', () => {
  it('adds calendar months and years, clamping the day', () => {
    expect(addPeriod(new Date('2026-01-31T10:00:00Z'), 1, 'months').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addPeriod(new Date('2024-02-29T00:00:00Z'), 1, 'years').toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(addPeriod(new Date('2026-11-20T00:00:00Z'), 30, 'days').toISOString()).toBe('2026-12-20T00:00:00.000Z');
  });

  it('defaults to one year from upload', () => {
    const retention = resolveRetention(subject, [], { retention_value: 1, retention_unit: 'years' });
    expect(retention.source).toBe('default');
    expect(expiryFor(new Date('2026-11-20T00:00:00Z'), retention)?.toISOString()).toBe('2027-11-20T00:00:00.000Z');
  });

  it('lets the most specific active policy win', () => {
    const rules = [
      policy({ id: 1, target: 'media_type', media_type: 'image', retention_value: 2 }),
      policy({ id: 2, target: 'category', category_id: 4, retention_value: 5 }),
      policy({ id: 3, target: 'album', album_id: 9, keep_forever: true }),
      policy({ id: 4, target: 'scope', scope: 'section', retention_value: 3, is_active: false }),
    ];
    const fallback = { retention_value: 1, retention_unit: 'years' as const };
    expect(resolveRetention(subject, rules, fallback)).toMatchObject({ forever: true, source: 'policy:3' });
    expect(resolveRetention({ ...subject, album_id: 10 }, rules, fallback)).toMatchObject({
      value: 5,
      source: 'policy:2',
    });
    expect(resolveRetention({ ...subject, album_id: 10, category_id: null }, rules, fallback).source).toBe('policy:1');
    expect(
      resolveRetention({ ...subject, album_id: 10, category_id: null, media_type: 'video' }, rules, fallback).source,
    ).toBe('default');
  });

  it('applies the archived policy only to archived albums', () => {
    const rules = [policy({ id: 8, target: 'archived', retention_value: 10 })];
    const fallback = { retention_value: 1, retention_unit: 'years' as const };
    expect(resolveRetention(subject, rules, fallback).source).toBe('default');
    expect(resolveRetention({ ...subject, album_status: 'archived' }, rules, fallback).source).toBe('policy:8');
  });

  it('never trashes before the notice period, even when already expired', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    expect(trashDateFor(new Date('2026-01-01T00:00:00Z'), now, 30).toISOString()).toBe('2026-12-20T00:00:00.000Z');
    expect(trashDateFor(new Date('2027-03-01T00:00:00Z'), now, 30).toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });

  it('treats holds as active until released or past keep_until', () => {
    expect(holdActive({ keep_until: null, released_at: null }, '2026-11-20')).toBe(true);
    expect(holdActive({ keep_until: '2026-11-20', released_at: null }, '2026-11-20')).toBe(true);
    expect(holdActive({ keep_until: '2026-11-19', released_at: null }, '2026-11-20')).toBe(false);
    expect(holdActive({ keep_until: null, released_at: new Date() }, '2026-11-20')).toBe(false);
  });

  it('asks for confirmation when settings can delete media sooner', () => {
    const base = {
      retention_value: 1,
      retention_unit: 'years',
      notice_days: 30,
      recovery_days: 30,
      permanent_delete_enabled: true,
      auto_trash_enabled: true,
      cleanup_enabled: true,
    } as GallerySettings;
    expect(destructiveChanges(base, { ...base, retention_value: 2 } as GallerySettings)).toEqual([]);
    expect(
      destructiveChanges(base, { ...base, retention_unit: 'months', retention_value: 6 } as GallerySettings),
    ).toEqual(['shorter default retention']);
    expect(destructiveChanges(base, { ...base, recovery_days: 7, notice_days: 1 } as GallerySettings)).toHaveLength(2);
    expect(destructiveChanges({ ...base, cleanup_enabled: false } as GallerySettings, base)).toEqual([
      'automatic cleanup switched on',
    ]);
  });
});

describe('gallery cleanup schedule', () => {
  const schedule = {
    cleanup_frequency: 'daily' as const,
    cleanup_time: '02:00',
    cleanup_weekday: 1,
    cleanup_month_day: 1,
    time_zone: 'Asia/Kolkata',
  };

  it('runs daily at the local time', () => {
    expect(nextRunAfter(schedule, new Date('2026-11-20T10:00:00Z')).toISOString()).toBe('2026-11-20T20:30:00.000Z');
    expect(nextRunAfter(schedule, new Date('2026-11-19T19:00:00Z')).toISOString()).toBe('2026-11-19T20:30:00.000Z');
  });

  it('runs weekly on the chosen weekday and monthly on the chosen day', () => {
    const friday = new Date('2026-11-20T10:00:00Z');
    expect(nextRunAfter({ ...schedule, cleanup_frequency: 'weekly', cleanup_weekday: 1 }, friday).toISOString()).toBe(
      '2026-11-22T20:30:00.000Z',
    );
    expect(
      nextRunAfter({ ...schedule, cleanup_frequency: 'monthly', cleanup_month_day: 1 }, friday).toISOString(),
    ).toBe('2026-11-30T20:30:00.000Z');
  });

  it('respects daylight saving zones', () => {
    const london = { ...schedule, time_zone: 'Europe/London' };
    expect(nextRunAfter(london, new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-07-02T01:00:00.000Z');
    expect(nextRunAfter(london, new Date('2026-12-01T12:00:00Z')).toISOString()).toBe('2026-12-02T02:00:00.000Z');
  });
});

describe('gallery access', () => {
  it('lets managers do everything', () => {
    const admin = viewer({ can_view_all: true, can_manage_all: true });
    expect(canViewAlbum(album({ status: 'draft' }), admin)).toBe(true);
    expect(canManageAlbum(album({ scope: 'school', section_id: null, class_id: null }), admin)).toBe(true);
  });

  it('keeps teachers to the sections they teach', () => {
    const teacher = viewer({ is_staff: true, teaching_sections: [12], teaching_classes: [classKey(5, 3)] });
    expect(canViewAlbum(album(), teacher)).toBe(true);
    expect(canViewAlbum(album({ section_id: 13 }), teacher)).toBe(false);
    expect(canUploadTo({ scope: 'section', academic_year_id: 5, class_id: 3, section_id: 12 }, teacher)).toBe(true);
    expect(canUploadTo({ scope: 'section', academic_year_id: 5, class_id: 3, section_id: 13 }, teacher)).toBe(false);
    expect(canUploadTo({ scope: 'school', academic_year_id: 5, class_id: null, section_id: null }, teacher)).toBe(
      false,
    );
  });

  it('lets a teacher manage only their own albums, and a class teacher every album of the section', () => {
    const teacher = viewer({ is_staff: true, teaching_sections: [12], teaching_classes: [classKey(5, 3)] });
    expect(canManageAlbum(album({ created_by: 99 }), teacher)).toBe(false);
    expect(canManageAlbum(album({ created_by: 7 }), teacher)).toBe(true);
    const lead = viewer({
      is_staff: true,
      teaching_sections: [12],
      teaching_classes: [classKey(5, 3)],
      class_teacher_sections: [12],
      class_teacher_classes: [classKey(5, 3)],
    });
    expect(canManageAlbum(album({ created_by: 99 }), lead)).toBe(true);
    expect(canDeleteMedia(album(), { created_by: 99 }, lead, false)).toBe(true);
  });

  it('honours the teachers-delete-own switch', () => {
    const teacher = viewer({ is_staff: true, teaching_sections: [12], teaching_classes: [classKey(5, 3)] });
    expect(canDeleteMedia(album(), { created_by: 7 }, teacher, true)).toBe(true);
    expect(canDeleteMedia(album(), { created_by: 7 }, teacher, false)).toBe(false);
    expect(canDeleteMedia(album(), { created_by: 8 }, teacher, true)).toBe(false);
  });

  it('shows parents only published albums of their child’s class or section', () => {
    const parent = viewer({ is_parent: true, child_sections: [12], child_classes: [classKey(5, 3)] });
    expect(canViewAlbum(album(), parent)).toBe(true);
    expect(canViewAlbum(album({ section_id: 13 }), parent)).toBe(false);
    expect(canViewAlbum(album({ status: 'draft' }), parent)).toBe(false);
    expect(canViewAlbum(album({ status: 'archived' }), parent)).toBe(false);
    expect(canViewAlbum(album({ visibility: 'staff' }), parent)).toBe(false);
    expect(canViewAlbum(album({ scope: 'class', section_id: null }), parent)).toBe(true);
    expect(canViewAlbum(album({ scope: 'class', section_id: null, academic_year_id: 6 }), parent)).toBe(false);
  });

  it('applies school album visibility to parents and staff', () => {
    const school = album({ scope: 'school', class_id: null, section_id: null });
    const parent = viewer({ is_parent: true, child_sections: [12], child_classes: [classKey(5, 3)] });
    const staff = viewer({ is_staff: true });
    expect(canViewAlbum({ ...school, visibility: 'everyone' }, parent)).toBe(true);
    expect(canViewAlbum({ ...school, visibility: 'staff' }, parent)).toBe(false);
    expect(canViewAlbum({ ...school, visibility: 'parents' }, staff)).toBe(false);
    expect(canViewAlbum({ ...school, visibility: 'classes', class_ids: [3] }, parent)).toBe(true);
    expect(canViewAlbum({ ...school, visibility: 'classes', class_ids: [4], section_ids: [20] }, parent)).toBe(false);
    expect(canViewAlbum({ ...school, visibility: 'classes', section_ids: [12] }, parent)).toBe(true);
    expect(canViewAlbum({ ...school, status: 'draft' }, staff)).toBe(false);
  });

  it('checks visibility choices by scope', () => {
    expect(visibilityProblem('section', 'parents', null, null)).not.toBeNull();
    expect(visibilityProblem('section', 'staff', null, null)).toBeNull();
    expect(visibilityProblem('school', 'classes', [], [])).not.toBeNull();
    expect(visibilityProblem('school', 'classes', [3], null)).toBeNull();
  });
});

describe('gallery helpers', () => {
  it('signs links per media, variant and user, and expires them', () => {
    const signer = new GallerySigner('a-test-secret-that-is-long-enough-123', 60);
    const now = Date.UTC(2026, 10, 20);
    const query = signer.sign(88, 'download', 7, now);
    expect(signer.verify(88, query, now)).toBe(true);
    expect(signer.verify(89, query, now)).toBe(false);
    expect(signer.verify(88, { ...query, variant: 'view' }, now)).toBe(false);
    expect(signer.verify(88, { ...query, user: 8 }, now)).toBe(false);
    expect(signer.verify(88, query, now + 61_000)).toBe(false);
  });

  it('binds named parameters in order and leaves casts alone', () => {
    const [sql, params] = bindNamed(
      "SELECT 1 WHERE a = :school AND b >= (:from::date) AND c = :school AND d = 'HH24:MI' AND e = :missing",
      { school: 4, from: '2026-01-01' },
    );
    expect(sql).toBe("SELECT 1 WHERE a = $1 AND b >= ($2::date) AND c = $1 AND d = 'HH24:MI' AND e = :missing");
    expect(params).toEqual([4, '2026-01-01']);
  });

  it('writes CSV safely against spreadsheet formulas', () => {
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape(null)).toBe('');
    expect(toCsv({ columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Asha' }] })).toBe('Name\r\nAsha');
  });

  it('reports storage level and tidies tags', () => {
    expect(storageLevel(70 * 1024 * 1024, 100, 80)).toBe('ok');
    expect(storageLevel(85 * 1024 * 1024, 100, 80)).toBe('warning');
    expect(storageLevel(100 * 1024 * 1024, 100, 80)).toBe('full');
    expect(normalizeTags([' Sports  Day ', 'sports day', '', 'Relay'])).toEqual(['sports day', 'relay']);
  });
});
