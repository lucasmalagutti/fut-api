import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class MatchPaymentPreferenceDto {
  @ApiProperty({ enum: ['wallet', 'card'], description: 'Cobrança automática 2h antes do jogo' })
  @IsEnum(['wallet', 'card'])
  preferredPayMethod!: 'wallet' | 'card';

  @ApiPropertyOptional({ description: 'Obrigatório quando preferredPayMethod é card' })
  @ValidateIf((o) => o.preferredPayMethod === 'card')
  @IsUUID()
  preferredCardId?: string;
}
