import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateBankAccountDto, WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get()
  getWallet(@CurrentUser() user: User) {
    return this.wallet.getWallet(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: User) {
    return this.wallet.getTransactions(user.id);
  }

  @Roles('owner')
  @Post('bank-accounts')
  addBankAccount(@CurrentUser() user: User, @Body() dto: CreateBankAccountDto) {
    return this.wallet.addBankAccount(user.id, dto);
  }

  @Roles('owner')
  @Get('bank-accounts')
  listBankAccounts(@CurrentUser() user: User) {
    return this.wallet.listBankAccounts(user.id);
  }

  @Roles('owner')
  @Post('payouts')
  requestPayout(
    @CurrentUser() user: User,
    @Body('bankAccountId') bankAccountId: string,
    @Body('amount') amount: number,
  ) {
    return this.wallet.requestPayout(user.id, bankAccountId, amount);
  }

  @Roles('owner')
  @Get('payouts')
  listPayouts(@CurrentUser() user: User) {
    return this.wallet.listPayouts(user.id);
  }
}
