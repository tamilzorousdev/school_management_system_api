import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenWalletService } from './canteen-wallet.service';
import {
  LowBalanceDto,
  LowBalanceQueryDto,
  TopupDto,
  WalletAdjustmentDto,
  WalletRefundDto,
  WalletResultDto,
  WalletSummaryDto,
  WalletTransactionDto,
  WalletTransactionQueryDto,
} from './dto/canteen-sales.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen wallet')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/wallet')
export class CanteenWalletController {
  constructor(private readonly wallet: CanteenWalletService) {}

  @Get('summary')
  @RequirePermissions(P.CANTEEN_WALLET)
  @ApiOperation({ summary: 'Wallet liability, top-ups and spend today, diners and low balances' })
  @ApiEnvelope(WalletSummaryDto)
  summary(@SchoolId() schoolId: number) {
    return this.wallet.summary(schoolId);
  }

  @Get('low-balance')
  @RequirePermissions(P.CANTEEN_WALLET)
  @ApiOperation({ summary: 'Active diners whose balance is at or below the low balance limit' })
  @ApiEnvelope(LowBalanceDto, { paginated: true })
  lowBalance(@SchoolId() schoolId: number, @Query() query: LowBalanceQueryDto) {
    return this.wallet.lowBalance(schoolId, query);
  }

  @Post('topup')
  @RequirePermissions(P.CANTEEN_WALLET)
  @ResponseMessage('Wallet topped up')
  @ApiOperation({ summary: 'Add money to a diner wallet (advance payment)' })
  @ApiEnvelope(WalletResultDto, { status: HttpStatus.CREATED, message: 'Wallet topped up' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  topup(@SchoolId() schoolId: number, @Body() dto: TopupDto, @CurrentUser() actor: AuthUser) {
    return this.wallet.topup(schoolId, dto, actor);
  }

  @Post('refund')
  @RequirePermissions(P.CANTEEN_WALLET)
  @ResponseMessage('Refunded to wallet')
  @ApiOperation({ summary: 'Refund an amount to a diner wallet' })
  @ApiEnvelope(WalletResultDto, { status: HttpStatus.CREATED, message: 'Refunded to wallet' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  refund(@SchoolId() schoolId: number, @Body() dto: WalletRefundDto, @CurrentUser() actor: AuthUser) {
    return this.wallet.refund(schoolId, dto, actor);
  }

  @Post('adjustment')
  @RequirePermissions(P.CANTEEN_WALLET)
  @ResponseMessage('Wallet adjusted')
  @ApiOperation({ summary: 'Correct a wallet balance with a signed amount and a mandatory note' })
  @ApiEnvelope(WalletResultDto, { status: HttpStatus.CREATED, message: 'Wallet adjusted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  adjustment(@SchoolId() schoolId: number, @Body() dto: WalletAdjustmentDto, @CurrentUser() actor: AuthUser) {
    return this.wallet.adjustment(schoolId, dto, actor);
  }

  @Get(':diner_id/transactions')
  @RequirePermissions(P.CANTEEN_WALLET)
  @ApiOperation({ summary: 'Wallet statement of one diner, newest first' })
  @ApiEnvelope(WalletTransactionDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  transactions(
    @SchoolId() schoolId: number,
    @Param('diner_id', ParseIntPipe) dinerId: number,
    @Query() query: WalletTransactionQueryDto,
  ) {
    return this.wallet.history(schoolId, dinerId, query);
  }
}
