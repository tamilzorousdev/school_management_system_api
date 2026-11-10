import { AppException } from '@app/common';
import {
  appHashRejected,
  authEmail,
  CentralAuthClient,
  centralMessage,
  otpSendSummary,
  centralRole,
  mapCentralError,
  otpPayload,
} from './central-auth.client';

const codeOf = (error: AppException) => (error.getResponse() as { code: string }).code;

describe('centralRole', () => {
  it('sends school admins and the super admin as TENANT', () => {
    expect(centralRole(['ADMIN'])).toBe('TENANT');
    expect(centralRole(['SUPER_ADMIN'])).toBe('TENANT');
  });

  it('sends parents, teachers and other staff as TECHNICIAN', () => {
    expect(centralRole(['PARENT'])).toBe('TECHNICIAN');
    expect(centralRole(['TEACHER', 'HOD'])).toBe('TECHNICIAN');
    expect(centralRole([])).toBe('TECHNICIAN');
  });
});

describe('authEmail', () => {
  it('builds an address from the name and the last 4 digits', () => {
    expect(authEmail('Kavin Narayanan', '9876543210', 'school.tamilzorous.com')).toBe(
      'kavin.narayanan.3210@school.tamilzorous.com',
    );
  });

  it('uses the full mobile for the second try', () => {
    expect(authEmail('Kavin Narayanan', '9876543210', 'school.tamilzorous.com', true)).toBe(
      'kavin.narayanan.9876543210@school.tamilzorous.com',
    );
  });

  it('keeps only letters and digits, even for Tamil names', () => {
    expect(authEmail('S. Ravi Kumar (Father)', '9000000001', 'x.com')).toBe('s.ravi.kumar.father.0001@x.com');
    expect(authEmail('முருகன்', '9000000002', 'x.com')).toBe('user.0002@x.com');
  });
});

describe('mapCentralError', () => {
  it.each([
    [400, 'Please wait 25 seconds before requesting a new OTP', 'OTP_RESEND_TOO_SOON'],
    [400, 'Maximum OTP attempts exceeded', 'OTP_ATTEMPTS_EXCEEDED'],
    [400, 'OTP has expired. Please request a new OTP', 'OTP_EXPIRED'],
    [400, 'OTP not found. Please request a new OTP', 'OTP_EXPIRED'],
    [400, 'Invalid OTP', 'OTP_INVALID'],
    [429, 'ThrottlerException: Too Many Requests', 'OTP_RATE_LIMITED'],
    [500, 'Internal server error', 'AUTH_SERVICE_UNAVAILABLE'],
  ])('%s "%s" → %s', (status, message, code) => {
    expect(codeOf(mapCentralError(status, message))).toBe(code);
  });

  it('reads string and list messages', () => {
    expect(centralMessage({ message: ['email must be an email', 'name should not be empty'] })).toBe(
      'email must be an email; name should not be empty',
    );
    expect(centralMessage(null)).toBe('');
  });
});

describe('OTP with app hash', () => {
  const config = { provider: 'central', url: 'http://auth.test/api/auth', timeoutMs: 1000, emailDomain: 'x.com' };
  const client = new CentralAuthClient(config as never);
  const reply = (status: number, body: object) =>
    ({ status, json: () => Promise.resolve(body) }) as unknown as Response;
  const sent = (call: unknown[]) => ({
    url: call[0] as string,
    body: JSON.parse((call[1] as { body: string }).body) as object,
  });
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('adds app_hash only when the app sent one', () => {
    expect(otpPayload('9876543210', 'Xy12AbCd3Ef')).toEqual({ mobile: '9876543210', app_hash: 'Xy12AbCd3Ef' });
    expect(otpPayload('9876543210')).toEqual({ mobile: '9876543210' });
    expect(otpPayload('9876543210', null)).toEqual({ mobile: '9876543210' });
  });

  it('spots an Auth Service that does not know app_hash yet', () => {
    expect(appHashRejected(400, { message: ['property app_hash should not exist'] })).toBe(true);
    expect(appHashRejected(400, { message: 'Invalid OTP' })).toBe(false);
    expect(appHashRejected(200, { message: 'OTP sent successfully' })).toBe(false);
  });

  it('sends the hash to send-otp and resend-otp', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, message: 'OTP sent successfully' }));
    await client.sendOtp('9876543210', 'Xy12AbCd3Ef');
    await client.resendOtp('9876543210', 'Xy12AbCd3Ef');
    expect(fetchMock.mock.calls.map(sent)).toEqual([
      { url: 'http://auth.test/api/auth/send-otp', body: { mobile: '9876543210', app_hash: 'Xy12AbCd3Ef' } },
      { url: 'http://auth.test/api/auth/resend-otp', body: { mobile: '9876543210', app_hash: 'Xy12AbCd3Ef' } },
    ]);
  });

  it('sends again without the hash when the Auth Service refuses it', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(400, { message: ['property app_hash should not exist'] }))
      .mockResolvedValueOnce(reply(200, { success: true }));
    await client.resendOtp('9876543210', 'Xy12AbCd3Ef');
    expect(fetchMock.mock.calls.map(sent).map((call) => call.body)).toEqual([
      { mobile: '9876543210', app_hash: 'Xy12AbCd3Ef' },
      { mobile: '9876543210' },
    ]);
  });

  it('keeps the resend wait message as OTP_RESEND_TOO_SOON', async () => {
    fetchMock.mockResolvedValue(reply(400, { message: 'Please wait 25 seconds before requesting a new OTP' }));
    await expect(client.resendOtp('9876543210')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OTP_RESEND_TOO_SOON' }) as unknown,
    });
  });
});

describe('OTP send log', () => {
  it('shows the Auth Service reply without the OTP or tokens', () => {
    const text = otpSendSummary(200, {
      success: true,
      message: 'OTP sent successfully',
      data: { channel: 'sms', queued: true, otp: '482913', meta: { accessToken: 'abc' } },
    });
    expect(text).toBe(
      'HTTP 200, "OTP sent successfully" data={"channel":"sms","queued":true,"otp":"***","meta":{"accessToken":"***"}}',
    );
    expect(text).not.toContain('482913');
  });

  it('works when the reply has no body', () => {
    expect(otpSendSummary(200, null)).toBe('HTTP 200, "no message"');
  });
});
