import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class JoinMatchDto {
  @ApiPropertyOptional({ description: 'Nome do visitante convidado (sem cadastro). O jogador paga a cota de ambos.' })
  @IsOptional()
  @IsString()
  guestName?: string;
}
