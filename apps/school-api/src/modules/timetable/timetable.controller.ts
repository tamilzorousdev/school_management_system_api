import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  BellPeriodDto,
  BellScheduleDto,
  BellScheduleQueryDto,
  SectionTimetableDto,
  SlotInputDto,
  SlotQueryDto,
  TeacherTimetableDto,
  WorkloadDto,
} from './dto/timetable.dto';
import { TimetableService } from './timetable.service';

@ApiTags('Admin · Timetable')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get('periods')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Bell schedule. 8 periods with a break and lunch are created the first time.' })
  @ApiEnvelope(BellPeriodDto, { isArray: true })
  periods(@SchoolId() schoolId: number, @Query() query: BellScheduleQueryDto) {
    return this.timetable.periods(schoolId, query.class_id);
  }

  @Put('periods')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Bell schedule saved')
  @ApiOperation({
    summary: 'Replace the bell schedule. Teaching periods are numbered in order; breaks have no number.',
  })
  @ApiEnvelope(BellPeriodDto, { isArray: true, message: 'Bell schedule saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  setPeriods(@SchoolId() schoolId: number, @Body() dto: BellScheduleDto) {
    return this.timetable.setPeriods(schoolId, dto);
  }

  @Delete('classes/:classId/periods')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Class bell schedule reset to default')
  @ApiOperation({ summary: 'Reset a class bell schedule to default' })
  @ApiEnvelope(BellPeriodDto, { isArray: true })
  resetClassPeriods(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
  ) {
    return this.timetable.resetClassPeriods(schoolId, classId);
  }

  @Get('sections/:id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Weekly grid of a section, with how many periods each subject still needs' })
  @ApiEnvelope(SectionTimetableDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  section(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.timetable.sectionGrid(schoolId, id);
  }

  @Put('sections/:id/slots')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Period saved')
  @ApiOperation({
    summary: 'Put a subject in one period',
    description:
      'Blocked with 409 TEACHER_CLASH or ROOM_CLASH when the teacher or room is already busy in that period.',
  })
  @ApiEnvelope(SectionTimetableDto, { message: 'Period saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  setSlot(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: SlotInputDto) {
    return this.timetable.setSlot(schoolId, id, dto);
  }

  @Delete('sections/:id/slots')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Period cleared')
  @ApiOperation({ summary: 'Empty one period' })
  @ApiEnvelope(SectionTimetableDto, { message: 'Period cleared' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  clearSlot(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: SlotQueryDto) {
    return this.timetable.clearSlot(schoolId, id, query.day_of_week, query.period_no);
  }

  @Get('teachers/:userId')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'One teacher’s week across all sections' })
  @ApiEnvelope(TeacherTimetableDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  teacher(@SchoolId() schoolId: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.timetable.teacherGrid(schoolId, userId);
  }

  @Get('workload')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Workload report: periods a week per teacher, by day, against their limit' })
  @ApiEnvelope(WorkloadDto)
  workload(@SchoolId() schoolId: number) {
    return this.timetable.workload(schoolId);
  }
}
