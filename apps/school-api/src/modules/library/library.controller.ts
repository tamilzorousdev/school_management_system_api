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
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiFile, ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { UploadedFileInput } from '../files/files.service';
import { AuditsService } from './audits.service';
import { CatalogueService } from './catalogue.service';
import { CirculationService } from './circulation.service';
import {
  BOOK_IMPORT_UPLOAD_SCHEMA,
  BookCreateDto,
  BookDto,
  BookImportOptionsDto,
  BookImportReportDto,
  BookInsightsDto,
  BookQueryDto,
  BookUpdateDto,
  CategoryDto,
  CategoryInputDto,
  CategoryUpdateDto,
  CopyDto,
  CopyEventDto,
  CopyInputDto,
  CopyLookupQueryDto,
  CopyQueryDto,
  CopyUpdateDto,
  IsbnLookupDto,
  LabelsQueryDto,
  LibrarySettingsDto,
  LibrarySettingsInputDto,
} from './dto/catalogue.dto';
import {
  FollowUpDto,
  FollowUpInputDto,
  FollowUpQueryDto,
  IssueBooksDto,
  IssueInsightsDto,
  IssueQueryDto,
  LoanDetailDto,
  LoanDto,
  LostDto,
  MemberBulkDto,
  MemberBulkResultDto,
  MemberCreateDto,
  MemberDto,
  MemberInsightsDto,
  MemberLookupQueryDto,
  MemberQueryDto,
  MemberSummaryDto,
  MemberUpdateDto,
  PeopleQueryDto,
  PersonDto,
  RenewDto,
  ReturnBooksDto,
  ReturnedItemDto,
} from './dto/circulation.dto';
import {
  AuditCloseDto,
  AuditCreateDto,
  AuditDto,
  AuditItemDto,
  AuditItemsQueryDto,
  AuditScanDto,
  AuditScanResultDto,
  CategoryReportDto,
  ClassReportDto,
  DateQueryDto,
  FineDto,
  FineInsightsDto,
  FinePaymentDto,
  FinePaymentInputDto,
  FinePaymentQueryDto,
  FinePaymentResultDto,
  FineQueryDto,
  FineWaiveDto,
  LibraryDashboardDto,
  LibraryPeriodDto,
  MostBorrowedDto,
  PeriodAttendanceDto,
  PeriodRosterDto,
  PersonLibraryDto,
  ReminderRunResultDto,
  ReportQueryDto,
  StockReportDto,
  TopReaderDto,
  VisitDto,
  VisitInsightsDto,
  VisitQueryDto,
  VisitScanDto,
  VisitScanResultDto,
} from './dto/desk.dto';
import { FinesService } from './fines.service';
import { LibraryAlertsService } from './library-alerts.service';
import { LibrarySettingsService } from './library-settings.service';
import { MembersService } from './members.service';
import { ReportsService } from './reports.service';
import { VisitsService } from './visits.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TAG = 'Admin · Library';

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/library')
export class LibraryCatalogueController {
  constructor(
    private readonly settings: LibrarySettingsService,
    private readonly catalogue: CatalogueService,
    private readonly reports: ReportsService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Library home in one call: book, loan, fine and visit counts, due today, follow-ups, latest transactions',
  })
  @ApiEnvelope(LibraryDashboardDto)
  dashboard(@SchoolId() schoolId: number) {
    return this.reports.dashboard(schoolId);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Loan days, book limits, fine rules, alert days and opening hours' })
  @ApiEnvelope(LibrarySettingsDto)
  getSettings(@SchoolId() schoolId: number) {
    return this.settings.get(schoolId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Library settings saved')
  @ApiOperation({ summary: 'Change the library rules; new loans and fines use them' })
  @ApiEnvelope(LibrarySettingsDto, { message: 'Library settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateSettings(@SchoolId() schoolId: number, @Body() dto: LibrarySettingsInputDto, @CurrentUser() actor: AuthUser) {
    return this.settings.update(schoolId, dto, actor);
  }

  @Get('categories')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Book categories with their book and copy counts' })
  @ApiEnvelope(CategoryDto, { isArray: true })
  categories(@SchoolId() schoolId: number) {
    return this.catalogue.categories(schoolId);
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Category added')
  @ApiOperation({ summary: 'Add a category' })
  @ApiEnvelope(CategoryDto, { status: HttpStatus.CREATED, message: 'Category added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createCategory(@SchoolId() schoolId: number, @Body() dto: CategoryInputDto) {
    return this.catalogue.createCategory(schoolId, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Category saved')
  @ApiOperation({ summary: 'Edit a category' })
  @ApiEnvelope(CategoryDto, { message: 'Category saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateCategory(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CategoryUpdateDto) {
    return this.catalogue.updateCategory(schoolId, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Category deleted')
  @ApiOperation({ summary: 'Delete a category with no books (CATEGORY_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Category deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteCategory(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.catalogue.deleteCategory(schoolId, id);
    return null;
  }

  @Get('books/insights')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Catalogue cards: titles, copies, available, issued, overdue, lost, damaged, added this month',
  })
  @ApiEnvelope(BookInsightsDto)
  bookInsights(@SchoolId() schoolId: number) {
    return this.catalogue.insights(schoolId);
  }

  @Get('books/import/template')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ApiOperation({ summary: 'Excel template for importing books, with this school’s categories and an example row' })
  @ApiFile(XLSX, 'Book import template')
  async importTemplate(@SchoolId() schoolId: number) {
    const file = await this.catalogue.importTemplate(schoolId);
    return new StreamableFile(file.buffer, {
      type: XLSX,
      length: file.buffer.length,
      disposition: `attachment; filename="${file.name}"`,
    });
  }

  @Post('books/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: BOOK_IMPORT_UPLOAD_SCHEMA })
  @ApiOperation({
    summary: 'Check or import books from the Excel template or a CSV',
    description:
      'mode=validate checks every row and changes nothing; mode=import saves the valid rows. A row whose ISBN is already in the library adds copies to that book. Barcodes and accession numbers are separated by |. Unknown categories are created.',
  })
  @ApiEnvelope(BookImportReportDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.PAYLOAD_TOO_LARGE)
  importBooks(
    @SchoolId() schoolId: number,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Body() options: BookImportOptionsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalogue.importBooks(schoolId, file, options.mode ?? 'validate', actor);
  }

  @Get('books/isbn/:isbn')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Scan a book’s ISBN barcode: the title already in the library, or details to fill a new one',
    description:
      'Accepts ISBN-10 or ISBN-13 (the EAN-13 barcode on the back cover). book is the matching title here; suggestion comes from the online lookup when BOOK_LOOKUP_URL is set and the library allows it.',
  })
  @ApiEnvelope(IsbnLookupDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  isbn(@SchoolId() schoolId: number, @Param('isbn') isbn: string) {
    return this.catalogue.isbnLookup(schoolId, isbn);
  }

  @Get('books')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'The catalogue',
    description:
      'search: title, author, ISBN, publisher, keywords or a copy’s accession number or barcode. sort: title, authors, created_at, available.',
  })
  @ApiEnvelope(BookDto, { paginated: true })
  books(@SchoolId() schoolId: number, @Query() query: BookQueryDto) {
    return this.catalogue.listBooks(schoolId, query);
  }

  @Post('books')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Book added')
  @ApiOperation({
    summary: 'Add a book, optionally with its copies',
    description:
      'copies.count adds that many copies with new accession numbers; copies.barcodes keeps barcodes already on the books. DUPLICATE_ISBN when the ISBN is already here (add copies to that book instead).',
  })
  @ApiEnvelope(BookDto, { status: HttpStatus.CREATED, message: 'Book added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createBook(@SchoolId() schoolId: number, @Body() dto: BookCreateDto, @CurrentUser() actor: AuthUser) {
    return this.catalogue.createBook(schoolId, dto, actor);
  }

  @Get('books/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'One book with copy counts' })
  @ApiEnvelope(BookDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  book(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.catalogue.getBook(schoolId, id);
  }

  @Patch('books/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Book saved')
  @ApiOperation({ summary: 'Edit a book' })
  @ApiEnvelope(BookDto, { message: 'Book saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateBook(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: BookUpdateDto) {
    return this.catalogue.updateBook(schoolId, id, dto);
  }

  @Delete('books/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Book deleted')
  @ApiOperation({ summary: 'Delete a book and its copies; BOOK_ON_LOAN while a copy is out' })
  @ApiEnvelope(undefined, { message: 'Book deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteBook(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.catalogue.deleteBook(schoolId, id);
    return null;
  }

  @Get('books/:id/copies')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Every copy of a book with its status and who has it' })
  @ApiEnvelope(CopyDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  bookCopies(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.catalogue.bookCopies(schoolId, id);
  }

  @Post('books/:id/copies')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Copies added')
  @ApiOperation({ summary: 'Add copies to a book (count, or scanned barcodes)' })
  @ApiEnvelope(CopyDto, { isArray: true, status: HttpStatus.CREATED, message: 'Copies added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addCopies(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CopyInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalogue.addCopies(schoolId, id, dto, actor);
  }

  @Get('copies')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Inventory: every copy',
    description: 'search: accession number, barcode, title or author. sort: accession_no, created_at, title.',
  })
  @ApiEnvelope(CopyDto, { paginated: true })
  copies(@SchoolId() schoolId: number, @Query() query: CopyQueryDto) {
    return this.catalogue.listCopies(schoolId, query);
  }

  @Get('copies/lookup')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Scan a copy: the copy, its book and who has it now (COPY_NOT_FOUND otherwise)' })
  @ApiEnvelope(CopyDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  lookupCopy(@SchoolId() schoolId: number, @Query() query: CopyLookupQueryDto) {
    return this.catalogue.lookupCopy(schoolId, query.code);
  }

  @Get('copies/labels')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Barcode labels (A4, 3 × 8 stickers) for copies, a book or copies added since a date',
  })
  @ApiPdf('Barcode label sheet')
  async labels(@SchoolId() schoolId: number, @Query() query: LabelsQueryDto) {
    return pdfFile(await this.catalogue.labels(schoolId, query));
  }

  @Patch('copies/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Copy saved')
  @ApiOperation({
    summary:
      'Edit a copy: barcode, condition, purchase details, or shelf status (available, damaged, in_repair, withdrawn)',
  })
  @ApiEnvelope(CopyDto, { message: 'Copy saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateCopy(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CopyUpdateDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalogue.updateCopy(schoolId, id, dto, actor);
  }

  @Get('copies/:id/history')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Everything that happened to a copy, newest first' })
  @ApiEnvelope(CopyEventDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  copyHistory(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.catalogue.copyHistory(schoolId, id);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/library')
export class LibraryCirculationController {
  constructor(
    private readonly members: MembersService,
    private readonly circulation: CirculationService,
  ) {}

  @Get('members/insights')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Member cards: members, students, staff, suspended, with overdue books, with fines' })
  @ApiEnvelope(MemberInsightsDto)
  memberInsights(@SchoolId() schoolId: number) {
    return this.members.insights(schoolId);
  }

  @Get('members/people')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Find a student or staff member for the issue desk (members and not-yet members, up to 20)',
  })
  @ApiEnvelope(PersonDto, { isArray: true })
  people(@SchoolId() schoolId: number, @Query() query: PeopleQueryDto) {
    return this.members.people(schoolId, query);
  }

  @Get('members/lookup')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ApiOperation({
    summary: 'Scan a member at the desk: card number, ID card QR, admission number, employee number or staff mobile',
    description: 'Returns what they hold, unpaid fines and whether they may borrow. Non-members are enrolled.',
  })
  @ApiEnvelope(MemberSummaryDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  lookup(@SchoolId() schoolId: number, @Query() query: MemberLookupQueryDto) {
    return this.members.lookup(schoolId, query.code);
  }

  @Get('members')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Library members (students and staff)',
    description: 'search: name, card number, admission number, employee number. sort: name, card_no, joined_on.',
  })
  @ApiEnvelope(MemberDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: MemberQueryDto) {
    return this.members.list(schoolId, query);
  }

  @Post('members')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Member enrolled')
  @ApiOperation({ summary: 'Enrol one student or staff member (ALREADY_MEMBER when they are)' })
  @ApiEnvelope(MemberDto, { status: HttpStatus.CREATED, message: 'Member enrolled' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: MemberCreateDto) {
    return this.members.create(schoolId, dto);
  }

  @Post('members/bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Members enrolled')
  @ApiOperation({ summary: 'Enrol a whole section, class, every student or every staff member' })
  @ApiEnvelope(MemberBulkResultDto, { message: 'Members enrolled' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  bulk(@SchoolId() schoolId: number, @Body() dto: MemberBulkDto) {
    return this.members.bulk(schoolId, dto);
  }

  @Get('members/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'One member: books held now, unpaid fines and whether they may borrow' })
  @ApiEnvelope(MemberSummaryDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  member(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.members.summary(schoolId, id);
  }

  @Patch('members/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Member saved')
  @ApiOperation({ summary: 'Suspend or reactivate a member, or set their own book limit and loan days' })
  @ApiEnvelope(MemberDto, { message: 'Member saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: MemberUpdateDto) {
    return this.members.update(schoolId, id, dto);
  }

  @Get('issues/insights')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Loan cards: out, overdue, due today, due soon, issued and returned today, lost' })
  @ApiEnvelope(IssueInsightsDto)
  issueInsights(@SchoolId() schoolId: number) {
    return this.circulation.insights(schoolId);
  }

  @Get('issues/export')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Transaction history as CSV with the same filters as the list (up to 5000 rows)' })
  @ApiFile('text/csv', 'Library transactions')
  async exportIssues(@SchoolId() schoolId: number, @Query() query: IssueQueryDto) {
    const file = await this.circulation.exportCsv(schoolId, query);
    return new StreamableFile(file.buffer, {
      type: 'text/csv; charset=utf-8',
      length: file.buffer.length,
      disposition: `attachment; filename="${file.name}"`,
    });
  }

  @Get('issues')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Issue and return history (transactions)',
    description:
      'state filters books still out: on_loan, due_soon, due_today, overdue. search: book title, accession number, member name or card number. sort: issued_at, due_date, returned_at.',
  })
  @ApiEnvelope(LoanDto, { paginated: true })
  issues(@SchoolId() schoolId: number, @Query() query: IssueQueryDto) {
    return this.circulation.list(schoolId, query);
  }

  @Post('issues')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Books issued')
  @ApiOperation({
    summary: 'Issue books to a member',
    description:
      'All or nothing: a refusal names the copy (COPY_NOT_FOUND, COPY_NOT_AVAILABLE, REFERENCE_ONLY, SAME_TITLE_HELD, BOOK_LIMIT_REACHED, FINE_PENDING, MEMBER_NOT_ACTIVE). The due date follows the loan days and skips holidays unless due_date is given. Parents get LIBRARY_BOOK_ISSUED.',
  })
  @ApiEnvelope(LoanDto, { isArray: true, status: HttpStatus.CREATED, message: 'Books issued' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  issue(@SchoolId() schoolId: number, @Body() dto: IssueBooksDto, @CurrentUser() actor: AuthUser) {
    return this.circulation.issue(schoolId, dto, actor);
  }

  @Post('returns')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Books returned')
  @ApiOperation({
    summary: 'Return books by scanning them',
    description:
      'Late returns raise an overdue fine (students, and staff when the setting is on). A damage_fine raises a damage fine and sends the copy to repair; condition poor without a fine marks it damaged.',
  })
  @ApiEnvelope(ReturnedItemDto, { isArray: true, message: 'Books returned' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  returns(@SchoolId() schoolId: number, @Body() dto: ReturnBooksDto, @CurrentUser() actor: AuthUser) {
    return this.circulation.returnBooks(schoolId, dto, actor);
  }

  @Get('follow-ups')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Overdue books to follow up, oldest due first',
    description:
      'show=due (default): no follow-up yet, or the next follow-up date has come. show=all: every overdue loan.',
  })
  @ApiEnvelope(LoanDto, { paginated: true })
  followUps(@SchoolId() schoolId: number, @Query() query: FollowUpQueryDto) {
    return this.circulation.followUpQueue(schoolId, query);
  }

  @Get('issues/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'One loan with its follow-ups, fines and reminders sent' })
  @ApiEnvelope(LoanDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  loan(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.circulation.detail(schoolId, id);
  }

  @Post('issues/:id/renew')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Loan renewed')
  @ApiOperation({ summary: 'Renew a loan (RENEW_LIMIT_REACHED, LOAN_OVERDUE, LOAN_CLOSED)' })
  @ApiEnvelope(LoanDto, { message: 'Loan renewed' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  renew(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.circulation.renew(schoolId, id, dto, actor);
  }

  @Post('issues/:id/lost')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Book marked lost')
  @ApiOperation({ summary: 'Mark a book lost: a lost fine (price + processing fee) and any late fine are raised' })
  @ApiEnvelope(LoanDetailDto, { message: 'Book marked lost' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  lost(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LostDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.circulation.markLost(schoolId, id, dto, actor);
  }

  @Post('issues/:id/found')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Book found')
  @ApiOperation({
    summary: 'A lost book came back: the copy is available again and the unpaid part of the lost fine is waived',
  })
  @ApiEnvelope(LoanDetailDto, { message: 'Book found' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  found(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.circulation.markFound(schoolId, id, actor);
  }

  @Post('issues/:id/follow-ups')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Follow-up saved')
  @ApiOperation({ summary: 'Note a follow-up on an overdue loan: who was called, what was promised, when to check' })
  @ApiEnvelope(FollowUpDto, { status: HttpStatus.CREATED, message: 'Follow-up saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addFollowUp(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FollowUpInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.circulation.addFollowUp(schoolId, id, dto, actor);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/library')
export class LibraryDeskController {
  constructor(
    private readonly fines: FinesService,
    private readonly visits: VisitsService,
    private readonly audits: AuditsService,
    private readonly reports: ReportsService,
    private readonly alerts: LibraryAlertsService,
  ) {}

  @Post('reminders/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ApiOperation({
    summary: 'Send the due and overdue reminders now (they also go out every day at 08:00)',
    description:
      'Steps: due_soon, due_today, overdue (day 1), escalated (class teacher too, then weekly), long_overdue (librarian and admin). Each step is sent once per loan.',
  })
  @ApiEnvelope(ReminderRunResultDto)
  runReminders(@SchoolId() schoolId: number) {
    return this.alerts.runSchool(schoolId);
  }

  @Get('fines/insights')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Fine cards: outstanding, collected and waived this month, collected today' })
  @ApiEnvelope(FineInsightsDto)
  fineInsights(@SchoolId() schoolId: number) {
    return this.fines.insights(schoolId);
  }

  @Get('fines')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Library fines',
    description: 'search: member name, card number, book title. sort: created_at, balance, amount.',
  })
  @ApiEnvelope(FineDto, { paginated: true })
  fineList(@SchoolId() schoolId: number, @Query() query: FineQueryDto) {
    return this.fines.list(schoolId, query);
  }

  @Post('fines/:id/payments')
  @RequirePermissions(PERMISSIONS.LIBRARY_FINES)
  @ResponseMessage('Fine collected')
  @ApiOperation({ summary: 'Collect a fine (in part or full); a receipt number is given' })
  @ApiEnvelope(FinePaymentResultDto, { status: HttpStatus.CREATED, message: 'Fine collected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  pay(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FinePaymentInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fines.pay(schoolId, id, dto, actor);
  }

  @Post('fines/:id/waive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_WAIVE)
  @ResponseMessage('Fine waived')
  @ApiOperation({ summary: 'Waive a fine (all of the balance, or part) with a reason' })
  @ApiEnvelope(FineDto, { message: 'Fine waived' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  waive(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FineWaiveDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fines.waive(schoolId, id, dto, actor);
  }

  @Get('fine-payments')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Fine collections',
    description: 'search: receipt number, member name. sort: paid_on, amount.',
  })
  @ApiEnvelope(FinePaymentDto, { paginated: true })
  payments(@SchoolId() schoolId: number, @Query() query: FinePaymentQueryDto) {
    return this.fines.payments(schoolId, query);
  }

  @Get('fine-payments/:id/receipt')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Fine receipt PDF' })
  @ApiPdf('Library fine receipt')
  async receipt(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return pdfFile(await this.fines.receipt(schoolId, id));
  }

  @Get('visits/insights')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Attendance cards for a day: inside now, visitors, average time, library periods marked' })
  @ApiEnvelope(VisitInsightsDto)
  visitInsights(@SchoolId() schoolId: number, @Query() query: DateQueryDto) {
    return this.visits.insights(schoolId, query.date);
  }

  @Post('visits/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_ATTENDANCE)
  @ApiOperation({
    summary: 'Library attendance: scan an ID card QR or card number at the door',
    description:
      'The first scan checks the person in; the next scan the same day checks them out. QR_REPLACED for an old ID card.',
  })
  @ApiEnvelope(VisitScanResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  scan(@SchoolId() schoolId: number, @Body() dto: VisitScanDto, @CurrentUser() actor: AuthUser) {
    return this.visits.scan(schoolId, dto, actor);
  }

  @Get('visits')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Library attendance register (walk-ins and library periods)',
    description: 'search: name, admission number. sort: in_at, visit_date.',
  })
  @ApiEnvelope(VisitDto, { paginated: true })
  visitList(@SchoolId() schoolId: number, @Query() query: VisitQueryDto) {
    return this.visits.list(schoolId, query);
  }

  @Post('visits/:id/check-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_ATTENDANCE)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Check a visitor out by hand' })
  @ApiEnvelope(VisitDto, { message: 'Checked out' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkOut(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.visits.checkOut(schoolId, id);
  }

  @Get('periods')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({
    summary: 'Library periods on a day from the timetable (subjects named Library), with how many are marked',
  })
  @ApiEnvelope(LibraryPeriodDto, { isArray: true })
  periods(@SchoolId() schoolId: number, @Query() query: DateQueryDto) {
    return this.visits.periods(schoolId, query.date);
  }

  @Get('periods/:slotId')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Class roster for a library period with the marks saved for that day' })
  @ApiEnvelope(PeriodRosterDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  roster(@SchoolId() schoolId: number, @Param('slotId', ParseIntPipe) slotId: number, @Query() query: DateQueryDto) {
    return this.visits.roster(schoolId, slotId, query.date);
  }

  @Put('periods/:slotId/attendance')
  @RequirePermissions(PERMISSIONS.LIBRARY_ATTENDANCE)
  @ResponseMessage('Library period attendance saved')
  @ApiOperation({ summary: 'Mark a library period: everyone present except absent_student_ids' })
  @ApiEnvelope(PeriodRosterDto, { message: 'Library period attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  markPeriod(
    @SchoolId() schoolId: number,
    @Param('slotId', ParseIntPipe) slotId: number,
    @Body() dto: PeriodAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.visits.markPeriod(schoolId, slotId, dto, actor);
  }

  @Get('audits')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Stock checks, newest first' })
  @ApiEnvelope(AuditDto, { isArray: true })
  auditList(@SchoolId() schoolId: number) {
    return this.audits.list(schoolId);
  }

  @Post('audits')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Stock check started')
  @ApiOperation({ summary: 'Start a stock check for the whole library, a category or a rack (one open at a time)' })
  @ApiEnvelope(AuditDto, { status: HttpStatus.CREATED, message: 'Stock check started' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  startAudit(@SchoolId() schoolId: number, @Body() dto: AuditCreateDto) {
    return this.audits.create(schoolId, dto);
  }

  @Get('audits/:id')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'One stock check with its counts' })
  @ApiEnvelope(AuditDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  audit(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.audits.get(schoolId, id);
  }

  @Get('audits/:id/items')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Scanned codes by finding, or finding=missing for copies not scanned yet' })
  @ApiEnvelope(AuditItemDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  auditItems(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: AuditItemsQueryDto) {
    return this.audits.items(schoolId, id, query);
  }

  @Post('audits/:id/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ApiOperation({ summary: 'Scan a copy on the shelf during a stock check' })
  @ApiEnvelope(AuditScanResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  auditScan(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AuditScanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.audits.scan(schoolId, id, dto.code, actor);
  }

  @Post('audits/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Stock check closed')
  @ApiOperation({ summary: 'Close a stock check; optionally withdraw the copies still missing' })
  @ApiEnvelope(AuditDto, { message: 'Stock check closed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  closeAudit(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AuditCloseDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.audits.close(schoolId, id, dto, actor);
  }

  @Get('reports/most-borrowed')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Most borrowed books in a date range (default: this academic year)' })
  @ApiEnvelope(MostBorrowedDto, { isArray: true })
  mostBorrowed(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.mostBorrowed(schoolId, query);
  }

  @Get('reports/categories')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Circulation and stock by category' })
  @ApiEnvelope(CategoryReportDto, { isArray: true })
  categoryReport(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.categories(schoolId, query);
  }

  @Get('reports/top-readers')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Members who borrowed the most' })
  @ApiEnvelope(TopReaderDto, { isArray: true })
  topReaders(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.topReaders(schoolId, query);
  }

  @Get('reports/classes')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Reading by class: members, loans, overdue, visits and library period attendance' })
  @ApiEnvelope(ClassReportDto, { isArray: true })
  classReport(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.classes(schoolId, query);
  }

  @Get('reports/stock')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Stock register: copies and value by status and category' })
  @ApiEnvelope(StockReportDto)
  stock(@SchoolId() schoolId: number) {
    return this.reports.stock(schoolId);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@Controller('admin')
export class PersonLibraryController {
  constructor(private readonly members: MembersService) {}

  @Get('students/:id/library')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Student profile tab: books held, fines, history and library visits' })
  @ApiEnvelope(PersonLibraryDto)
  student(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.members.personLibrary(schoolId, { student_id: id });
  }

  @Get('staff/:id/library')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Staff profile tab: books held, fines, history and library visits (by staff id)' })
  @ApiEnvelope(PersonLibraryDto)
  staff(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.members.personLibrary(schoolId, { staff_id: id });
  }
}
