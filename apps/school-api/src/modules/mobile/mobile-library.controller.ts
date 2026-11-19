import { Controller, Get, HttpStatus, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { CatalogueService } from '../library/catalogue.service';
import {
  CatalogueBookDto,
  CatalogueQueryDto,
  ClassOverdueDto,
  PersonLibraryDto,
  SectionLibraryDto,
} from '../library/dto/desk.dto';
import { MembersService } from '../library/members.service';
import { MobileAccessService } from './mobile-access.service';
import { PARENT_MODULE_TAGS } from './parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';

@ApiTags(PARENT_MODULE_TAGS.MODULE_9)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent')
export class MobileParentLibraryController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly members: MembersService,
    private readonly catalogue: CatalogueService,
  ) {}

  @Get('children/:id/library')
  @ApiOperation({
    summary: 'The child’s library: books held with due dates, late fine so far, unpaid fines, history and visits',
    description:
      'loans[].state: on_loan, due_soon, due_today or overdue; running_fine is the fine if returned today. member is null when the child is not a library member yet.',
  })
  @ApiEnvelope(PersonLibraryDto)
  async child(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.members.personLibrary(await this.access.childSchool(user.id, id), { student_id: id });
  }

  @Get('children/:id/library/books')
  @ApiOperation({ summary: 'Search the school library catalogue and see how many copies are on the shelf' })
  @ApiEnvelope(CatalogueBookDto, { paginated: true })
  async books(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: CatalogueQueryDto) {
    return this.catalogue.browse(await this.access.childSchool(user.id, id), query);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_11)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL, ROLES.LIBRARIAN)
@Controller('mobile/teacher')
export class MobileTeacherLibraryController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly members: MembersService,
    private readonly catalogue: CatalogueService,
  ) {}

  @Get('library')
  @ApiOperation({ summary: 'My library: books I hold with due dates, my fines and history' })
  @ApiEnvelope(PersonLibraryDto)
  mine(@CurrentUser() user: AuthUser) {
    return this.members.personLibraryForUser(this.access.teacherSchool(user), user.id);
  }

  @Get('library/class-overdue')
  @ApiOperation({ summary: 'Class teacher: overdue library books of the students in my sections' })
  @ApiEnvelope(ClassOverdueDto, { isArray: true })
  async classOverdue(@CurrentUser() user: AuthUser) {
    const schoolId = this.access.teacherSchool(user);
    return this.members.classOverdue(schoolId, await this.access.classTeacherSections(schoolId, user.id));
  }

  @Get('library/books')
  @ApiOperation({ summary: 'Search the school library catalogue' })
  @ApiEnvelope(CatalogueBookDto, { paginated: true })
  books(@CurrentUser() user: AuthUser, @Query() query: CatalogueQueryDto) {
    return this.catalogue.browse(this.access.teacherSchool(user), query);
  }

  @Get('sections/:id/library')
  @ApiOperation({
    summary: 'Class teacher: who in my section holds library books, who is overdue and who has library dues',
    description:
      'One row per student with books held (and the loans), overdue books, days late, the late fine building up, unpaid fines and the first parent mobile. Rows come overdue first, then dues, then holding. Another teacher’s section returns 403 NOT_CLASS_TEACHER.',
  })
  @ApiEnvelope(SectionLibraryDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  section(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.members.sectionLibrary(this.access.teacherSchool(user), id, user.id);
  }

  @Get('students/:id/library')
  @ApiOperation({
    summary: 'Class teacher: one student’s library (books held, dues, history, visits)',
    description: 'Only for a student in a section I am class teacher of; otherwise 403 NOT_CLASS_TEACHER.',
  })
  @ApiEnvelope(PersonLibraryDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  student(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.members.teacherStudentLibrary(this.access.teacherSchool(user), id, user.id);
  }
}
