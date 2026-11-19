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
import { AssetsService } from './assets.service';
import {
  AllocateDto,
  AllocationDto,
  AllocationQueryDto,
  ASSET_IMPORT_UPLOAD_SCHEMA,
  AssetCreateDto,
  AssetCreateResultDto,
  AssetDto,
  AssetEventDto,
  AssetImportOptionsDto,
  AssetImportReportDto,
  AssetInsightsDto,
  AssetLabelsQueryDto,
  AssetLookupQueryDto,
  AssetQueryDto,
  AssetUpdateDto,
  DecisionDto,
  DisposalDto,
  DisposalInputDto,
  DisposalQueryDto,
  MarkLostDto,
  RejectDto,
  ReturnAssetsDto,
  TransferDto,
  TransferInputDto,
  TransferQueryDto,
} from './dto/asset.dto';
import {
  CategoryDto,
  CategoryInputDto,
  CategoryQueryDto,
  CategoryUpdateDto,
  DepartmentDto,
  DepartmentInputDto,
  DepartmentSyncResultDto,
  DepartmentUpdateDto,
  InventorySettingsDto,
  InventorySettingsInputDto,
  LocationDto,
  LocationInputDto,
  LocationQueryDto,
  LocationUpdateDto,
  StoreDto,
  StoreInputDto,
  StoreUpdateDto,
  VendorDto,
  VendorInputDto,
  VendorUpdateDto,
} from './dto/master.dto';
import {
  AdjustmentInputDto,
  AuditCloseDto,
  AuditDto,
  AuditInputDto,
  AuditItemDto,
  AuditItemsQueryDto,
  AuditScanDto,
  AuditScanResultDto,
  ConsumptionRowDto,
  CountInputDto,
  CountLineDto,
  DepreciationRowDto,
  DirectIssueDto,
  GroupQueryDto,
  GroupRowDto,
  InventoryAlertResultDto,
  InventoryDashboardDto,
  MaintenanceCostRowDto,
  MovementDto,
  MovementQueryDto,
  MyAssetDto,
  MyReturnedAssetDto,
  PeopleAssetsDto,
  ReceiptDto,
  ReceiptInputDto,
  ReceiptQueryDto,
  ReportQueryDto,
  RequisitionApproveDto,
  RequisitionDto,
  RequisitionInputDto,
  RequisitionIssueDto,
  RequisitionQueryDto,
  ScheduleDto,
  ScheduleInputDto,
  ScheduleQueryDto,
  ScheduleUpdateDto,
  StockInsightsDto,
  StockItemDetailDto,
  StockItemDto,
  StockItemInputDto,
  StockItemQueryDto,
  StockItemUpdateDto,
  StockValuationRowDto,
  TicketCancelDto,
  TicketDto,
  TicketInputDto,
  TicketQueryDto,
  TicketResolveDto,
  TicketUpdateDto,
} from './dto/operations.dto';
import { InventoryAlertsService } from './inventory-alerts.service';
import { InventoryAuditsService } from './inventory-audits.service';
import { InventoryMastersService } from './inventory-masters.service';
import { InventoryReportsService } from './inventory-reports.service';
import { MaintenanceService } from './maintenance.service';
import { StockService } from './stock.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TAG = 'Admin · Inventory';
const P = PERMISSIONS;

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/inventory')
export class InventoryMastersController {
  constructor(
    private readonly masters: InventoryMastersService,
    private readonly reports: InventoryReportsService,
    private readonly alerts: InventoryAlertsService,
  ) {}

