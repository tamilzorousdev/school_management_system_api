import { ApiProperty } from '@nestjs/swagger';
import { IsDateOnly } from '../../../shared/dates';
import { MEAL_SLOTS } from '../entities/canteen-menu.entity';
import { CANTEEN_STAFF_ROLES } from '../entities/canteen-people.entity';
import { CountByDto } from './canteen-people.dto';

export class DateRangeQueryDto {
  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-06-30', true) to?: string;
}

export class DashboardQueryDto {
  @IsDateOnly('2026-06-30', true) date?: string;
}

export class DashboardOrdersDto {
  @ApiProperty({ example: 120, description: 'All orders of the day' }) total: number;
  @ApiProperty({ example: 4 }) placed: number;
  @ApiProperty({ example: 6 }) preparing: number;
  @ApiProperty({ example: 3 }) ready: number;
  @ApiProperty({ example: 100 }) served: number;
  @ApiProperty({ example: 7 }) cancelled: number;
}

export class DashboardSalesDto {
  @ApiProperty({ example: 8450.5, description: 'Paid orders that are not cancelled' }) revenue: number;
  @ApiProperty({ example: 74.1 }) average_order_value: number;
  @ApiProperty({ example: 640, description: 'Total of live orders not yet paid' }) unpaid_amount: number;
}

export class DashboardTopItemDto {
  @ApiProperty({ example: 'Veg Biryani' }) name: string;
  @ApiProperty({ example: 42 }) quantity: number;
  @ApiProperty({ example: 2100 }) revenue: number;
}

export class DashboardSlotDto {
  @ApiProperty({ enum: [...MEAL_SLOTS, 'unspecified'], example: 'lunch' }) slot: string;
  @ApiProperty({ example: 60 }) orders: number;
  @ApiProperty({ example: 4200 }) revenue: number;
}

export class DashboardWalletDto {
  @ApiProperty({ example: 152000, description: 'Money held in diner wallets' }) liability: number;
  @ApiProperty({ example: 9500 }) topups_today: number;
  @ApiProperty({ example: 14, description: 'Active diners below the low balance limit' }) low_balance_diners: number;
}

export class DashboardStockDto {
  @ApiProperty({ example: 5, description: 'Items at or below the reorder level, including out of stock' })
  low_or_out_items: number;
  @ApiProperty({ example: 2 }) out_of_stock_items: number;
  @ApiProperty({ example: 3, description: 'Items expiring within 7 days' }) expiring_items: number;
}

export class DashboardStaffDto {
  @ApiProperty({ example: 8 }) total: number;
  @ApiProperty({ example: 6, description: 'Present or half day' }) present: number;
  @ApiProperty({ example: 1 }) absent: number;
  @ApiProperty({ example: 1, description: 'Active staff with no mark yet' }) unmarked: number;
}

export class DashboardDayDto {
  @ApiProperty({ example: '2026-06-30' }) date: string;
  @ApiProperty({ example: 8450.5 }) revenue: number;
  @ApiProperty({ example: 110 }) orders: number;
}

export class CanteenDashboardDto {
  @ApiProperty({ example: '2026-06-30' }) date: string;
  @ApiProperty({ type: DashboardOrdersDto }) orders: DashboardOrdersDto;
  @ApiProperty({ type: DashboardSalesDto }) sales: DashboardSalesDto;
  @ApiProperty({ example: 13, description: 'Orders placed, preparing or ready but not served' }) tokens_waiting: number;
  @ApiProperty({ type: [DashboardTopItemDto] }) top_items: DashboardTopItemDto[];
  @ApiProperty({ type: [DashboardSlotDto] }) sales_by_slot: DashboardSlotDto[];
  @ApiProperty({ type: DashboardWalletDto }) wallet: DashboardWalletDto;
  @ApiProperty({ type: DashboardStockDto }) stock: DashboardStockDto;
  @ApiProperty({ example: 320.5 }) waste_cost: number;
  @ApiProperty({ example: 2, description: 'Complaints that are open or in progress' }) open_complaints: number;
  @ApiProperty({ type: DashboardStaffDto }) staff: DashboardStaffDto;
  @ApiProperty({ example: 4 }) tables_occupied: number;
  @ApiProperty({ type: [DashboardDayDto], description: 'Seven days ending on the date, oldest first' })
  revenue_last_7_days: DashboardDayDto[];
}

export class SalesDayDto {
  @ApiProperty({ example: '2026-06-30' }) date: string;
  @ApiProperty({ example: 110 }) orders: number;
  @ApiProperty({ example: 8450.5 }) revenue: number;
  @ApiProperty({ example: 420 }) tax: number;
  @ApiProperty({ example: 50 }) discount: number;
  @ApiProperty({ example: 120 }) refunds: number;
}

