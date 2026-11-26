import { CanteenKitchenController } from './canteen-kitchen.controller';
import { CanteenKitchenService } from './canteen-kitchen.service';
import { CanteenPurchasesController, CanteenSuppliersController } from './canteen-purchase.controller';
import { CanteenPurchaseService } from './canteen-purchase.service';
import { CanteenStockController } from './canteen-stock.controller';
import { CanteenStockService } from './canteen-stock.service';
import { CanteenTablesController } from './canteen-tables.controller';
import { CanteenTablesService } from './canteen-tables.service';
import { CanteenWasteController } from './canteen-waste.controller';
import { CanteenWasteService } from './canteen-waste.service';
import {
  CanteenStockItem,
  CanteenStockMovement,
  CanteenTable,
  KitchenBatch,
  PurchaseLine,
  PurchaseOrder,
  Supplier,
  TableBooking,
  WasteLog,
} from './entities/canteen-supply.entity';

export const SUPPLY_PARTS = {
  entities: [
    CanteenStockItem,
    CanteenStockMovement,
    Supplier,
    PurchaseOrder,
    PurchaseLine,
    KitchenBatch,
    CanteenTable,
    TableBooking,
    WasteLog,
  ],
  controllers: [
    CanteenStockController,
    CanteenSuppliersController,
    CanteenPurchasesController,
    CanteenKitchenController,
    CanteenTablesController,
    CanteenWasteController,
  ],
  providers: [
    CanteenStockService,
    CanteenPurchaseService,
    CanteenKitchenService,
    CanteenTablesService,
    CanteenWasteService,
  ],
};
