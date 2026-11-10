import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, Public, ResponseMessage } from '@app/common';
import { AuthService, RequestMeta } from './auth.service';
import {
  LoginResponseDto,
  OtpSentDto,
  RefreshTokenDto,
  RequestOtpDto,
  TokenPairDto,
  VerifyOtpDto,
} from './dto/auth.dto';

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('OTP sent')
  @ApiOperation({
    summary: 'Step 1: send an OTP to a registered mobile number',
    description:
      'The number must be an active user of the school system. With AUTH_PROVIDER=central the OTP is sent by the Tamilzorous Auth Service (valid 15 minutes); a user missing there is registered on the first request. On Android send app_hash so the app reads the OTP from the SMS by itself. Errors: MOBILE_NOT_REGISTERED (404), ACCOUNT_INACTIVE (403), OTP_RESEND_TOO_SOON / OTP_RATE_LIMITED (429), SMS_FAILED / AUTH_SERVICE_UNAVAILABLE (503).',
  })
  @ApiEnvelope(OtpSentDto, { message: 'OTP sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.TOO_MANY_REQUESTS)
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.auth.requestOtp(dto, meta(req));
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('OTP sent again')
  @ApiOperation({
    summary: 'Send the OTP again (the "Resend OTP" button)',
    description:
      'Same body and checks as otp/request; use it after resend_in seconds. Send app_hash on Android so the new SMS is also read automatically. Errors: MOBILE_NOT_REGISTERED (404), ACCOUNT_INACTIVE (403), OTP_RESEND_TOO_SOON / OTP_RATE_LIMITED (429), AUTH_SERVICE_UNAVAILABLE (503).',
  })
  @ApiEnvelope(OtpSentDto, { message: 'OTP sent again' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.TOO_MANY_REQUESTS)
  resendOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.auth.resendOtp(dto, meta(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  @ApiOperation({
    summary: 'Step 2: verify the OTP and receive tokens with the user profile',
    description:
      'The code is checked by the Auth Service (AUTH_PROVIDER=central) and the school session is issued here. Errors: OTP_INVALID / OTP_EXPIRED (401), OTP_ATTEMPTS_EXCEEDED (429), AUTH_SERVICE_UNAVAILABLE (503). Send client.push_token (the OneSignal subscription id; fcm_token still works) to register push in the same call.',
  })
  @ApiEnvelope(LoginResponseDto, { message: 'Signed in' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.auth.verifyOtp(dto, meta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token refreshed')
  @ApiOperation({
    summary: 'Get a new access token. The refresh token rotates: always store the new one.',
    description: 'Errors: SESSION_INVALID / SESSION_REVOKED / ACCOUNT_INACTIVE (401) mean the user must sign in again.',
  })
  @ApiEnvelope(TokenPairDto, { message: 'Token refreshed' })
  @ApiErrors(HttpStatus.UNAUTHORIZED)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End this session and stop push to this device' })
  @ApiEnvelope(undefined, { message: 'Signed out' })
  @ApiErrors(HttpStatus.UNAUTHORIZED)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user);
    return null;
  }
}
