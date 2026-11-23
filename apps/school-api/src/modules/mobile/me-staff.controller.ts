import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, ResponseMessage } from '@app/common';
import { MonthQueryDto } from '../attendance/dto/attendance.dto';
import { MyBankListDto, MyStaffProfileDto, UpdateMyStaffProfileDto } from '../staff/dto/my-staff.dto';
import { QualificationInputDto, StaffDocumentInputDto } from '../staff/dto/staff-input.dto';
import { QualificationDto, StaffDocumentDto } from '../staff/dto/staff-response.dto';
import { MyStaffService } from '../staff/my-staff.service';
import { CheckInStatusDto, LocationDto, StaffMonthDto } from '../staff-attendance/dto/staff-attendance.dto';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import { LeaveBalanceDto, StaffLeaveDto, StaffLeaveInputDto } from '../staff-leave/dto/staff-leave.dto';
import { StaffLeaveService } from '../staff-leave/staff-leave.service';
import { MobileAccessService } from './mobile-access.service';

const ANY_STAFF =
  'Any signed-in staff member (teacher, AO, office staff); 404 STAFF_NOT_FOUND when there is no staff record.';

@ApiTags('Me · Staff profile')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND)
@Controller('me/staff')
export class MeStaffController {
  constructor(
    private readonly mine: MyStaffService,
    private readonly access: MobileAccessService,
    private readonly staffAttendance: StaffAttendanceService,
    private readonly staffLeaves: StaffLeaveService,
  ) {}

  @Get('profile')
  @ApiOperation({
    summary: 'My staff profile with photo; editable lists what I can change myself',
    description: ANY_STAFF,
  })
  @ApiEnvelope(MyStaffProfileDto)
  profile(@CurrentUser() user: AuthUser) {
    return this.mine.profile(user);
  }

