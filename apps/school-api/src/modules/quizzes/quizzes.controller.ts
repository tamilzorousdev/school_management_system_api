import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CreateQuizDto, QuizQueryDto, RejectQuizDto, UpdateQuizDto, UpdateQuizPermissionsDto } from './dto/quiz.dto';
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

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Get quiz creation permission configuration and staff permission list' })
  @ApiEnvelope(Object)
  getPermissions(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser) {
    return this.quizzes.getQuizPermissions(schoolId, user);
  }

  @Post('permissions')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Quiz permissions updated')
  @ApiOperation({ summary: 'Configure online test creation permissions for staff members' })
  @ApiEnvelope(Object, { message: 'Quiz permissions updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN)
  updatePermissions(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateQuizPermissionsDto,
  ) {
    return this.quizzes.updateQuizPermissions(schoolId, user, dto);
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

  @Post()
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Online test / quiz created')
  @ApiOperation({ summary: 'Admin or Principal create a new online test / quiz' })
  @ApiEnvelope(Object, { status: HttpStatus.CREATED, message: 'Online test / quiz created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN)
  create(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateQuizDto,
  ) {
    return this.quizzes.adminCreate(schoolId, user, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Quiz deleted')
  @ApiOperation({ summary: 'Delete an online quiz' })
  @ApiEnvelope(undefined, { message: 'Quiz deleted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async delete(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.quizzes.adminDelete(schoolId, id);
    return null;
  }
}
