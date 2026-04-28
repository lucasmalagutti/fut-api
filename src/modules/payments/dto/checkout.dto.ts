import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CheckoutDto {
  @ApiProperty()
  @IsString()
  bookingId!: string;

  @ApiProperty({ enum: ['card', 'pix'] })
  @IsEnum(['card', 'pix'])
  method!: 'card' | 'pix';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cardId?: string;
}
