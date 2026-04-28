import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('cards')
  addCard(@CurrentUser() user: User, @Body() dto: CreateCardDto) {
    return this.payments.addCard(user, dto);
  }

  @Get('cards')
  listCards(@CurrentUser() user: User) {
    return this.payments.listCards(user.id);
  }

  @Delete('cards/:id')
  deleteCard(@CurrentUser() user: User, @Param('id') id: string) {
    return this.payments.deleteCard(user.id, id);
  }

  @Post('checkout')
  checkout(@CurrentUser() user: User, @Body() dto: CheckoutDto) {
    return this.payments.checkout(user, dto);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.payments.confirmPayment(id);
  }
}
