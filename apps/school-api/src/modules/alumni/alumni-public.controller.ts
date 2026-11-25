import { Body, Controller, Get, HttpStatus, Ip, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Public, ResponseMessage } from '@app/common';
import { AlumniSubmissionsService } from './alumni-submissions.service';
import {
  PublicProfileDto,
  PublicRegisterDto,
  PublicSchoolDto,
  PublicUpdateDto,
  SubmissionReceivedDto,
} from './dto/alumni.dto';

@ApiTags('Public · Alumni')
@Public()
@Controller('public/alumni')
export class AlumniPublicController {
  constructor(private readonly submissions: AlumniSubmissionsService) {}

  @Get('schools/:code')
  @ApiOperation({ summary: 'School name and logo for the alumni registration form' })
  @ApiEnvelope(PublicSchoolDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  school(@Param('code') code: string) {
    return this.submissions.school(code);
  }

  @Post('schools/:code/register')
  @ResponseMessage('Thank you. The school will review your details.')
  @ApiOperation({
    summary: 'Register as an alumnus',
    description: 'Creates a submission that school staff approve before an alumni record is made.',
  })
  @ApiEnvelope(SubmissionReceivedDto, { message: 'Thank you. The school will review your details.' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT, HttpStatus.TOO_MANY_REQUESTS)
  register(@Param('code') code: string, @Body() dto: PublicRegisterDto, @Ip() ip: string) {
    return this.submissions.register(code, dto, ip ?? null);
  }

  @Get('update/:token')
  @ApiOperation({ summary: 'Contact and career details an alumnus can update with their link' })
  @ApiEnvelope(PublicProfileDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  profile(@Param('token') token: string) {
    return this.submissions.profile(token);
  }

  @Post('update/:token')
  @ResponseMessage('Thank you. The school will review your changes.')
  @ApiOperation({ summary: 'Send updated details; the link is used up and staff approve the changes' })
  @ApiEnvelope(SubmissionReceivedDto, { message: 'Thank you. The school will review your changes.' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT, HttpStatus.TOO_MANY_REQUESTS)
  update(@Param('token') token: string, @Body() dto: PublicUpdateDto, @Ip() ip: string) {
    return this.submissions.submitUpdate(token, dto, ip ?? null);
  }
}
