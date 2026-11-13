import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, RequireRoles } from '@app/common';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { ReportCardDto, ReportCardQueryDto, SectionReportCardQueryDto, SignReportCardDto } from './dto/report-card.dto';
import { ReportCardsService } from './report-cards.service';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';

const SCOPE_HELP =
  'No term_id or exam_id: the whole academic year, every term side by side. term_id: only that term. exam_id: only that exam. Only published exams are included.';

@ApiTags('Admin · Exams')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/students')
export class StudentReportCardController {
  constructor(private readonly cards: ReportCardsService) {}

  @Get(':id/report-card')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({
    summary: 'Report card of a student: marks of every exam by term, overall grade, ranks and attendance',
    description: SCOPE_HELP,
  })
  @ApiEnvelope(ReportCardDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  card(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: ReportCardQueryDto) {
    return this.cards.card(schoolId, id, query, `/api/v1/admin/students/${id}/report-card/pdf`);
  }

  @Get(':id/report-card/pdf')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({
    summary: 'Printable A4 report card (PDF)',
    description: `${SCOPE_HELP} 404 NO_PUBLISHED_RESULTS when there is nothing to print.`,
  })
  @ApiPdf('Report card PDF')
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async pdf(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: ReportCardQueryDto) {
    return pdfFile(await this.cards.pdf(schoolId, id, query));
  }
}

@ApiTags('Admin · Exams')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/report-cards')
export class SectionReportCardsController {
  constructor(private readonly cards: ReportCardsService) {}

  @Get('sections/:sectionId/pdf')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({
    summary: 'Report cards of a whole section in one PDF, one page per student, in roll-number order',
    description: `${SCOPE_HELP} Students without results in the chosen scope are skipped.`,
  })
  @ApiPdf('Report cards PDF')
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async section(
    @SchoolId() schoolId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query() query: SectionReportCardQueryDto,
  ) {
    return pdfFile(await this.cards.sectionPdf(schoolId, sectionId, query));
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_3)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id')
export class MobileParentReportCardController {
  constructor(private readonly cards: ReportCardsService) {}

  @Get('report-card')
  @ApiOperation({
    summary: "My child's report card: marks of every exam by term, overall grade, ranks and attendance",
    description: `${SCOPE_HELP} Use options to fill the year, term and exam pickers, and pdf_path to download.`,
  })
  @ApiEnvelope(ReportCardDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  card(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ReportCardQueryDto) {
    return this.cards.childCard(user.id, id, query, `/api/v1/mobile/parent/children/${id}/report-card/pdf`);
  }

  @Get('report-card/pdf')
  @ApiOperation({ summary: "My child's report card as a PDF to save or print", description: SCOPE_HELP })
  @ApiPdf('Report card PDF')
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async pdf(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ReportCardQueryDto) {
    return pdfFile(await this.cards.childPdf(user.id, id, query), true);
  }

  @Post('report-card/sign')
  @ApiOperation({ summary: "Sign my child's report card using my uploaded signature" })
  @ApiEnvelope(ReportCardDto)
  sign(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SignReportCardDto) {
    return this.cards.signChildCard(user.id, id, dto, `/api/v1/mobile/parent/children/${id}/report-card/pdf`);
  }
}
