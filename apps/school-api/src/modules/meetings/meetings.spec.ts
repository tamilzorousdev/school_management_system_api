import { createHmac } from 'node:crypto';
import { AppException } from '@app/common';
import { agoraSignatureValid, AgoraTokenService } from './agora-token.service';
import { MeetingResponse, MeetingStatus } from './entities/meeting.entity';
import {
  actualMinutes,
  canJoin,
  channelName,
  closesWhenEmpty,
  endReminderDue,
  extendedEnd,
  extensionError,
  formatMeetingTime,
  isNoShow,
  isOverTime,
  enterBlockReason,
  joinBlockReason,
  joinClosesAt,
  minutesBetween,
  overlaps,
  scheduleError,
  statusAfterJoin,
  hardStopAt,
  isPastHardStop,
} from './meetings.logic';

const at = (time: string) => new Date(`2026-11-11T${time}:00+05:30`);
const meeting = (status: MeetingStatus = 'scheduled', end = '10:30', response: MeetingResponse = 'accepted') => ({
  status,
  response,
  scheduled_at: at('10:00'),
  scheduled_end_at: at(end),
});

describe('meeting lifecycle (10:00 to 10:30, reminder at 10:25)', () => {
  it('10:00: participants can join and the first join makes it in_progress', () => {
    expect(canJoin(meeting(), at('10:00'))).toBe(true);
    expect(statusAfterJoin('scheduled', at('10:30'), at('10:00'))).toBe('in_progress');
  });

  it('opens a 10-minute lobby before the start, not earlier', () => {
    expect(canJoin(meeting(), at('09:50'))).toBe(true);
    expect(joinBlockReason(meeting(), at('09:45'))?.code).toBe('MEETING_NOT_OPEN');
  });

  it('10:25: the five-minute reminder is due once', () => {
    expect(endReminderDue({ ...meeting('in_progress'), end_reminder_sent_at: null }, at('10:25'))).toBe(true);
    expect(endReminderDue({ ...meeting('in_progress'), end_reminder_sent_at: at('10:25') }, at('10:26'))).toBe(false);
    expect(endReminderDue({ ...meeting('in_progress'), end_reminder_sent_at: null }, at('10:20'))).toBe(false);
  });

  it('does not send the end reminder for a meeting nobody joined', () => {
    expect(endReminderDue({ ...meeting('scheduled'), end_reminder_sent_at: null }, at('10:25'))).toBe(false);
  });

  it('10:30: an in-progress meeting becomes time_exceeded and is not closed', () => {
    expect(isOverTime(meeting('in_progress'), at('10:30'))).toBe(true);
    expect(isOverTime(meeting('in_progress'), at('10:29'))).toBe(false);
  });

  it('after 10:30 a running meeting stays joinable for 10 more minutes, then the link expires', () => {
    expect(canJoin(meeting('time_exceeded'), at('10:40'))).toBe(true);
    expect(canJoin(meeting('time_exceeded'), at('10:41'))).toBe(false);
    expect(joinBlockReason(meeting('in_progress'), at('13:00'))?.code).toBe('MEETING_ENDED');
    expect(hardStopAt(meeting('in_progress'))).toEqual(at('10:40'));
    expect(isPastHardStop(meeting('time_exceeded'), at('10:41'))).toBe(true);
    expect(isPastHardStop(meeting('time_exceeded'), at('10:40'))).toBe(false);
  });

  it('someone joining for the first time after the end goes straight to time_exceeded', () => {
    expect(statusAfterJoin('scheduled', at('10:30'), at('10:40'))).toBe('time_exceeded');
  });

  it('a meeting nobody joined closes for joining at its end time and becomes missed', () => {
    expect(canJoin(meeting(), at('10:30'))).toBe(true);
    expect(canJoin(meeting(), at('10:31'))).toBe(false);
    expect(isNoShow(meeting(), at('10:31'))).toBe(true);
    expect(joinBlockReason(meeting(), at('10:31'))?.code).toBe('MEETING_ENDED');
    expect(joinClosesAt(meeting())).toEqual(at('10:30'));
    expect(joinClosesAt(meeting('in_progress'))).toEqual(at('10:40'));
    expect(joinClosesAt(meeting('completed'))).toBeNull();
  });

  it('can be joined only after the invite is accepted', () => {
    expect(canJoin(meeting('scheduled', '10:30', 'pending'), at('10:00'))).toBe(false);
    expect(enterBlockReason(meeting('scheduled', '10:30', 'pending'), at('10:00'))?.code).toBe('MEETING_NOT_ACCEPTED');
    expect(enterBlockReason(meeting('scheduled', '10:30', 'declined'), at('10:00'))?.code).toBe('MEETING_DECLINED');
    expect(enterBlockReason(meeting('scheduled', '10:30', 'accepted'), at('10:00'))).toBeNull();
    expect(enterBlockReason(meeting('cancelled', '10:30', 'accepted'), at('10:00'))?.code).toBe('MEETING_CANCELLED');
  });

  it('completed, missed and cancelled meetings can never be joined again', () => {
    expect(joinBlockReason(meeting('completed'), at('10:10'))?.code).toBe('MEETING_ENDED');
    expect(joinBlockReason(meeting('missed'), at('10:10'))?.code).toBe('MEETING_ENDED');
    expect(joinBlockReason(meeting('cancelled'), at('10:10'))?.code).toBe('MEETING_CANCELLED');
  });

  it('an empty meeting closes 5 minutes after the last person left, even before the end time', () => {
    expect(closesWhenEmpty(meeting('time_exceeded'), 0, at('10:40'), at('10:45'))).toBe(true);
    expect(closesWhenEmpty(meeting('time_exceeded'), 0, at('10:40'), at('10:44'))).toBe(false);
    expect(closesWhenEmpty(meeting('time_exceeded'), 1, at('10:40'), at('11:30'))).toBe(false);
    expect(closesWhenEmpty(meeting('in_progress'), 0, at('10:05'), at('10:10'))).toBe(true);
    expect(closesWhenEmpty(meeting('in_progress'), 0, at('10:05'), at('10:09'))).toBe(false);
  });
});

