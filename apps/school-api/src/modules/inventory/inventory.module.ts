import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetsService } from './assets.service';
import {
  Asset,
  AssetAllocation,
  AssetDisposal,
  AssetEvent,
  AssetTransfer,
  AssetTransferItem,
} from './entities/asset.entity';
import {
  Department,
  InventoryCategory,
  InventoryLocation,
  InventorySettings,
  InventoryStore,
  InventoryVendor,
} from './entities/master.entity';
import {
  AssetAuditItem,
  InventoryAudit,
  AssetMaintenanceSchedule,
  AssetMaintenanceTicket,
  Requisition,
  RequisitionLine,
  StockBalance,
  StockCountLine,
  StockItem,
  StockMovement,
  StockReceipt,
  StockReceiptLine,
} from './entities/operations.entity';
import { InventoryAlertsService } from './inventory-alerts.service';
import { InventoryAuditsService } from './inventory-audits.service';
import {
  InventoryAssetsController,
  InventoryMastersController,
  InventoryOperationsController,
  MyAssetsController,
  StaffAssetsController,
} from './inventory.controller';
import { InventoryMastersService } from './inventory-masters.service';
import { InventoryNotifyService } from './inventory-notify.service';
import { InventoryReadService } from './inventory-read.service';
import { InventoryReportsService } from './inventory-reports.service';
import { MaintenanceService } from './maintenance.service';
import { StockService } from './stock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventorySettings,
      InventoryCategory,
      InventoryLocation,
      Department,
      InventoryVendor,
      InventoryStore,
      Asset,
      AssetAllocation,
      AssetTransfer,
      AssetTransferItem,
      AssetEvent,
      AssetDisposal,
      AssetMaintenanceTicket,
      AssetMaintenanceSchedule,
      StockItem,
      StockBalance,
      StockMovement,
      StockReceipt,
      StockReceiptLine,
      Requisition,
      RequisitionLine,
      InventoryAudit,
      AssetAuditItem,
      StockCountLine,
    ]),
  ],
  controllers: [
    InventoryMastersController,
    InventoryAssetsController,
    InventoryOperationsController,
    StaffAssetsController,
    MyAssetsController,
  ],
  providers: [
    InventoryReadService,
    InventoryNotifyService,
    InventoryMastersService,
    AssetsService,
    MaintenanceService,
    StockService,
    InventoryAuditsService,
    InventoryReportsService,
    InventoryAlertsService,
  ],
  exports: [AssetsService],
})
export class InventoryModule {}
