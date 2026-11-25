import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  CancelNocDto,
  ClearNocItemDto,
  DigitalIdDto,
  NocDto,
  StartNocDto,
  IdCardQueryDto,
  SingleIdCardQueryDto,
  PromotionDto,
  PromotionPreviewDto,
  PromotionPreviewQueryDto,
  PromotionResultDto,
  QrStudentDto,
  QrVerifyDto,
  StudentExitDto,
  TransferCertificateDto,
} from './dto/lifecycle.dto';
import { NOC_DEPARTMENTS, NocDepartment } from './entities/student-noc.entity';
import { NocService } from './noc.service';
import { StudentLifecycleService } from './student-lifecycle.service';

@ApiTags('Admin · ID cards, TC and promotion')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin')
export class StudentLifecycleController {
  constructor(
    private readonly lifecycle: StudentLifecycleService,
    private readonly noc: NocService,
  ) {}

  @Get('students/:id/id-card')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'ID card PDF (credit-card size) with the signed QR used for bus boarding' })
  @ApiPdf('ID card PDF')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async idCard(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SingleIdCardQueryDto,
  ) {
    return pdfFile(await this.lifecycle.idCard(schoolId, id, query.design));
  }

  @Get('id-cards')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Printable A4 sheet, 10 cards per page, for a class or a section' })
  @ApiPdf('A4 sheet of ID cards')
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async idCards(@SchoolId() schoolId: number, @Query() query: IdCardQueryDto) {
    return pdfFile(await this.lifecycle.idCardSheet(schoolId, query));
  }

  @Get('students/:id/digital-id')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'ID card data with the QR text, as the Parent app shows it' })
  @ApiEnvelope(DigitalIdDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  digitalId(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.lifecycle.digitalId(schoolId, id);
  }

  @Post('students/:id/id-card/reissue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('New ID card issued. The old QR no longer works.')
  @ApiOperation({ summary: 'Issue a replacement card for a lost one. The old QR stops working.' })
  @ApiEnvelope(DigitalIdDto, { message: 'New ID card issued. The old QR no longer works.' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  reissue(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.lifecycle.reissueCard(schoolId, id);
  }

  @Post('id-cards/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Check a scanned ID card QR and return the student' })
  @ApiEnvelope(QrStudentDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  verify(@SchoolId() schoolId: number, @Body() dto: QrVerifyDto) {
    return this.lifecycle.verifyQr(schoolId, dto.token);
  }

  @Post('students/:id/noc')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Leaving request started')
  @ApiOperation({
    summary: 'Start a leaving request (NOC) for a student',
    description:
      'Creates a no-objection checklist with one line per department: fees, library, transport, inventory and class teacher. The TC can be issued only after every line is cleared.',
  })
  @ApiEnvelope(NocDto, { status: HttpStatus.CREATED, message: 'Leaving request started' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  startNoc(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartNocDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.noc.start(schoolId, id, dto, user);
  }

  @Get('students/:id/noc')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'The open leaving request with each department line and what is still outstanding' })
  @ApiEnvelope(NocDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  currentNoc(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.noc.current(schoolId, id, user);
  }

  @Get('students/:id/noc/pdf')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'No objection certificate PDF (A4) with every department line' })
  @ApiPdf('No objection certificate PDF')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async nocPdf(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return pdfFile(await this.noc.pdf(schoolId, id));
  }

  @Post('students/:id/noc/items/:department/clear')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ResponseMessage('Department cleared')
  @ApiOperation({
    summary: 'Clear one department line of the NOC',
    description:
      'Fees needs acknowledge_dues while fees are unpaid. Library is refused while books are out or fines are unpaid. Clearing transport takes the student off their bus. students.manage can clear any line; otherwise fees.manage or fees.approve, library.manage, fleet.manage or inventory.manage clear their own line.',
  })
  @ApiEnvelope(NocDto, { message: 'Department cleared' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  clearNocItem(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('department', new ParseEnumPipe(NOC_DEPARTMENTS)) department: NocDepartment,
    @Body() dto: ClearNocItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.noc.clear(schoolId, id, department, dto, user);
  }

  @Post('students/:id/noc/items/:department/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ResponseMessage('Department line reopened')
  @ApiOperation({ summary: 'Undo a department clearance while the TC is not issued' })
  @ApiEnvelope(NocDto, { message: 'Department line reopened' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reopenNocItem(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('department', new ParseEnumPipe(NOC_DEPARTMENTS)) department: NocDepartment,
    @CurrentUser() user: AuthUser,
  ) {
    return this.noc.reopen(schoolId, id, department, user);
  }

  @Post('students/:id/noc/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Leaving request cancelled')
  @ApiOperation({ summary: 'Cancel the leaving request; the student stays' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async cancelNoc(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CancelNocDto) {
    await this.noc.cancel(schoolId, id, dto);
    return null;
  }

  @Post('students/:id/exit')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Student marked as left and TC issued')
  @ApiOperation({
    summary: 'Issue the transfer certificate once the NOC is cleared',
    description:
      'Needs a cleared NOC (409 NOC_NOT_CLEARED otherwise); exit type, leaving date and reason default to the NOC. Sets the student status, frees the roll number, generates the TC number and adds the student to alumni with their class history.',
  })
  @ApiEnvelope(TransferCertificateDto, { status: HttpStatus.CREATED, message: 'Student marked as left and TC issued' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  exit(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StudentExitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lifecycle.exit(schoolId, id, dto, { id: user.id, name: user.name });
  }

  @Get('students/:id/tc')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'The latest transfer certificate of a student' })
  @ApiEnvelope(TransferCertificateDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  certificate(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.lifecycle.certificate(schoolId, id);
  }

  @Get('students/:id/tc/pdf')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Transfer certificate PDF (A4)' })
  @ApiPdf('Transfer certificate PDF')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async certificatePdf(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return pdfFile(await this.lifecycle.certificatePdf(schoolId, id));
  }

  @Get('promotions/preview')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Students of a class this year, the next year and the suggested next class' })
  @ApiEnvelope(PromotionPreviewDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  preview(@SchoolId() schoolId: number, @Query() query: PromotionPreviewQueryDto) {
    return this.lifecycle.promotionPreview(schoolId, query.class_id, query.section_id);
  }

  @Post('promotions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Promotion done')
  @ApiOperation({
    summary: 'Move a class to the next academic year',
    description: 'Detained students repeat the class. Students who already have a class next year are skipped.',
  })
  @ApiEnvelope(PromotionResultDto, { message: 'Promotion done' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  promote(@SchoolId() schoolId: number, @Body() dto: PromotionDto) {
    return this.lifecycle.promote(schoolId, dto);
  }
}
