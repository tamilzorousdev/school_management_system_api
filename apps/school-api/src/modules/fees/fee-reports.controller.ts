import { Controller, Get, HttpStatus, Param, ParseEnumPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ApiEnvelope, ApiErrors, RequirePermissions } from '@app/common';
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { XLSX } from '../attendance/attendance-export';
import { FeeReportDto, FeeReportQueryDto } from './dto/fees.dto';
import { feeReportFile } from './fee-reports.export';
import { FEE_REPORT_TYPES, FeeReportsService, FeeReportType } from './fee-reports.service';

const TYPES = Object.fromEntries(FEE_REPORT_TYPES.map((type) => [type, type])) as Record<FeeReportType, FeeReportType>;

const DESCRIPTION = [
  'classes: billed, concessions and scholarships, discounts, net, collected, outstanding and overdue per class.',
  'heads: the same per fee head (discounts and payments shared across an invoice’s heads by amount); fee_head_id filters.',
  'installments: the same per installment, with invoices fully paid.',
  'benefits: each concession and scholarship with students and the amount taken off; kind filters.',
  'defaulters: students with a balance, most overdue first; overdue_only=true keeps only overdue ones.',
  'collections: payments per day by mode between from and to (default: this month); reversed payments left out.',
  'Every report takes academic_year_id, class_id, section_id and installment. Cancelled invoices are left out.',
].join(' ');

@ApiTags('Admin · Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fees/reports')
export class FeeReportsController {
  constructor(
    private readonly reports: FeeReportsService,
    private readonly dataSource: DataSource,
  ) {}

  @Get(':type')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiParam({ name: 'type', enum: FEE_REPORT_TYPES })
  @ApiOperation({ summary: 'Fee report: columns, rows and a totals row', description: DESCRIPTION })
  @ApiEnvelope(FeeReportDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  report(
    @SchoolId() schoolId: number,
    @Param('type', new ParseEnumPipe(TYPES)) type: FeeReportType,
    @Query() query: FeeReportQueryDto,
  ) {
    return this.reports.report(schoolId, type, query);
  }

  @Get(':type/xlsx')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiParam({ name: 'type', enum: FEE_REPORT_TYPES })
  @ApiOperation({ summary: 'Download a fee report as Excel (same filters as the report)' })
  @ApiFile(XLSX, 'Fee report')
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async file(
    @SchoolId() schoolId: number,
    @Param('type', new ParseEnumPipe(TYPES)) type: FeeReportType,
    @Query() query: FeeReportQueryDto,
  ) {
    const report = await this.reports.report(schoolId, type, query);
    const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]);
    return feeReportFile(report, school?.name ?? 'School');
  }
}