describe('extension', () => {
  it('adds minutes to the scheduled end while still before it', () => {
    expect(extendedEnd(at('10:30'), 10, at('10:26')).toISOString()).toBe(at('10:40').toISOString());
  });

  it('counts from now once the end has passed', () => {
    expect(extendedEnd(at('10:30'), 10, at('10:35')).toISOString()).toBe(at('10:45').toISOString());
  });

  it('allows 120 extra minutes in total', () => {
    expect(extensionError(110, 10)).toBeNull();
    expect(extensionError(115, 10)).toContain('120');
  });
});

describe('actual duration is tracked apart from the booked length', () => {
  it('runs to now while the meeting is live and stops at the end', () => {
    const started = { started_at: at('10:02'), ended_at: null, status: 'time_exceeded' as MeetingStatus };
    expect(actualMinutes(started, at('10:50'))).toBe(48);
    expect(actualMinutes({ ...started, ended_at: at('10:41'), status: 'completed' }, at('12:00'))).toBe(39);
    expect(actualMinutes({ started_at: null, ended_at: null, status: 'scheduled' }, at('10:10'))).toBeNull();
  });

  it('counts whole minutes', () => {
    expect(minutesBetween(at('10:00'), new Date(at('10:12').getTime() + 20_000))).toBe(12);
  });
});