export class SalesReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ type: SalesDayDto, description: 'Totals over the range, date is the range end' }) totals: SalesDayDto;
  @ApiProperty({ type: [SalesDayDto] }) daily: SalesDayDto[];
}

export class ItemSalesRowDto {
  @ApiProperty({ example: 4, nullable: true, type: Number }) food_item_id: number | null;
  @ApiProperty({ example: 'Veg Biryani' }) name: string;
  @ApiProperty({ example: 'Main course' }) category: string;
  @ApiProperty({ example: 420 }) quantity: number;
  @ApiProperty({ example: 21000 }) revenue: number;
}

export class ItemsReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ type: [ItemSalesRowDto] }) top_by_quantity: ItemSalesRowDto[];
  @ApiProperty({ type: [ItemSalesRowDto] }) top_by_revenue: ItemSalesRowDto[];
  @ApiProperty({ type: [ItemSalesRowDto], description: 'Slowest sellers that sold at least once' })
  bottom_by_quantity: ItemSalesRowDto[];
}

export class CategorySalesRowDto {
  @ApiProperty({ example: 'Main course' }) category: string;
  @ApiProperty({ example: 820 }) quantity: number;
  @ApiProperty({ example: 41000 }) revenue: number;
  @ApiProperty({ example: 48.5 }) share_percent: number;
}

export class CategoriesReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ type: [CategorySalesRowDto] }) rows: CategorySalesRowDto[];
}

export class PaymentModeRowDto {
  @ApiProperty({ example: 'wallet' }) mode: string;
  @ApiProperty({ example: 320 }) payments: number;
  @ApiProperty({ example: 40000 }) collected: number;
  @ApiProperty({ example: 500 }) refunded: number;
  @ApiProperty({ example: 39500 }) net: number;
  @ApiProperty({ example: 62.5 }) share_percent: number;
}

export class WalletVsCashDto {
  @ApiProperty({ example: 39500 }) wallet: number;
  @ApiProperty({ example: 21000, description: 'Cash, UPI and card together' }) cash_and_other: number;
}

export class PaymentModesReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ type: [PaymentModeRowDto] }) rows: PaymentModeRowDto[];
  @ApiProperty({ type: WalletVsCashDto }) wallet_vs_cash: WalletVsCashDto;
}

export class SlotRowDto {
  @ApiProperty({ example: 'lunch' }) slot: string;
  @ApiProperty({ example: 600 }) orders: number;
  @ApiProperty({ example: 42000 }) revenue: number;
  @ApiProperty({ example: 70 }) average_order_value: number;
}

export class SlotsReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ type: [SlotRowDto] }) rows: SlotRowDto[];
}

export class HourRowDto {
  @ApiProperty({ example: 13, minimum: 0, maximum: 23 }) hour: number;
  @ApiProperty({ example: 85 }) orders: number;
  @ApiProperty({ example: 6200 }) revenue: number;
}

export class PeakHoursReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 13, nullable: true, type: Number, description: 'Busiest hour, null with no orders' })
  peak_hour: number | null;
  @ApiProperty({ type: [HourRowDto], description: 'All 24 hours' }) rows: HourRowDto[];
}

export class WalletPersonRowDto {
  @ApiProperty({ example: 7 }) diner_id: number;
  @ApiProperty({ example: 'CN-0007' }) card_no: string;
  @ApiProperty({ example: 'Aarav Kumar' }) name: string;
  @ApiProperty({ example: 4200, description: 'Spent in the range, or the balance for the low balance list' })
  amount: number;
}

export class WalletReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 85000 }) topups: number;
  @ApiProperty({ example: 61000 }) spend: number;
  @ApiProperty({ example: 1500 }) refunds: number;
  @ApiProperty({ example: 152000 }) liability: number;
  @ApiProperty({ type: [WalletPersonRowDto] }) top_spenders: WalletPersonRowDto[];
  @ApiProperty({ type: [WalletPersonRowDto] }) low_balance: WalletPersonRowDto[];
}

export class StockValuationRowDto {
  @ApiProperty({ example: 3 }) stock_item_id: number;
  @ApiProperty({ example: 'Basmati rice' }) name: string;
  @ApiProperty({ example: 'kg' }) unit: string;
  @ApiProperty({ example: 12.5 }) quantity_on_hand: number;
  @ApiProperty({ example: 20 }) reorder_level: number;
  @ApiProperty({ example: 90 }) cost_per_unit: number;
  @ApiProperty({ example: 1125 }) value: number;
  @ApiProperty({ enum: ['out', 'low', 'ok'], example: 'low' }) status: string;
}

