import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ROLES } from '../access/access.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import { CreateQuizDto, QuizQueryDto, UpdateQuizDto } from './dto/quiz.dto';
import { QuizzesService } from './quizzes.service';

const teacherSchool = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(TEACHER_MODULE_TAGS.MODULE_5)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher/quizzes')
export class TeacherQuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  @ApiOperation({ summary: 'List quizzes created by this teacher' })
  @ApiEnvelope(Object, { paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() query: QuizQueryDto) {
    return this.quizzes.listTeacherQuizzes(teacherSchool(user), user.id, query);
  }

  @Post()
  @ResponseMessage('Quiz draft created')
  @ApiOperation({ summary: 'Create a new quiz draft with question bank' })
  @ApiEnvelope(Object, { status: HttpStatus.CREATED, message: 'Quiz draft created' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuizDto) {
    return this.quizzes.create(teacherSchool(user), user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a quiz with question bank and answers' })
  @ApiEnvelope(Object)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.quizzes.getTeacherQuiz(teacherSchool(user), user.id, id);
  }

  @Put(':id')
  @ResponseMessage('Quiz updated')
  @ApiOperation({ summary: 'Update a draft or rejected quiz' })
  @ApiEnvelope(Object, { message: 'Quiz updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuizDto) {
    return this.quizzes.update(teacherSchool(user), user.id, id, dto);
  }

  @Post(':id/submit-approval')
  @ResponseMessage('Quiz submitted for approval')
  @ApiOperation({ summary: 'Submit quiz draft to Principal / Admin for approval' })
  @ApiEnvelope(Object, { message: 'Quiz submitted for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  submitApproval(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.quizzes.submitForApproval(teacherSchool(user), user.id, id);
  }

  @Delete(':id')
  @ResponseMessage('Quiz deleted')
  @ApiOperation({ summary: 'Delete a draft or rejected quiz' })
  @ApiEnvelope(undefined, { message: 'Quiz deleted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async delete(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.quizzes.delete(teacherSchool(user), user.id, id);
    return null;
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Analytics for this quiz: completion rate, average score, question accuracy' })
  @ApiEnvelope(Object)
  @ApiErrors(HttpStatus.NOT_FOUND)
  analytics(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.quizzes.getQuizAnalytics(teacherSchool(user), id);
  }
}