  @Patch('profile')
  @ResponseMessage('Profile saved')
  @ApiOperation({
    summary: 'Change my photo, email, language, address and emergency contact',
    description:
      'Upload the photo first with POST /files (purpose profile_photo). Name, mobile, designation and the rest are changed by the office.',
  })
  @ApiEnvelope(MyStaffProfileDto, { message: 'Profile saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateMyStaffProfileDto) {
    return this.mine.updateProfile(user, dto);
  }

  @Get('qualifications')
  @ApiOperation({ summary: 'My education qualifications, latest first' })
  @ApiEnvelope(QualificationDto, { isArray: true })
  qualifications(@CurrentUser() user: AuthUser) {
    return this.mine.listQualifications(user);
  }

  @Post('qualifications')
  @ResponseMessage('Qualification added')
  @ApiOperation({ summary: 'Add a qualification (degree, specialization, institution, year); returns the full list' })
  @ApiEnvelope(QualificationDto, { isArray: true, status: HttpStatus.CREATED, message: 'Qualification added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addQualification(@CurrentUser() user: AuthUser, @Body() dto: QualificationInputDto) {
    return this.mine.addQualification(user, dto);
  }

  @Patch('qualifications/:id')
  @ResponseMessage('Qualification saved')
  @ApiOperation({ summary: 'Change one of my qualifications (404 QUALIFICATION_NOT_FOUND)' })
  @ApiEnvelope(QualificationDto, { isArray: true, message: 'Qualification saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateQualification(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QualificationInputDto,
  ) {
    return this.mine.updateQualification(user, id, dto);
  }

  @Delete('qualifications/:id')
  @ResponseMessage('Qualification removed')
  @ApiOperation({ summary: 'Remove one of my qualifications' })
  @ApiEnvelope(QualificationDto, { isArray: true, message: 'Qualification removed' })
  removeQualification(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.mine.removeQualification(user, id);
  }

  @Get('documents')
  @ApiOperation({ summary: 'My staff documents with status (pending, verified, rejected) and file link' })
  @ApiEnvelope(StaffDocumentDto, { isArray: true })
  documents(@CurrentUser() user: AuthUser) {
    return this.mine.listDocuments(user);
  }

  @Post('documents')
  @ResponseMessage('Document uploaded')
  @ApiOperation({
    summary: 'Upload one of my documents; it waits for the office to check it',
    description: 'Upload the file first with POST /files, then send { type, title?, file_id }.',
  })
  @ApiEnvelope(StaffDocumentDto, { status: HttpStatus.CREATED, message: 'Document uploaded' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addDocument(@CurrentUser() user: AuthUser, @Body() dto: StaffDocumentInputDto) {
    return this.mine.addDocument(user, dto);
  }

  @Delete('documents/:id')
  @ResponseMessage('Document removed')
  @ApiOperation({ summary: 'Remove my document while it is still waiting (409 DOCUMENT_ALREADY_CHECKED)' })
  @ApiErrors(HttpStatus.CONFLICT)
  removeDocument(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.mine.removeDocument(user, id);
  }

  @Get('bank')
  @ApiOperation({ summary: 'My bank accounts and PAN, masked (last 4 digits only)' })
  @ApiEnvelope(MyBankListDto)
  bank(@CurrentUser() user: AuthUser) {
    return this.mine.bank(user);
  }

  @Post('bank/reveal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Show my full account number and PAN (when I tap View); every reveal is logged',
    description: 'Bank details are changed only by the office.',
  })
  @ApiEnvelope(MyBankListDto)
  revealBank(@CurrentUser() user: AuthUser) {
    return this.mine.revealBank(user);
  }

  @Get('check-in')
  @ApiOperation({ summary: 'My check-in today: time in, time out, late or not' })
  @ApiEnvelope(CheckInStatusDto)
  checkInStatus(@CurrentUser() user: AuthUser) {
    return this.staffAttendance.status(user);
  }

  @Post('check-in')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Checked in')
  @ApiOperation({ summary: 'Check in with the phone location (400 OUTSIDE_SCHOOL, 409 ALREADY_CHECKED_IN)' })
  @ApiEnvelope(CheckInStatusDto, { message: 'Checked in' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
    return this.staffAttendance.checkIn(user, dto);
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Check out with the phone location' })
  @ApiEnvelope(CheckInStatusDto, { message: 'Checked out' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
    return this.staffAttendance.checkOut(user, dto);
  }

  @Get('attendance')
  @ApiOperation({ summary: 'My attendance for a month' })
  @ApiEnvelope(StaffMonthDto)
  attendance(@CurrentUser() user: AuthUser, @Query() query: MonthQueryDto) {
    return this.staffAttendance.month(this.access.teacherSchool(user), user.id, query.month);
  }

  @Get('leave-balances')
  @ApiOperation({ summary: 'My leave balance per leave type this year' })
  @ApiEnvelope(LeaveBalanceDto, { isArray: true })
  balances(@CurrentUser() user: AuthUser) {
    return this.staffLeaves.balances(this.access.teacherSchool(user), user.id);
  }

  @Get('leaves')
  @ApiOperation({ summary: 'My leave requests, newest first' })
  @ApiEnvelope(StaffLeaveDto, { isArray: true })
  leaves(@CurrentUser() user: AuthUser) {
    return this.staffLeaves.mine(user);
  }

  @Post('leaves')
  @ResponseMessage('Leave request sent')
  @ApiOperation({ summary: 'Apply for leave (400 LEAVE_BALANCE_LOW or NO_WORKING_DAYS, 409 LEAVE_OVERLAP)' })
  @ApiEnvelope(StaffLeaveDto, { status: HttpStatus.CREATED, message: 'Leave request sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  apply(@CurrentUser() user: AuthUser, @Body() dto: StaffLeaveInputDto) {
    return this.staffLeaves.apply(user, dto);
  }

  @Post('leaves/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Leave request cancelled')
  @ApiOperation({ summary: 'Cancel my leave request while it is still waiting' })
  @ApiEnvelope(StaffLeaveDto, { message: 'Leave request cancelled' })
  @ApiErrors(HttpStatus.CONFLICT)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.staffLeaves.cancel(user, id);
  }
}
