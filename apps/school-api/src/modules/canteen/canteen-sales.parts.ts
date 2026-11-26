import { CanteenBillingController } from './canteen-billing.controller';
import { CanteenBillingService } from './canteen-billing.service';
import { CanteenDinersController } from './canteen-diners.controller';
import { CanteenDinersService } from './canteen-diners.service';
import { CanteenOrdersController } from './canteen-orders.controller';
import { CanteenOrdersService } from './canteen-orders.service';
import { CanteenWalletController } from './canteen-wallet.controller';
import { CanteenWalletService } from './canteen-wallet.service';
import {
  CanteenDiner,
  CanteenOrder,
  CanteenOrderItem,
  CanteenPayment,
  WalletTransaction,
} from './entities/canteen-sales.entity';

export const SALES_PARTS = {
  entities: [CanteenDiner, WalletTransaction, CanteenOrder, CanteenOrderItem, CanteenPayment],
  controllers: [CanteenDinersController, CanteenWalletController, CanteenOrdersController, CanteenBillingController],
  providers: [CanteenDinersService, CanteenWalletService, CanteenOrdersService, CanteenBillingService],
};
