import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { DashboardService } from './dashboard.service';
import { DashboardDto } from './dto/dashboard.dto';
import { YearPerformanceListDto } from './dto/year-performance.dto';
import { YearPerformanceService } from './year-performance.service';

@ApiTags('Admin · Dashboard')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.BAD_REQUEST)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly performance: YearPerformanceService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Home screen in one call: students, staff, attendance today, buses, alerts, fees and exams',
    description:
      'Every admin-web role can call it. Each section is returned only when the caller has its permission and is null otherwise: students (students.view), staff (staff.view), attendance (attendance.view), buses and alerts (fleet.view), fees (fees.view), exams (exams.view). buses.telematics_available is false when bus tracking cannot be reached; the call still succeeds.',
  })
  @ApiEnvelope(DashboardDto)
  overview(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser) {
    return this.dashboard.overview(schoolId, user);
  }

  @Get('year-performance')
  @ApiOperation({
    summary: 'Year by year performance: students, attendance, exam results, sports and activities, fees',
    description:
      'One row per academic year, newest first, up to the current year, so the office can compare years. Each section follows the same permissions as the dashboard and is null without them: students and activities (students.view), attendance (attendance.view), studies (exams.view), fees (fees.view).',
  })
  @ApiEnvelope(YearPerformanceListDto)
  yearPerformance(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser) {
    return this.performance.list(schoolId, user);
  }
}
