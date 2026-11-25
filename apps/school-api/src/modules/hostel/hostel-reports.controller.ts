import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions } from '@app/common';
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { XLSX } from '../attendance/attendance-export';
import {
  AttendanceReportDto,
  ComplaintsReportDto,
  DisciplineReportDto,
  FeesReportDto,
  HealthReportDto,
  HostelReportQueryDto,
  LeavesReportDto,
  MessReportDto,
  OccupancyReportDto,
  SummaryReportDto,
  VisitorsReportDto,
} from './dto/hostel-reports.dto';
import { HostelModuleGate, HostelModuleGuard } from './hostel-module.guard';
import {
  attendanceSheets,
  disciplineSheets,
  feesSheets,
  leavesSheets,
  occupancySheets,
  periodLabel,
  ReportSheet,
  reportWorkbook,
} from './hostel-reports.export';
import { HostelReportsService } from './hostel-reports.service';

const RANGE =
  'hostel_id limits it to one hostel. from and to (YYYY-MM-DD) default to the last 30 days and can cover at most 366 days.';

@ApiTags('Admin · Hostel reports')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
@UseGuards(HostelModuleGuard)
@RequirePermissions(PERMISSIONS.HOSTEL_REPORTS)
@Controller('admin/hostel/reports')
export class HostelReportsController {
  constructor(private readonly reports: HostelReportsService) {}

  private async file(
    schoolId: number,
    query: HostelReportQueryDto,
    title: string,
    period: string,
    sheets: ReportSheet[],
  ) {
    const scope = await this.reports.scope(schoolId, query);
    const [school, hostel] = await Promise.all([this.reports.schoolName(schoolId), this.reports.hostelName(scope)]);
    return reportWorkbook({ school, title, scope: hostel, period }, sheets);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Dashboard headline numbers for all hostel reports',
    description: `Occupancy, open leaves, open complaints and tickets, sick bay and visitors inside are right now; attendance %, late returns and discipline cases cover the period; outstanding fees are for the academic year being viewed. ${RANGE}`,
  })
  @ApiEnvelope(SummaryReportDto)
  summary(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.summary(schoolId, query);
  }

  @Get('occupancy')
  @ApiOperation({
    summary: 'Bed occupancy per hostel and block, and per room type',
    description: 'Current snapshot by bed status; from and to are ignored. hostel_id limits it to one hostel.',
  })
  @ApiEnvelope(OccupancyReportDto)
  occupancy(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.occupancy(schoolId, query);
  }

  @Get('occupancy/export')
  @ApiOperation({ summary: 'Download the occupancy report as Excel' })
  @ApiFile(XLSX, 'Hostel occupancy report')
  async occupancyFile(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    const report = await this.reports.occupancy(schoolId, query);
    return this.file(schoolId, query, 'Occupancy', `as of ${report.as_of}`, occupancySheets(report));
  }

  @Get('attendance')
  @ApiOperation({
    summary: 'Roll call: totals per slot, daily trend and top absentees',
    description: `Present % = (present + late) / (present + late + absent); residents on leave, on an outing or sick are left out. top sets the list size (default 10). ${RANGE}`,
  })
  @ApiEnvelope(AttendanceReportDto)
  attendance(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.attendance(schoolId, query);
  }

  @Get('attendance/export')
  @ApiOperation({ summary: 'Download the roll call report as Excel' })
  @ApiFile(XLSX, 'Hostel roll call report')
  async attendanceFile(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    const report = await this.reports.attendance(schoolId, query);
    return this.file(schoolId, query, 'Roll call', periodLabel(report.period), attendanceSheets(report));
  }

  @Get('leaves')
  @ApiOperation({
    summary: 'Leaves and outings by kind, status and who raised them; late returns',
    description: `Counts leaves starting in the period; late returns are returns in the period after the expected time. ${RANGE}`,
  })
  @ApiEnvelope(LeavesReportDto)
  leaves(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.leaves(schoolId, query);
  }

  @Get('leaves/export')
  @ApiOperation({ summary: 'Download the leaves report as Excel' })
  @ApiFile(XLSX, 'Hostel leaves report')
  async leavesFile(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    const report = await this.reports.leaves(schoolId, query);
    return this.file(schoolId, query, 'Leaves', periodLabel(report.period), leavesSheets(report));
  }

  @Get('visitors')
  @ApiOperation({
    summary: 'Visits per day, denied and unknown visitors, average visit length',
    description: `Visits logged in the period; unknown visitors are not on the approved list. ${RANGE}`,
  })
  @ApiEnvelope(VisitorsReportDto)
  visitors(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.visitors(schoolId, query);
  }

  @Get('fees')
  @ApiOperation({
    summary: 'Hostel rent billed, collected and outstanding per hostel; caution deposits; top dues',
    description:
      'For the academic year being viewed (X-Academic-Year-Id); from and to are ignored. Cancelled invoices are left out. hostel_id limits it to one hostel; top sets the list size.',
  })
  @ApiEnvelope(FeesReportDto)
  fees(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.fees(schoolId, query);
  }

  @Get('fees/export')
  @ApiOperation({ summary: 'Download the hostel fees report as Excel' })
  @ApiFile(XLSX, 'Hostel fees report')
  async feesFile(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    const report = await this.reports.fees(schoolId, query);
    return this.file(schoolId, query, 'Fees', report.academic_year ?? 'Current year', feesSheets(report));
  }

  @Get('discipline')
  @ApiOperation({
    summary: 'Discipline cases by category, severity, status and month; actions, fines and repeat residents',
    description: `Cases with the incident in the period. Withdrawn cases count only under by_status. Repeat residents have 3 or more cases. ${RANGE}`,
  })
  @ApiEnvelope(DisciplineReportDto)
  discipline(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.discipline(schoolId, query);
  }

  @Get('discipline/export')
  @ApiOperation({ summary: 'Download the discipline report as Excel' })
  @ApiFile(XLSX, 'Hostel discipline report')
  async disciplineFile(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    const report = await this.reports.discipline(schoolId, query);
    return this.file(schoolId, query, 'Discipline', periodLabel(report.period), disciplineSheets(report));
  }

  @Get('complaints')
  @ApiOperation({
    summary: 'Complaints and maintenance tickets: by category and status, resolution time, SLA, rating, cost',
    description: `Complaints and tickets raised in the period; rooms_blocked_now is right now. ${RANGE}`,
  })
  @ApiEnvelope(ComplaintsReportDto)
  complaints(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.complaints(schoolId, query);
  }

  @Get('mess')
  @HostelModuleGate('mess')
  @ApiOperation({
    summary: 'Mess: meals eaten and skipped, skip requests and feedback per meal',
    description: `Needs the mess module (403 HOSTEL_MODULE_DISABLED otherwise). ${RANGE}`,
  })
  @ApiEnvelope(MessReportDto)
  mess(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.mess(schoolId, query);
  }

  @Get('health')
  @HostelModuleGate('medical')
  @ApiOperation({
    summary: 'Health: logs by kind, hospital visits, sick bay stays and medication doses',
    description: `Needs the medical module (403 HOSTEL_MODULE_DISABLED otherwise). ${RANGE}`,
  })
  @ApiEnvelope(HealthReportDto)
  health(@SchoolId() schoolId: number, @Query() query: HostelReportQueryDto) {
    return this.reports.health(schoolId, query);
  }
}