describe('booking rules', () => {
  const now = at('09:00');

  it('accepts a later time and refuses the past or more than 60 days ahead', () => {
    expect(scheduleError(at('10:00'), now)).toBeNull();
    expect(scheduleError(at('08:00'), now)?.message).toBe('The meeting time has already passed');
    expect(scheduleError(new Date('2027-02-01T10:00:00+05:30'), now)?.field).toBe('scheduled_at');
    expect(scheduleError(new Date('nope'), now)?.message).toBe('scheduled_at must be a date and time');
  });

  it('allows back-to-back meetings but not overlapping ones', () => {
    expect(overlaps(at('10:00'), 30, at('10:30'), 15)).toBe(false);
    expect(overlaps(at('10:00'), 30, at('10:20'), 15)).toBe(true);
  });

  it('builds a channel name Agora accepts', () => {
    expect(channelName(1, 'a1b2c3d4e5f60718')).toBe('tzs_1_a1b2c3d4e5f60718');
    expect(channelName(1, 'x'.repeat(80)).length).toBeLessThan(64);
  });

  it('formats times in the school time zone', () => {
    expect(formatMeetingTime(at('16:30'), 'Asia/Kolkata').toLowerCase()).toBe('11 nov, 4:30 pm');
  });
});

describe('AgoraTokenService', () => {
  const config = (overrides: Partial<Record<string, string | number>> = {}) =>
    ({
      agoraAppId: 'a'.repeat(32),
      agoraAppCertificate: 'b'.repeat(32),
      tokenTtlSeconds: 900,
      customerId: '',
      customerSecret: '',
      restUrl: 'https://api.sd-rtn.com',
      webhookSecret: '',
      timeoutMs: 1000,
      ...overrides,
    }) as never;
  const now = at('10:00');

  afterEach(() => jest.restoreAllMocks());

  it('refuses with 503 VIDEO_NOT_CONFIGURED without keys', () => {
    const service = new AgoraTokenService(config({ agoraAppId: '', agoraAppCertificate: '' }));
    try {
      service.issue('tzs_1_abc', 9, now);
      fail('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(503);
    }
  });

  it('issues a short-lived 007 token for the user uid', () => {
    const grant = new AgoraTokenService(config()).issue('tzs_1_abc', 9, now);
    expect(grant.token.startsWith('007')).toBe(true);
    expect(grant.expires_at.getTime() - now.getTime()).toBe(900_000);
  });

  it('cannot remove participants without the Customer ID and Secret', async () => {
    const service = new AgoraTokenService(config());
    expect(service.canRemoveParticipants).toBe(false);
    expect((await service.endChannel('tzs_1_abc')).ok).toBe(false);
  });

  it('ends a channel with a channel-wide join_channel ban (Basic auth)', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'success', id: 1953 }), { status: 200 }));
    const service = new AgoraTokenService(config({ customerId: 'customer-id', customerSecret: 'customer-secret' }));
    const result = await service.endChannel('tzs_1_abc');
    expect(result).toEqual({ ok: true, rule_id: '1953' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.sd-rtn.com/dev/v1/kicking-rule');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Basic ${Buffer.from('customer-id:customer-secret').toString('base64')}`,
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      appid: 'a'.repeat(32),
      cname: 'tzs_1_abc',
      time: 1440,
      privileges: ['join_channel'],
    });
  });

  it('reports an Agora refusal instead of throwing', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ message: 'invalid appid' }), { status: 401 }));
    const service = new AgoraTokenService(config({ customerId: 'customer-id', customerSecret: 'customer-secret' }));
    const result = await service.endChannel('tzs_1_abc');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('401');
  });
});

describe('Agora webhook signature', () => {
  const body = JSON.stringify({ noticeId: 'n1', eventType: 107, payload: { channelName: 'tzs_1_abc', uid: 9 } });
  const sign = (secret: string) => createHmac('sha256', secret).update(body).digest('hex');

  it('accepts the HMAC-SHA256 hex of the raw body', () => {
    expect(agoraSignatureValid(body, sign('webhook-secret-123'), 'webhook-secret-123')).toBe(true);
    expect(agoraSignatureValid(Buffer.from(body), sign('webhook-secret-123').toUpperCase(), 'webhook-secret-123')).toBe(
      true,
    );
  });

  it('rejects a wrong or missing signature', () => {
    expect(agoraSignatureValid(body, sign('other-secret'), 'webhook-secret-123')).toBe(false);
    expect(agoraSignatureValid(body, undefined, 'webhook-secret-123')).toBe(false);
    expect(agoraSignatureValid(`${body} `, sign('webhook-secret-123'), 'webhook-secret-123')).toBe(false);
  });
});
