import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { MatchPaymentPreferenceDto } from './match-payment-preference.dto';

export class CreateMatchDto {
  @ApiProperty()
  @IsString()
  bookingId!: string;

  @ApiProperty()
  @IsString()
  sport!: string;

  @ApiProperty({ description: 'Minimo de jogadores para confirmar a partida', minimum: 2 })
  @IsInt()
  @Min(2)
  minPlayers!: number;

  @ApiProperty({ description: 'Maximo de vagas (jogadores + visitantes)', maximum: 50 })
  @IsInt()
  @Max(50)
  maxPlayers!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({ description: 'Forma de pagamento da sua cota (cobrada 2h antes)' })
  @ValidateNested()
  @Type(() => MatchPaymentPreferenceDto)
  payment!: MatchPaymentPreferenceDto;
}
