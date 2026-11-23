import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { PERMISSIONS } from '../access/access.catalog';
import { AssignInvigilatorDto, AutoAllocateHallsDto } from './dto/halls.dto';
import { ExamHallsService } from './exam-halls.service';

@ApiTags('Admin · Exam Seating & Invigilation')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/exams/:id')
export class ExamSeatingController {
  constructor(private readonly halls: ExamHallsService) {}

  @Get('seating')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Get exam hall seating allocation list' })
  getSeating(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) examId: number,
    @Query('hall_id') hallId?: string,
  ) {
    return this.halls.getExamSeating(schoolId, examId, hallId ? Number(hallId) : undefined);
  }

  @Post('seating/auto-allocate')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Seats allocated successfully')
  @ApiOperation({ summary: 'Auto-allocate student desks across exam halls (sequential or alternate sections)' })
  autoAllocate(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) examId: number,
    @Body() dto: AutoAllocateHallsDto,
  ) {
    return this.halls.autoAllocate(schoolId, examId, dto);
  }

  @Delete('seating')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ApiOperation({ summary: 'Clear seating allocations for this exam' })
  clearSeating(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) examId: number) {
    return this.halls.clearExamSeating(schoolId, examId);
  }

  @Get('invigilators')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'List invigilator duties assigned for this exam' })
  listInvigilators(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) examId: number) {
    return this.halls.listInvigilators(schoolId, examId);
  }

  @Post('invigilators')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Invigilator assigned')
  @ApiOperation({ summary: 'Assign a teacher as invigilator to a hall on an exam date' })
  assignInvigilator(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) examId: number,
    @Body() dto: AssignInvigilatorDto,
  ) {
    return this.halls.assignInvigilator(schoolId, examId, dto);
  }

  @Delete('invigilators/:invigilatorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ApiOperation({ summary: 'Remove an invigilator assignment' })
  deleteInvigilator(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) _examId: number,
    @Param('invigilatorId', ParseIntPipe) invigilatorId: number,
  ) {
    return this.halls.deleteInvigilator(schoolId, invigilatorId);
  }

  @Get('halls/:hallId/door-chart')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiPdf('Printable Exam Hall Door Chart / Seating Plan PDF')
  @ApiOperation({ summary: 'Download or print door chart / seating plan for an exam hall' })
  async doorChart(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) examId: number,
    @Param('hallId', ParseIntPipe) hallId: number,
    @Query('download') download?: string,
  ) {
    const pdf = await this.halls.generateDoorChartPdf(schoolId, examId, hallId);
    return pdfFile({ name: `exam-${examId}-hall-${hallId}-door-chart`, pdf }, download === 'true');
  }

  @Get('hall-tickets')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiPdf('Printable Student Hall Tickets / Admit Cards PDF')
  @ApiOperation({ summary: 'Download or print Hall Tickets / Admit Cards for all students or a class' })
  async hallTickets(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) examId: number,
    @Query('class_id') classId?: string,
    @Query('download') download?: string,
  ) {
    const pdf = await this.halls.generateHallTicketsPdf(schoolId, examId, classId ? Number(classId) : undefined);
    return pdfFile({ name: `exam-${examId}-admit-cards`, pdf }, download === 'true');
  }
}
