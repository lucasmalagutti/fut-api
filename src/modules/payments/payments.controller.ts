import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AttachCardDto } from './dto/attach-card.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { ParticipantCheckoutDto } from './dto/participant-checkout.dto';
import { TopUpDto } from './dto/top-up.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('cards/setup-intent')
  setupIntent(@CurrentUser() user: User) {
    return this.payments.createSetupIntent(user);
  }

  @Post('cards/attach')
  attachCard(@CurrentUser() user: User, @Body() dto: AttachCardDto) {
    return this.payments.attachCard(user, dto);
  }

  @Post('cards/test')
  attachTestCard(@CurrentUser() user: User) {
    return this.payments.attachTestCard(user);
  }

  @Post('cards')
  addCard(@CurrentUser() user: User, @Body() dto: CreateCardDto) {
    return this.payments.addCard(user, dto);
  }

  @Get('cards')
  listCards(@CurrentUser() user: User) {
    return this.payments.listCards(user.id);
  }

  @Patch('cards/:id/default')
  setDefault(@CurrentUser() user: User, @Param('id') id: string) {
    return this.payments.setDefaultCard(user.id, id);
  }

  @Delete('cards/:id')
  deleteCard(@CurrentUser() user: User, @Param('id') id: string) {
    return this.payments.deleteCard(user.id, id);
  }

  @Post('wallet/top-up')
  topUp(@CurrentUser() user: User, @Body() dto: TopUpDto) {
    return this.payments.topUpWallet(user, dto);
  }

  @Post('checkout')
  checkout(@CurrentUser() user: User, @Body() dto: CheckoutDto) {
    return this.payments.checkout(user, dto);
  }

  @Post('participants/:participantId/checkout')
  checkoutParticipant(
    @CurrentUser() user: User,
    @Param('participantId') participantId: string,
    @Body() dto: ParticipantCheckoutDto,
  ) {
    return this.payments.checkoutParticipant(user, participantId, dto);
  }

  @Get(':id/status')
  getStatus(@Param('id') id: string) {
    return this.payments.getPaymentStatus(id);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.payments.confirmPayment(id);
  }

  @Public()
  @Post('webhook/stripe')
  stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    return this.payments.handleStripeWebhook(req.rawBody!, sig);
  }
}
