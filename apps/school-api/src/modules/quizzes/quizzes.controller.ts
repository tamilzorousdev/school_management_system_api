import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { QuizQueryDto, RejectQuizDto, UpdateQuizDto } from './dto/quiz.dto';
import { QuizzesService } from './quizzes.service';

@ApiTags('Admin · Quizzes')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/quizzes')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'List all online quizzes in the school' })
  @ApiEnvelope(Object, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: QuizQueryDto) {
    return this.quizzes.listAdminQuizzes(schoolId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Get full details of a quiz including question bank' })
  @ApiEnvelope(Object)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.quizzes.getAdminQuiz(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Quiz updated')
  @ApiOperation({ summary: 'Admin edit of quiz timing, pass marks, or questions' })
  @ApiEnvelope(Object, { message: 'Quiz updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuizDto) {
    return this.quizzes.adminUpdate(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Quiz deleted')
  @ApiOperation({
    summary: 'Delete a quiz in any state, including one that is live',
    description:
      'For a quiz created by mistake. The quiz disappears for teachers and parents at once and students can no longer open or submit it. The records are kept (soft delete). `attempts` says how many students had already started it.',
  })
  @ApiEnvelope(Object, { message: 'Quiz deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.quizzes.adminDelete(schoolId, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Quiz approved and scheduled')
  @ApiOperation({ summary: 'Approve quiz and send notification to parents' })
  @ApiEnvelope(Object, { message: 'Quiz approved and scheduled' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.quizzes.approve(schoolId, user.id, id);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Quiz rejected')
  @ApiOperation({ summary: 'Reject quiz with feedback to teacher' })
  @ApiEnvelope(Object, { message: 'Quiz rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  reject(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectQuizDto,
  ) {
    return this.quizzes.reject(schoolId, user.id, id, dto);
  }

  @Get(':id/analytics')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Quiz analytics: score distribution, completion rate, and question-level stats' })
  @ApiEnvelope(Object)
  @ApiErrors(HttpStatus.NOT_FOUND)
  analytics(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.quizzes.getQuizAnalytics(schoolId, id);
  }
}
