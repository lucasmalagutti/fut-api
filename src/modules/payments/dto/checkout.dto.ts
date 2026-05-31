import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CheckoutDto {
  @ApiProperty()
  @IsString()
  bookingId!: string;

  @ApiProperty({ enum: ['card', 'pix', 'wallet'] })
  @IsEnum(['card', 'pix', 'wallet'])
  method!: 'card' | 'pix' | 'wallet';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cardId?: string;
}
