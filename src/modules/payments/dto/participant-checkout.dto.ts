import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ParticipantCheckoutDto {
  @ApiProperty({ enum: ['card', 'pix', 'wallet'] })
  @IsEnum(['card', 'pix', 'wallet'])
  method!: 'card' | 'pix' | 'wallet';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cardId?: string;
}
