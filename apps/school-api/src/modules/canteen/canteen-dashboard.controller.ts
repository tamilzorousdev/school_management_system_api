import { Controller, Get, HttpStatus, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions } from '@app/common';
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenDashboardService } from './canteen-dashboard.service';
import { CanteenReportsService } from './canteen-reports.service';
import {
  CanteenDashboardDto,
  CategoriesReportDto,
  DashboardQueryDto,
  DateRangeQueryDto,
  FeedbackReportDto,
  ItemsReportDto,
  PaymentModesReportDto,
  PeakHoursReportDto,
  ProfitSummaryDto,
  PurchasesReportDto,
  SalesReportDto,
  SlotsReportDto,
  StaffReportDto,
  StockReportDto,
  WalletReportDto,
  WasteReportDto,
} from './dto/canteen-reports.dto';

const P = PERMISSIONS;
const RANGE = 'from and to default to the last 30 days; the range can cover at most 366 days.';

@ApiTags('Admin · Canteen dashboard')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/dashboard')
export class CanteenDashboardController {
  constructor(private readonly dashboard: CanteenDashboardService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Canteen dashboard for a day: orders, revenue, tokens, top items, wallet, stock, waste, staff, tables',
    description: 'date defaults to today in the school time zone. Includes the seven days of revenue ending on date.',
  })
  @ApiEnvelope(CanteenDashboardDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  get(@SchoolId() schoolId: number, @Query() query: DashboardQueryDto) {
    return this.dashboard.dashboard(schoolId, query.date);
  }
}

@ApiTags('Admin · Canteen reports')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.BAD_REQUEST)
@Controller('admin/canteen/reports')
export class CanteenReportsController {
  constructor(private readonly reports: CanteenReportsService) {}

  @Get('sales')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Daily sales: orders, revenue, tax, discount, refunds', description: RANGE })
  @ApiEnvelope(SalesReportDto)
  sales(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.sales(schoolId, query.from, query.to);
  }

  @Get('sales/export')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Daily sales as CSV', description: RANGE })
  @ApiFile('text/csv', 'Daily sales')
  async salesExport(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    const file = await this.reports.salesCsv(schoolId, query.from, query.to);
    return new StreamableFile(file.buffer, {
      type: 'text/csv; charset=utf-8',
      length: file.buffer.length,
      disposition: `attachment; filename="${file.name}"`,
    });
  }

  @Get('items')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Top and bottom selling items by quantity and revenue', description: RANGE })
  @ApiEnvelope(ItemsReportDto)
  items(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.items(schoolId, query.from, query.to);
  }

  @Get('categories')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Sales by food category', description: RANGE })
  @ApiEnvelope(CategoriesReportDto)
  categories(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.categories(schoolId, query.from, query.to);
  }

  @Get('payment-modes')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Collections by payment mode, wallet against cash and other', description: RANGE })
  @ApiEnvelope(PaymentModesReportDto)
  paymentModes(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.paymentModes(schoolId, query.from, query.to);
  }

  @Get('slots')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Sales by meal slot', description: RANGE })
  @ApiEnvelope(SlotsReportDto)
  slots(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.slots(schoolId, query.from, query.to);
  }

  @Get('peak-hours')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Orders by hour of the day in the school time zone', description: RANGE })
  @ApiEnvelope(PeakHoursReportDto)
  peakHours(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.peakHours(schoolId, query.from, query.to);
  }

  @Get('wallet')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({
    summary: 'Wallet top-ups, spend, refunds, liability, top spenders and low balance diners',
    description: RANGE,
  })
  @ApiEnvelope(WalletReportDto)
  wallet(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.wallet(schoolId, query.from, query.to);
  }

  @Get('stock')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Stock valuation, low and out of stock items, consumption by item', description: RANGE })
  @ApiEnvelope(StockReportDto)
  stock(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.stock(schoolId, query.from, query.to);
  }

  @Get('purchases')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Purchase spend by supplier and by day', description: RANGE })
  @ApiEnvelope(PurchasesReportDto)
  purchases(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.purchases(schoolId, query.from, query.to);
  }

  @Get('waste')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Waste cost by reason and by item, and as a share of sales', description: RANGE })
  @ApiEnvelope(WasteReportDto)
  waste(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.waste(schoolId, query.from, query.to);
  }

  @Get('staff')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Attendance rate and wage cost per canteen staff member', description: RANGE })
  @ApiEnvelope(StaffReportDto)
  staff(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.staff(schoolId, query.from, query.to);
  }

  @Get('feedback')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({ summary: 'Ratings trend by day and complaint resolution time', description: RANGE })
  @ApiEnvelope(FeedbackReportDto)
  feedback(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.feedback(schoolId, query.from, query.to);
  }

  @Get('profit-summary')
  @RequirePermissions(P.CANTEEN_REPORTS)
  @ApiOperation({
    summary: 'Revenue minus purchases received, waste cost and estimated wages',
    description: RANGE,
  })
  @ApiEnvelope(ProfitSummaryDto)
  profitSummary(@SchoolId() schoolId: number, @Query() query: DateRangeQueryDto) {
    return this.reports.profit(schoolId, query.from, query.to);
  }
}
