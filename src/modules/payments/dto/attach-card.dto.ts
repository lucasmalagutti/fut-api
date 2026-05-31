import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AttachCardDto {
  @ApiProperty({ description: 'Stripe PaymentMethod id (pm_...)' })
  @IsString()
  paymentMethodId!: string;
}