export class StockConsumptionRowDto {
  @ApiProperty({ example: 3 }) stock_item_id: number;
  @ApiProperty({ example: 'Basmati rice' }) name: string;
  @ApiProperty({ example: 'kg' }) unit: string;
  @ApiProperty({ example: 80 }) issued: number;
  @ApiProperty({ example: 2 }) wasted: number;
  @ApiProperty({ example: 7380 }) cost: number;
}

export class StockReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 48200 }) valuation: number;
  @ApiProperty({ example: 4 }) low_items: number;
  @ApiProperty({ example: 2 }) out_items: number;
  @ApiProperty({ type: [StockValuationRowDto], description: 'Low and out of stock items' })
  attention_items: StockValuationRowDto[];
  @ApiProperty({ type: [StockConsumptionRowDto] }) consumption: StockConsumptionRowDto[];
}

export class PurchaseSupplierRowDto {
  @ApiProperty({ example: 2 }) supplier_id: number;
  @ApiProperty({ example: 'Fresh Foods' }) name: string;
  @ApiProperty({ example: 6 }) orders: number;
  @ApiProperty({ example: 38000 }) spend: number;
}

export class PurchaseDayRowDto {
  @ApiProperty({ example: '2026-06-12' }) date: string;
  @ApiProperty({ example: 2 }) orders: number;
  @ApiProperty({ example: 9000 }) spend: number;
}

export class PurchasesReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 38000, description: 'Value of goods received in the range' }) total_spend: number;
  @ApiProperty({ type: [PurchaseSupplierRowDto] }) by_supplier: PurchaseSupplierRowDto[];
  @ApiProperty({ type: [PurchaseDayRowDto] }) by_day: PurchaseDayRowDto[];
}

export class WasteReasonRowDto {
  @ApiProperty({ example: 'leftover' }) reason: string;
  @ApiProperty({ example: 9 }) entries: number;
  @ApiProperty({ example: 1200 }) cost: number;
}

export class WasteItemRowDto {
  @ApiProperty({ example: 'Rice' }) item_name: string;
  @ApiProperty({ example: 14.5 }) quantity: number;
  @ApiProperty({ example: 900 }) cost: number;
}

export class WasteReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 2400 }) total_cost: number;
  @ApiProperty({ example: 2.84, description: 'Waste cost as % of revenue' }) waste_percent_of_sales: number;
  @ApiProperty({ type: [WasteReasonRowDto] }) by_reason: WasteReasonRowDto[];
  @ApiProperty({ type: [WasteItemRowDto] }) by_item: WasteItemRowDto[];
}

export class StaffReportRowDto {
  @ApiProperty({ example: 1 }) canteen_staff_id: number;
  @ApiProperty({ example: 'Meena Devi' }) name: string;
  @ApiProperty({ enum: CANTEEN_STAFF_ROLES, example: 'cook' }) role: string;
  @ApiProperty({ example: 22 }) present: number;
  @ApiProperty({ example: 2 }) half_day: number;
  @ApiProperty({ example: 1 }) absent: number;
  @ApiProperty({ example: 1 }) leave: number;
  @ApiProperty({ example: 88.46 }) attendance_rate: number;
  @ApiProperty({ example: 15275 }) wage_cost: number;
}

export class StaffReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 92000 }) wage_cost: number;
  @ApiProperty({ type: [StaffReportRowDto] }) rows: StaffReportRowDto[];
}

export class RatingTrendRowDto {
  @ApiProperty({ example: '2026-06-12' }) date: string;
  @ApiProperty({ example: 5 }) count: number;
  @ApiProperty({ example: 4.2, nullable: true, type: Number }) average_rating: number | null;
}

export class ComplaintResolutionDto {
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 9 }) resolved: number;
  @ApiProperty({ example: 3 }) unresolved: number;
  @ApiProperty({ example: 18.5, nullable: true, type: Number }) average_resolution_hours: number | null;
}

export class FeedbackReportDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 4.1, nullable: true, type: Number }) average_rating: number | null;
  @ApiProperty({ type: [RatingTrendRowDto] }) ratings_trend: RatingTrendRowDto[];
  @ApiProperty({ type: ComplaintResolutionDto }) complaints: ComplaintResolutionDto;
  @ApiProperty({ type: [CountByDto], description: 'Feedback and complaints per category' })
  by_category: CountByDto[];
}

export class ProfitSummaryDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 250000 }) revenue: number;
  @ApiProperty({ example: 120000, description: 'Value of goods received' }) purchases: number;
  @ApiProperty({ example: 2400 }) waste: number;
  @ApiProperty({ example: 92000, description: 'Estimated from attendance and daily wages' }) wages: number;
  @ApiProperty({ example: 35600, description: 'revenue - purchases - waste - wages' }) profit: number;
}
