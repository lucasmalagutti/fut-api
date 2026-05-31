import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { MatchPaymentPreferenceDto } from './match-payment-preference.dto';

export class JoinMatchDto {
  @ApiPropertyOptional({ description: 'Nome do visitante convidado (sem cadastro). O jogador paga a cota de ambos.' })
  @IsOptional()
  @IsString()
  guestName?: string;

  @ApiProperty({ description: 'Forma de pagamento da sua cota (cobrada 2h antes)' })
  @ValidateNested()
  @Type(() => MatchPaymentPreferenceDto)
  payment!: MatchPaymentPreferenceDto;
}
