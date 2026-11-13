import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  DigitalIdDto,
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
import { StudentLifecycleService } from './student-lifecycle.service';

@ApiTags('Admin · ID cards, TC and promotion')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin')
export class StudentLifecycleController {
  constructor(private readonly lifecycle: StudentLifecycleService) {}

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

  @Post('students/:id/exit')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Student marked as left and TC issued')
  @ApiOperation({
    summary: 'Transfer or withdraw a student and issue a transfer certificate',
    description: 'Sets the student status, frees the roll number and generates the TC number.',
  })
  @ApiEnvelope(TransferCertificateDto, { status: HttpStatus.CREATED, message: 'Student marked as left and TC issued' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  exit(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: StudentExitDto) {
    return this.lifecycle.exit(schoolId, id, dto);
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
