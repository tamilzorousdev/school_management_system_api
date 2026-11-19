import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
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
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { SubmitQuizDto } from './dto/quiz.dto';
import { QuizzesService } from './quizzes.service';

const parentSchool = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(PARENT_MODULE_TAGS.MODULE_3)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/quizzes')
export class ParentQuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  @ApiOperation({ summary: "List child's online quizzes: active, upcoming, completed and expired" })
  @ApiEnvelope(Object, { isArray: true })
  list(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) childId: number) {
    return this.quizzes.listStudentQuizzes(parentSchool(user), childId);
  }

  @Post(':quizId/start')
  @ResponseMessage('Quiz started')
  @ApiOperation({ summary: 'Start a quiz: begins timer and returns questions without answers' })
  @ApiEnvelope(Object, { message: 'Quiz started' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) childId: number,
    @Param('quizId', ParseIntPipe) quizId: number,
  ) {
    return this.quizzes.startQuiz(parentSchool(user), childId, quizId);
  }

  @Post(':quizId/submit')
  @ResponseMessage('Quiz submitted')
  @ApiOperation({ summary: 'Submit quiz answers: auto-scored with pass/fail and marks' })
  @ApiEnvelope(Object, { message: 'Quiz submitted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) childId: number,
    @Param('quizId', ParseIntPipe) quizId: number,
    @Body() dto: SubmitQuizDto,
  ) {
    return this.quizzes.submitQuiz(parentSchool(user), childId, quizId, dto);
  }

  @Get(':quizId/result')
  @ApiOperation({ summary: 'Get full quiz result breakdown with correct options and explanations' })
  @ApiEnvelope(Object)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  result(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) childId: number,
    @Param('quizId', ParseIntPipe) quizId: number,
  ) {
    return this.quizzes.getQuizResult(parentSchool(user), childId, quizId);
  }
}
