import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { VerifyDocumentDto } from '../../shared/verification';
import { PERMISSIONS } from '../access/access.catalog';
import {
  BehaviourInputDto,
  BehaviourNoteDto,
  HealthDto,
  HealthInputDto,
  RecordCountsDto,
  StudentDocumentDto,
  StudentDocumentInputDto,
  UpdateBehaviourDto,
  UpdateStudentDocumentDto,
  UpdateVaccinationDto,
  VaccinationInputDto,
} from './dto/records.dto';
import { StudentRecordsService } from './student-records.service';

@ApiTags('Admin · Student records')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@Controller('admin/students/:studentId')
export class StudentRecordsController {
  constructor(private readonly records: StudentRecordsService) {}

  @Get('record-counts')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Counts for the student page tabs: documents, pending checks, notes, overdue vaccines' })
  @ApiEnvelope(RecordCountsDto)
  counts(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.records.counts(schoolId, studentId);
  }

  @Get('documents')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Documents with their verification status, newest first' })
  @ApiEnvelope(StudentDocumentDto, { isArray: true })
  documents(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.records.listDocuments(schoolId, studentId);
  }

  @Post('documents')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Document added')
  @ApiOperation({ summary: 'Attach an uploaded file (POST /files) as a document. It starts as pending.' })
  @ApiEnvelope(StudentDocumentDto, { status: HttpStatus.CREATED, message: 'Document added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addDocument(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: StudentDocumentInputDto,
  ) {
    return this.records.addDocument(schoolId, studentId, dto);
  }

  @Patch('documents/:id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Document updated')
  @ApiOperation({ summary: 'Rename, replace the file or change parent visibility. A new file goes back to pending.' })
  @ApiEnvelope(StudentDocumentDto, { message: 'Document updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateDocument(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDocumentDto,
  ) {
    return this.records.updateDocument(schoolId, studentId, id, dto);
  }

  @Post('documents/:id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Verification saved')
  @ApiOperation({ summary: 'Mark a document verified, or rejected with a reason' })
  @ApiEnvelope(StudentDocumentDto, { message: 'Verification saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  verifyDocument(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.records.verifyDocument(schoolId, studentId, id, dto, actor);
  }

  @Delete('documents/:id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Document deleted')
  @ApiOperation({ summary: 'Delete a document' })
  removeDocument(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.records.removeDocument(schoolId, studentId, id);
  }

  @Get('health')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Health record with BMI and the vaccination log' })
  @ApiEnvelope(HealthDto)
  health(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.records.getHealth(schoolId, studentId);
  }

  @Put('health')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Health record saved')
  @ApiOperation({ summary: 'Save the health record. Send only the fields that change; null clears a field.' })
  @ApiEnvelope(HealthDto, { message: 'Health record saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  saveHealth(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: HealthInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.records.saveHealth(schoolId, studentId, dto, actor);
  }

  @Post('vaccinations')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Vaccination added')
  @ApiOperation({ summary: 'Add a vaccination. Returns the full health record.' })
  @ApiEnvelope(HealthDto, { status: HttpStatus.CREATED, message: 'Vaccination added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addVaccination(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: VaccinationInputDto,
  ) {
    return this.records.addVaccination(schoolId, studentId, dto);
  }

  @Patch('vaccinations/:id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Vaccination updated')
  @ApiOperation({ summary: 'Update a vaccination entry, for example the date it was given' })
  @ApiEnvelope(HealthDto, { message: 'Vaccination updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateVaccination(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVaccinationDto,
  ) {
    return this.records.updateVaccination(schoolId, studentId, id, dto);
  }

  @Delete('vaccinations/:id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Vaccination deleted')
  @ApiOperation({ summary: 'Delete a vaccination entry' })
  @ApiEnvelope(HealthDto, { message: 'Vaccination deleted' })
  removeVaccination(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.records.removeVaccination(schoolId, studentId, id);
  }

  @Get('behaviour')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Behaviour and discipline notes, newest first' })
  @ApiEnvelope(BehaviourNoteDto, { isArray: true })
  behaviour(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.records.listBehaviour(schoolId, studentId);
  }

  @Post('behaviour')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Note added')
  @ApiOperation({
    summary:
      'Add an appreciation, concern, incident or disciplinary note. Parents see it unless visible_to_parent is false.',
  })
  @ApiEnvelope(BehaviourNoteDto, { status: HttpStatus.CREATED, message: 'Note added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addBehaviour(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: BehaviourInputDto,
  ) {
    return this.records.addBehaviour(schoolId, studentId, dto);
  }

  @Patch('behaviour/:id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Note updated')
  @ApiOperation({ summary: 'Edit a behaviour note' })
  @ApiEnvelope(BehaviourNoteDto, { message: 'Note updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateBehaviour(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBehaviourDto,
  ) {
    return this.records.updateBehaviour(schoolId, studentId, id, dto);
  }

  @Delete('behaviour/:id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Note deleted')
  @ApiOperation({ summary: 'Delete a behaviour note' })
  removeBehaviour(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.records.removeBehaviour(schoolId, studentId, id);
  }
}