  @Post('alerts/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ApiOperation({
    summary: 'Send the inventory alerts now (they also go out daily at 08:15)',
    description:
      'Overdue return reminders to staff, and digests to the store keeper and admin: maintenance due, warranty/AMC ending, low stock. Run by hand it sends everything currently due, not only what changed today.',
  })
  @ApiEnvelope(InventoryAlertResultDto)
  runAlerts(@SchoolId() schoolId: number) {
    return this.alerts.runSchool(schoolId, true);
  }

  @Get('dashboard')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Inventory home: asset and stock counts, maintenance due, warranty expiring, overdue returns, approvals',
  })
  @ApiEnvelope(InventoryDashboardDto)
  dashboard(@SchoolId() schoolId: number) {
    return this.reports.dashboard(schoolId);
  }

  @Get('settings')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Approval switches, depreciation method and alert days' })
  @ApiEnvelope(InventorySettingsDto)
  settings(@SchoolId() schoolId: number) {
    return this.masters.settings(schoolId);
  }

  @Put('settings')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Inventory settings saved')
  @ApiOperation({ summary: 'Change the inventory settings' })
  @ApiEnvelope(InventorySettingsDto, { message: 'Inventory settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateSettings(@SchoolId() schoolId: number, @Body() dto: InventorySettingsInputDto, @CurrentUser() actor: AuthUser) {
    return this.masters.updateSettings(schoolId, dto, actor);
  }

  @Get('categories')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Asset and stock categories with item counts' })
  @ApiEnvelope(CategoryDto, { isArray: true })
  categories(@SchoolId() schoolId: number, @Query() query: CategoryQueryDto) {
    return this.masters.categories(schoolId, query);
  }

  @Post('categories')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Category added')
  @ApiOperation({ summary: 'Add a category (asset or stock), optionally under a parent of the same kind' })
  @ApiEnvelope(CategoryDto, { status: HttpStatus.CREATED, message: 'Category added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createCategory(@SchoolId() schoolId: number, @Body() dto: CategoryInputDto) {
    return this.masters.createCategory(schoolId, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Category saved')
  @ApiOperation({ summary: 'Edit a category (the kind cannot change once it has items)' })
  @ApiEnvelope(CategoryDto, { message: 'Category saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateCategory(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CategoryUpdateDto) {
    return this.masters.updateCategory(schoolId, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Category deleted')
  @ApiOperation({ summary: 'Delete an empty category (CATEGORY_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Category deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteCategory(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.masters.deleteCategory(schoolId, id);
    return null;
  }

  @Get('locations')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Rooms, labs, offices and stores',
    description: 'search: name, code, building. sort: name, code, building.',
  })
  @ApiEnvelope(LocationDto, { paginated: true })
  locations(@SchoolId() schoolId: number, @Query() query: LocationQueryDto) {
    return this.masters.locations(schoolId, query);
  }

  @Post('locations')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Location added')
  @ApiOperation({ summary: 'Add a location' })
  @ApiEnvelope(LocationDto, { status: HttpStatus.CREATED, message: 'Location added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createLocation(@SchoolId() schoolId: number, @Body() dto: LocationInputDto) {
    return this.masters.createLocation(schoolId, dto);
  }

  @Post('locations/sync-rooms')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Rooms added from the timetable')
  @ApiOperation({ summary: 'Create locations for the rooms used in the timetable ("Block A · 501")' })
  @ApiEnvelope(DepartmentSyncResultDto)
  syncRooms(@SchoolId() schoolId: number) {
    return this.masters.syncRooms(schoolId);
  }

  @Patch('locations/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Location saved')
  @ApiOperation({ summary: 'Edit a location' })
  @ApiEnvelope(LocationDto, { message: 'Location saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateLocation(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: LocationUpdateDto) {
    return this.masters.updateLocation(schoolId, id, dto);
  }

  @Delete('locations/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Location deleted')
  @ApiOperation({ summary: 'Delete a location with no assets (LOCATION_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Location deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteLocation(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.masters.deleteLocation(schoolId, id);
    return null;
  }

  @Get('departments')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Departments with staff and asset counts' })
  @ApiEnvelope(DepartmentDto, { isArray: true })
  departments(@SchoolId() schoolId: number) {
    return this.masters.departments(schoolId);
  }

  @Post('departments')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Department added')
  @ApiOperation({ summary: 'Add a department' })
  @ApiEnvelope(DepartmentDto, { status: HttpStatus.CREATED, message: 'Department added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createDepartment(@SchoolId() schoolId: number, @Body() dto: DepartmentInputDto) {
    return this.masters.createDepartment(schoolId, dto);
  }

  @Post('departments/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Departments added from staff')
  @ApiOperation({ summary: 'Create a department for every department name used on staff profiles' })
  @ApiEnvelope(DepartmentSyncResultDto)
  syncDepartments(@SchoolId() schoolId: number) {
    return this.masters.syncDepartments(schoolId);
  }

  @Get('departments/:id/assets')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Assets allocated to a department now, and the returned ones' })
  @ApiEnvelope(PeopleAssetsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  departmentAssets(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.masters.departmentAssets(schoolId, id);
  }

  @Patch('departments/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Department saved')
  @ApiOperation({ summary: 'Edit a department' })
  @ApiEnvelope(DepartmentDto, { message: 'Department saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateDepartment(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DepartmentUpdateDto,
  ) {
    return this.masters.updateDepartment(schoolId, id, dto);
  }

  @Delete('departments/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Department deleted')
  @ApiOperation({ summary: 'Delete a department with no assets (DEPARTMENT_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Department deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteDepartment(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.masters.deleteDepartment(schoolId, id);
    return null;
  }

  @Get('vendors')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Vendors and suppliers' })
  @ApiEnvelope(VendorDto, { isArray: true })
  vendors(@SchoolId() schoolId: number) {
    return this.masters.vendors(schoolId);
  }

  @Post('vendors')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Vendor added')
  @ApiOperation({ summary: 'Add a vendor' })
  @ApiEnvelope(VendorDto, { status: HttpStatus.CREATED, message: 'Vendor added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  createVendor(@SchoolId() schoolId: number, @Body() dto: VendorInputDto) {
    return this.masters.createVendor(schoolId, dto);
  }

  @Patch('vendors/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Vendor saved')
  @ApiOperation({ summary: 'Edit a vendor' })
  @ApiEnvelope(VendorDto, { message: 'Vendor saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateVendor(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: VendorUpdateDto) {
    return this.masters.updateVendor(schoolId, id, dto);
  }

  @Delete('vendors/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Vendor deleted')
  @ApiOperation({ summary: 'Delete an unused vendor (VENDOR_IN_USE otherwise; mark it inactive instead)' })
  @ApiEnvelope(undefined, { message: 'Vendor deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteVendor(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.masters.removeVendor(schoolId, id);
    return null;
  }

  @Get('stores')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Stores with stock held' })
  @ApiEnvelope(StoreDto, { isArray: true })
  stores(@SchoolId() schoolId: number) {
    return this.masters.stores(schoolId);
  }

  @Post('stores')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Store added')
  @ApiOperation({ summary: 'Add a store' })
  @ApiEnvelope(StoreDto, { status: HttpStatus.CREATED, message: 'Store added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createStore(@SchoolId() schoolId: number, @Body() dto: StoreInputDto) {
    return this.masters.createStore(schoolId, dto);
  }

  @Patch('stores/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Store saved')
  @ApiOperation({ summary: 'Edit a store' })
  @ApiEnvelope(StoreDto, { message: 'Store saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateStore(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: StoreUpdateDto) {
    return this.masters.updateStore(schoolId, id, dto);
  }

  @Delete('stores/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Store deleted')
  @ApiOperation({ summary: 'Delete an unused store (STORE_IN_USE otherwise; mark it inactive instead)' })
  @ApiEnvelope(undefined, { message: 'Store deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteStore(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.masters.removeStore(schoolId, id);
    return null;
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/inventory')
export class InventoryAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('assets/insights')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Asset cards: totals, value, by status, warranty expiring, overdue returns, unacknowledged',
  })
  @ApiEnvelope(AssetInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.assets.insights(schoolId);
  }

  @Get('assets/import/template')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Excel template for importing assets, with this school’s categories and locations' })
  @ApiFile(XLSX, 'Asset import template')
  async template(@SchoolId() schoolId: number) {
    const file = await this.assets.importTemplate(schoolId);
    return new StreamableFile(file.buffer, {
      type: XLSX,
      length: file.buffer.length,
      disposition: `attachment; filename="${file.name}"`,
    });
  }

  @Post('assets/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: ASSET_IMPORT_UPLOAD_SCHEMA })
  @ApiOperation({
    summary: 'Check or import assets from the Excel template or a CSV',
    description:
      'mode=validate checks every row and saves nothing; mode=import saves the valid rows. Quantity registers that many identical assets; serial numbers are separated by |. New category, location and vendor names are created.',
  })
  @ApiEnvelope(AssetImportReportDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.PAYLOAD_TOO_LARGE)
  importAssets(
    @SchoolId() schoolId: number,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Body() options: AssetImportOptionsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.assets.importAssets(schoolId, file, options.mode ?? 'validate', actor);
  }

  @Get('assets/lookup')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Scan an asset tag (or type a serial number): the asset and who has it' })
  @ApiEnvelope(AssetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  lookup(@SchoolId() schoolId: number, @Query() query: AssetLookupQueryDto) {
    return this.assets.lookup(schoolId, query.code);
  }

  @Get('assets/labels')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Asset tag labels (A4, 3 × 8, Code 128) for chosen assets, a location, a category or a date',
  })
  @ApiPdf('Asset tag labels')
  async labels(@SchoolId() schoolId: number, @Query() query: AssetLabelsQueryDto) {
    return pdfFile(await this.assets.labels(schoolId, query));
  }

  @Get('assets')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'The asset register',
    description:
      'search: tag, name, serial number, make, model. sort: asset_tag, name, purchase_date, cost, created_at. custodian_user_id also matches staff allocations.',
  })
  @ApiEnvelope(AssetDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: AssetQueryDto) {
    return this.assets.list(schoolId, query);
  }

  @Post('assets')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Assets registered')
  @ApiOperation({
    summary: 'Register one asset or many identical ones (quantity), each with its own tag',
    description:
      'The assets start in store. schedule_maintenance adds a preventive schedule from the category interval.',
  })
  @ApiEnvelope(AssetCreateResultDto, { status: HttpStatus.CREATED, message: 'Assets registered' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: AssetCreateDto, @CurrentUser() actor: AuthUser) {
    return this.assets.create(schoolId, dto, actor);
  }

  @Get('assets/:id')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'One asset with its book value, current allocation and warranty state' })
  @ApiEnvelope(AssetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  one(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.assets.get(schoolId, id);
  }

  @Patch('assets/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Asset saved')
  @ApiOperation({
    summary: 'Edit asset details and condition (status changes through allocate, maintenance, lost, dispose)',
  })
  @ApiEnvelope(AssetDto, { message: 'Asset saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssetUpdateDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.assets.update(schoolId, id, dto, actor);
  }

  @Delete('assets/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Asset deleted')
  @ApiOperation({
    summary: 'Delete an asset registered by mistake (only in store and never allocated; ASSET_HAS_HISTORY otherwise)',
  })
  @ApiEnvelope(undefined, { message: 'Asset deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.assets.remove(schoolId, id);
    return null;
  }

  @Get('assets/:id/history')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Everything that happened to an asset, newest first' })
  @ApiEnvelope(AssetEventDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  history(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.assets.history(schoolId, id);
  }

  @Post('assets/:id/lost')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Asset marked lost')
  @ApiOperation({
    summary: 'Mark an asset lost (an active allocation is closed; ASSET_IN_TRANSFER while a transfer is open)',
  })
  @ApiEnvelope(AssetDto, { message: 'Asset marked lost' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  lost(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkLostDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.assets.markLost(schoolId, id, dto, actor);
  }

  @Post('assets/:id/found')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Asset back in store')
  @ApiOperation({ summary: 'A lost asset was found: it goes back in store' })
  @ApiEnvelope(AssetDto, { message: 'Asset back in store' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  found(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.assets.markFound(schoolId, id, actor);
  }

  @Post('allocations')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Assets allocated')
  @ApiOperation({
    summary: 'Allocate assets in store to a staff member, a department or a location',
    description:
      'All or nothing. Staff get INVENTORY_ASSET_ASSIGNED and acknowledge it (or the office marks it). Refusals: ASSET_ALLOCATED, ASSET_IN_MAINTENANCE, ASSET_LOST, ASSET_DISPOSED.',
  })
  @ApiEnvelope(AllocationDto, { isArray: true, status: HttpStatus.CREATED, message: 'Assets allocated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  allocate(@SchoolId() schoolId: number, @Body() dto: AllocateDto, @CurrentUser() actor: AuthUser) {
    return this.assets.allocate(schoolId, dto, actor);
  }

  @Post('allocations/return')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Assets returned')
  @ApiOperation({ summary: 'Take allocated assets back into store, with their condition (NOT_ALLOCATED otherwise)' })
  @ApiEnvelope(AllocationDto, { isArray: true, message: 'Assets returned' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  giveBack(@SchoolId() schoolId: number, @Body() dto: ReturnAssetsDto, @CurrentUser() actor: AuthUser) {
    return this.assets.returnAssets(schoolId, dto, actor);
  }

  @Get('allocations')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Who has what: allocations with overdue and unacknowledged filters',
    description: 'search: asset tag, asset name, assignee name. sort: allocated_on, expected_return_on, returned_on.',
  })
  @ApiEnvelope(AllocationDto, { paginated: true })
  allocations(@SchoolId() schoolId: number, @Query() query: AllocationQueryDto) {
    return this.assets.allocations(schoolId, query);
  }

  @Post('allocations/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Marked as received')
  @ApiOperation({ summary: 'Mark an allocation as received on the staff member’s behalf (signed register)' })
  @ApiEnvelope(AllocationDto, { message: 'Marked as received' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  acknowledge(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.assets.acknowledge(schoolId, id, actor, false);
  }

  @Get('transfers')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Transfer requests and history',
    description: 'search: transfer number, reason, asset tag.',
  })
  @ApiEnvelope(TransferDto, { paginated: true })
  transfers(@SchoolId() schoolId: number, @Query() query: TransferQueryDto) {
    return this.assets.transfers(schoolId, query);
  }

  @Post('transfers')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Transfer created')
  @ApiOperation({
    summary: 'Move assets to another staff member, department or location',
    description:
      'With approve_transfers on, the transfer waits as requested (approvers get INVENTORY_APPROVAL_NEEDED); otherwise it completes at once. ASSET_IN_TRANSFER when an asset already has an open transfer.',
  })
  @ApiEnvelope(TransferDto, { status: HttpStatus.CREATED, message: 'Transfer created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createTransfer(@SchoolId() schoolId: number, @Body() dto: TransferInputDto, @CurrentUser() actor: AuthUser) {
    return this.assets.createTransfer(schoolId, dto, actor);
  }

  @Get('transfers/:id')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'One transfer' })
  @ApiEnvelope(TransferDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  transfer(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.assets.transfer(schoolId, id);
  }

  @Post('transfers/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_APPROVE)
  @ResponseMessage('Transfer approved')
  @ApiOperation({ summary: 'Approve a requested transfer and move the assets' })
  @ApiEnvelope(TransferDto, { message: 'Transfer approved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approveTransfer(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.assets.approveTransfer(schoolId, id, dto, actor);
  }

  @Post('transfers/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_APPROVE)
  @ResponseMessage('Transfer rejected')
  @ApiOperation({ summary: 'Reject a requested transfer' })
  @ApiEnvelope(TransferDto, { message: 'Transfer rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  rejectTransfer(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.assets.rejectTransfer(schoolId, id, dto, actor);
  }

  @Post('transfers/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Transfer cancelled')
  @ApiOperation({ summary: 'Cancel a requested transfer' })
  @ApiEnvelope(TransferDto, { message: 'Transfer cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelTransfer(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.assets.cancelTransfer(schoolId, id, actor);
  }

  @Get('disposals')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Disposal requests and the disposed register', description: 'search: number, tag, reason.' })
  @ApiEnvelope(DisposalDto, { paginated: true })
  disposals(@SchoolId() schoolId: number, @Query() query: DisposalQueryDto) {
    return this.assets.disposals(schoolId, query);
  }

  @Post('disposals')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Disposal created')
  @ApiOperation({
    summary:
      'Dispose of an asset (sold, scrapped, donated, lost, written off); ASSET_ALLOCATED or ASSET_IN_TRANSFER until it is back',
    description: 'Waits for approval when approve_disposals is on. The asset must not be allocated.',
  })
  @ApiEnvelope(DisposalDto, { status: HttpStatus.CREATED, message: 'Disposal created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createDisposal(@SchoolId() schoolId: number, @Body() dto: DisposalInputDto, @CurrentUser() actor: AuthUser) {
    return this.assets.createDisposal(schoolId, dto, actor);
  }

  @Post('disposals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_APPROVE)
  @ResponseMessage('Disposal approved')
  @ApiOperation({ summary: 'Approve a disposal: the asset leaves the active register' })
  @ApiEnvelope(DisposalDto, { message: 'Disposal approved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approveDisposal(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.assets.approveDisposal(schoolId, id, dto, actor);
  }

  @Post('disposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_APPROVE)
  @ResponseMessage('Disposal rejected')
  @ApiOperation({ summary: 'Reject a disposal request' })
  @ApiEnvelope(DisposalDto, { message: 'Disposal rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  rejectDisposal(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.assets.rejectDisposal(schoolId, id, dto, actor);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/inventory')
export class InventoryOperationsController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly stock: StockService,
    private readonly audits: InventoryAuditsService,
    private readonly reports: InventoryReportsService,
  ) {}

  @Get('maintenance')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Maintenance tickets',
    description: 'search: ticket number, title, asset tag. sort: opened_at, priority, resolved_at.',
  })
  @ApiEnvelope(TicketDto, { paginated: true })
  tickets(@SchoolId() schoolId: number, @Query() query: TicketQueryDto) {
    return this.maintenance.list(schoolId, query);
  }

  @Post('maintenance')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Ticket opened')
  @ApiOperation({
    summary: 'Open a breakdown, preventive or inspection ticket; the asset goes under maintenance',
    description: 'under_warranty is set from the warranty or AMC date. TICKET_OPEN when the asset already has one.',
  })
  @ApiEnvelope(TicketDto, { status: HttpStatus.CREATED, message: 'Ticket opened' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  openTicket(@SchoolId() schoolId: number, @Body() dto: TicketInputDto, @CurrentUser() actor: AuthUser) {
    return this.maintenance.open(schoolId, dto, actor);
  }

  @Get('maintenance/:id')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'One ticket' })
  @ApiEnvelope(TicketDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  ticket(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.maintenance.get(schoolId, id);
  }

  @Patch('maintenance/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Ticket saved')
  @ApiOperation({ summary: 'Start work, change priority, assign a person or vendor' })
  @ApiEnvelope(TicketDto, { message: 'Ticket saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateTicket(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: TicketUpdateDto) {
    return this.maintenance.update(schoolId, id, dto);
  }

  @Post('maintenance/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Ticket resolved')
  @ApiOperation({
    summary: 'Resolve a ticket: cost, parts, condition; the asset goes back to its allocation or store',
    description:
      'A preventive ticket moves its schedule to the next due date. The reporter gets INVENTORY_TICKET_RESOLVED.',
  })
  @ApiEnvelope(TicketDto, { message: 'Ticket resolved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  resolve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TicketResolveDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.maintenance.resolve(schoolId, id, dto, actor);
  }

  @Post('maintenance/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Ticket cancelled')
  @ApiOperation({ summary: 'Cancel a ticket raised by mistake' })
  @ApiEnvelope(TicketDto, { message: 'Ticket cancelled' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TicketCancelDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.maintenance.cancel(schoolId, id, dto, actor);
  }

  @Get('schedules')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Preventive maintenance schedules (state: overdue, due_soon, scheduled)' })
  @ApiEnvelope(ScheduleDto, { paginated: true })
  schedules(@SchoolId() schoolId: number, @Query() query: ScheduleQueryDto) {
    return this.maintenance.schedules(schoolId, query);
  }

  @Post('schedules')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Schedule added')
  @ApiOperation({ summary: 'Add a preventive maintenance schedule for an asset' })
  @ApiEnvelope(ScheduleDto, { status: HttpStatus.CREATED, message: 'Schedule added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  createSchedule(@SchoolId() schoolId: number, @Body() dto: ScheduleInputDto) {
    return this.maintenance.createSchedule(schoolId, dto);
  }

  @Patch('schedules/:id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Schedule saved')
  @ApiOperation({ summary: 'Edit or pause a schedule' })
  @ApiEnvelope(ScheduleDto, { message: 'Schedule saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateSchedule(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ScheduleUpdateDto) {
    return this.maintenance.updateSchedule(schoolId, id, dto);
  }

  @Post('schedules/:id/start')
  @RequirePermissions(P.INVENTORY_MANAGE)
  @ResponseMessage('Ticket opened')
  @ApiOperation({ summary: 'Open the preventive ticket for a due schedule' })
  @ApiEnvelope(TicketDto, { status: HttpStatus.CREATED, message: 'Ticket opened' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  startSchedule(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.maintenance.startSchedule(schoolId, id, actor);
  }

  @Get('stock/insights')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Stock cards: items, value, low, out of stock, requisitions waiting, received and issued this month',
  })
  @ApiEnvelope(StockInsightsDto)
  stockInsights(@SchoolId() schoolId: number) {
    return this.stock.insights(schoolId);
  }

  @Get('stock/items')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Stock items with balance and value (all stores, or store_id)',
    description: 'search: name, code. sort: name, code, quantity, value.',
  })
  @ApiEnvelope(StockItemDto, { paginated: true })
  items(@SchoolId() schoolId: number, @Query() query: StockItemQueryDto) {
    return this.stock.items(schoolId, query);
  }

  @Post('stock/items')
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Item added')
  @ApiOperation({ summary: 'Add a stock item (in a stock category)' })
  @ApiEnvelope(StockItemDto, { status: HttpStatus.CREATED, message: 'Item added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createItem(@SchoolId() schoolId: number, @Body() dto: StockItemInputDto) {
    return this.stock.createItem(schoolId, dto);
  }

  @Get('stock/items/:id')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'One stock item with its balance in every store' })
  @ApiEnvelope(StockItemDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  item(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.stock.item(schoolId, id);
  }

  @Patch('stock/items/:id')
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Item saved')
  @ApiOperation({ summary: 'Edit a stock item' })
  @ApiEnvelope(StockItemDto, { message: 'Item saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateItem(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: StockItemUpdateDto) {
    return this.stock.updateItem(schoolId, id, dto);
  }

  @Delete('stock/items/:id')
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Item deleted')
  @ApiOperation({ summary: 'Delete a stock item with no movements (ITEM_IN_USE otherwise; mark it inactive instead)' })
  @ApiEnvelope(undefined, { message: 'Item deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteItem(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.stock.removeItem(schoolId, id);
    return null;
  }

  @Get('stock/receipts')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Goods received',
    description:
      'search: receipt number, invoice number, vendor. sort: received_on (default), receipt_no, total, vendor.',
  })
  @ApiEnvelope(ReceiptDto, { paginated: true })
  receipts(@SchoolId() schoolId: number, @Query() query: ReceiptQueryDto) {
    return this.stock.receipts(schoolId, query);
  }

  @Post('stock/receipts')
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Stock received')
  @ApiOperation({ summary: 'Receive stock into a store (goods receipt); the average cost is updated' })
  @ApiEnvelope(ReceiptDto, { status: HttpStatus.CREATED, message: 'Stock received' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  receive(@SchoolId() schoolId: number, @Body() dto: ReceiptInputDto, @CurrentUser() actor: AuthUser) {
    return this.stock.receive(schoolId, dto, actor);
  }

  @Get('stock/receipts/:id')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'One goods receipt with its lines' })
  @ApiEnvelope(ReceiptDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  receipt(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.stock.receipt(schoolId, id);
  }

  @Post('stock/adjustments')
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Stock adjusted')
  @ApiOperation({ summary: 'Adjust stock (damaged, expired, count correction, returned, other) with a reason' })
  @ApiEnvelope(MovementDto, { status: HttpStatus.CREATED, message: 'Stock adjusted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  adjust(@SchoolId() schoolId: number, @Body() dto: AdjustmentInputDto, @CurrentUser() actor: AuthUser) {
    return this.stock.adjust(schoolId, dto, actor);
  }

  @Post('stock/issues')
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Stock issued')
  @ApiOperation({ summary: 'Issue stock directly (no requisition) to a department, staff member or class' })
  @ApiEnvelope(MovementDto, { isArray: true, status: HttpStatus.CREATED, message: 'Stock issued' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  issue(@SchoolId() schoolId: number, @Body() dto: DirectIssueDto, @CurrentUser() actor: AuthUser) {
    return this.stock.directIssue(schoolId, dto, actor);
  }

  @Get('stock/movements')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Stock ledger: every receipt, issue, return and adjustment with the running balance',
    description: 'search: item name, code, reference, note. sort: created_at, moved_on.',
  })
  @ApiEnvelope(MovementDto, { paginated: true })
  movements(@SchoolId() schoolId: number, @Query() query: MovementQueryDto) {
    return this.stock.movements(schoolId, query);
  }

  @Get('requisitions')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Stock requisitions', description: 'search: number, purpose. sort: created_at, needed_by.' })
  @ApiEnvelope(RequisitionDto, { paginated: true })
  requisitions(@SchoolId() schoolId: number, @Query() query: RequisitionQueryDto) {
    return this.stock.requisitions(schoolId, query);
  }

  @Post('requisitions')
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Requisition raised')
  @ApiOperation({
    summary: 'Raise a requisition for a department, staff member or class',
    description: 'Waits for approval when approve_requisitions is on; otherwise it is approved at once.',
  })
  @ApiEnvelope(RequisitionDto, { status: HttpStatus.CREATED, message: 'Requisition raised' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  raise(@SchoolId() schoolId: number, @Body() dto: RequisitionInputDto, @CurrentUser() actor: AuthUser) {
    return this.stock.raise(schoolId, dto, actor);
  }

  @Get('requisitions/:id')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'One requisition with what is available in the store' })
  @ApiEnvelope(RequisitionDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  requisition(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.stock.requisition(schoolId, id);
  }

  @Post('requisitions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_APPROVE)
  @ResponseMessage('Requisition approved')
  @ApiOperation({ summary: 'Approve a requisition, optionally with smaller quantities' })
  @ApiEnvelope(RequisitionDto, { message: 'Requisition approved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequisitionApproveDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.stock.approve(schoolId, id, dto, actor);
  }

  @Post('requisitions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_APPROVE)
  @ResponseMessage('Requisition rejected')
  @ApiOperation({ summary: 'Reject a requisition' })
  @ApiEnvelope(RequisitionDto, { message: 'Requisition rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.stock.reject(schoolId, id, dto, actor);
  }

  @Post('requisitions/:id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Stock issued')
  @ApiOperation({
    summary: 'Issue an approved requisition (all of it, or part); stock goes down',
    description: 'NOT_ENOUGH_STOCK names the item. Partly issued requisitions can be issued again.',
  })
  @ApiEnvelope(RequisitionDto, { message: 'Stock issued' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  issueRequisition(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequisitionIssueDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.stock.issueRequisition(schoolId, id, dto, actor);
  }

  @Post('requisitions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_STOCK)
  @ResponseMessage('Requisition cancelled')
  @ApiOperation({ summary: 'Cancel a requisition that is not issued yet' })
  @ApiEnvelope(RequisitionDto, { message: 'Requisition cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelRequisition(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.stock.cancel(schoolId, id, actor);
  }

  @Get('audits')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Asset verifications and stock counts, newest first' })
  @ApiEnvelope(AuditDto, { isArray: true })
  listAudits(@SchoolId() schoolId: number) {
    return this.audits.list(schoolId);
  }

  @Post('audits')
  @RequirePermissions(P.INVENTORY_AUDIT)
  @ResponseMessage('Audit started')
  @ApiOperation({
    summary: 'Start an asset verification (location, category, department or whole school) or a stock count (store)',
    description: 'One open audit of each kind at a time (AUDIT_OPEN).',
  })
  @ApiEnvelope(AuditDto, { status: HttpStatus.CREATED, message: 'Audit started' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  startAudit(@SchoolId() schoolId: number, @Body() dto: AuditInputDto) {
    return this.audits.create(schoolId, dto);
  }

  @Get('audits/:id')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'One audit with its counts' })
  @ApiEnvelope(AuditDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  audit(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.audits.get(schoolId, id);
  }

  @Post('audits/:id/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_AUDIT)
  @ApiOperation({ summary: 'Asset verification: scan an asset tag where it stands' })
  @ApiEnvelope(AuditScanResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  scan(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AuditScanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.audits.scan(schoolId, id, dto, actor);
  }

  @Get('audits/:id/items')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Asset verification: scanned assets by finding, or finding=missing' })
  @ApiEnvelope(AuditItemDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  auditItems(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: AuditItemsQueryDto) {
    return this.audits.items(schoolId, id, query);
  }

  @Get('audits/:id/count')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Stock count sheet: every item in the store with the system and counted quantity' })
  @ApiEnvelope(CountLineDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  countSheet(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.audits.countSheet(schoolId, id);
  }

  @Put('audits/:id/count')
  @RequirePermissions(P.INVENTORY_AUDIT)
  @ResponseMessage('Counts saved')
  @ApiOperation({ summary: 'Save counted quantities (any number of lines, any number of times)' })
  @ApiEnvelope(CountLineDto, { isArray: true, message: 'Counts saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  saveCount(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CountInputDto) {
    return this.audits.saveCount(schoolId, id, dto);
  }

  @Post('audits/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.INVENTORY_AUDIT)
  @ResponseMessage('Audit closed')
  @ApiOperation({
    summary: 'Close an audit',
    description:
      'Asset verification: mark_missing_lost marks the assets not found as lost. Stock count: post_adjustments posts the differences as count corrections.',
  })
  @ApiEnvelope(AuditDto, { message: 'Audit closed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AuditCloseDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.audits.close(schoolId, id, dto, actor);
  }

  @Get('reports/assets')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'Assets grouped by category, location, department, custodian or status with cost and book value',
  })
  @ApiEnvelope(GroupRowDto, { isArray: true })
  grouped(@SchoolId() schoolId: number, @Query() query: GroupQueryDto) {
    return this.reports.grouped(schoolId, query);
  }

  @Get('reports/depreciation')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Depreciation by category for a date range (default: this academic year)' })
  @ApiEnvelope(DepreciationRowDto, { isArray: true })
  depreciation(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.depreciation(schoolId, query);
  }

  @Get('reports/maintenance')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Maintenance tickets, cost and downtime by category' })
  @ApiEnvelope(MaintenanceCostRowDto, { isArray: true })
  maintenanceReport(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.maintenanceCost(schoolId, query);
  }

  @Get('reports/consumption')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Stock issued by department and item in a date range' })
  @ApiEnvelope(ConsumptionRowDto, { isArray: true })
  consumption(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.consumption(schoolId, query);
  }

  @Get('reports/stock-valuation')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Stock on hand with average cost and value' })
  @ApiEnvelope(StockValuationRowDto, { isArray: true })
  valuation(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    return this.reports.stockValuation(schoolId, query);
  }

  @Get('reports/register/export')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({
    summary: 'The asset register as CSV with the asset list filters (up to 10000 rows)',
    description: 'Takes the same filters and search as GET assets; page, limit and sort are ignored.',
  })
  @ApiFile('text/csv', 'Asset register')
  async registerExport(@SchoolId() schoolId: number, @Query() query: AssetQueryDto) {
    const file = await this.reports.registerCsv(schoolId, query);
    return new StreamableFile(file.buffer, {
      type: 'text/csv; charset=utf-8',
      length: file.buffer.length,
      disposition: `attachment; filename="${file.name}"`,
    });
  }

  @Get('reports/movements/export')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'The stock ledger as CSV for a date range' })
  @ApiFile('text/csv', 'Stock ledger')
  async movementsExport(@SchoolId() schoolId: number, @Query() query: ReportQueryDto) {
    const file = await this.reports.movementsCsv(schoolId, query);
    return new StreamableFile(file.buffer, {
      type: 'text/csv; charset=utf-8',
      length: file.buffer.length,
      disposition: `attachment; filename="${file.name}"`,
    });
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@Controller('admin/staff')
export class StaffAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get(':id/assets')
  @RequirePermissions(P.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Staff profile tab: assets with this staff member now, and returned ones (by staff id)' })
  @ApiEnvelope(PeopleAssetsDto)
  staffAssets(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.assets.staffAssets(schoolId, id);
  }
}

@ApiTags('Me')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('me/assets')
export class MyAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'School assets allocated to me now (any app)' })
  @ApiEnvelope(MyAssetDto, { isArray: true })
  mine(@CurrentUser() user: AuthUser) {
    return this.assets.myAssets(user);
  }

  @Get('history')
  @ApiOperation({
    summary: 'School assets I held and returned (last 50, newest first; any app)',
    description: 'returned_on and return_condition say when and in what state each one went back to the store.',
  })
  @ApiEnvelope(MyReturnedAssetDto, { isArray: true })
  history(@CurrentUser() user: AuthUser) {
    return this.assets.myAssetHistory(user);
  }

  @Post(':allocationId/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Thank you, marked as received')
  @ApiOperation({ summary: 'Confirm I received an allocated asset' })
  @ApiEnvelope(AllocationDto, { message: 'Thank you, marked as received' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  acknowledge(@CurrentUser() user: AuthUser, @Param('allocationId', ParseIntPipe) id: number) {
    return this.assets.acknowledge(user.school_id ?? 0, id, user, true);
  }
}
