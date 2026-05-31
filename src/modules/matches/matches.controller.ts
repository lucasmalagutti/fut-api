import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateMatchDto } from './dto/create-match.dto';
import { JoinMatchDto } from './dto/join-match.dto';
import { RespondInviteDto } from './dto/respond-invite.dto';
import { MatchesService } from './matches.service';

@ApiTags('matches')
@ApiBearerAuth()
@Controller('matches')
export class MatchesController {
  constructor(private matches: MatchesService) {}

  // Criar partida a partir de uma reserva
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateMatchDto) {
    return this.matches.create(user, dto);
  }

  // Listar partidas abertas (publicas) — para o jogador ingressar
  @Get('open')
  findOpen(@Query('courtId') courtId?: string, @Query('date') date?: string) {
    return this.matches.findOpen(courtId, date);
  }

  // Minhas partidas
  @Get('mine')
  findMine(@CurrentUser() user: User) {
    return this.matches.findMine(user.id);
  }

  // Detalhes de uma partida
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.matches.findOne(id);
  }

  // Ingressar na partida
  @Post(':id/join')
  join(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: JoinMatchDto) {
    return this.matches.join(id, user, dto);
  }

  // Sair da partida
  @Post(':id/leave')
  leave(@CurrentUser() user: User, @Param('id') id: string) {
    return this.matches.leave(id, user.id);
  }

  // Convidar jogadores
  @Post(':id/invite')
  invite(@CurrentUser() user: User, @Param('id') id: string, @Body('toIds') toIds: string[]) {
    return this.matches.invite(id, user.id, toIds);
  }

  // Responder convite
  @Post(':id/respond')
  respond(@CurrentUser() user: User, @Param('id') matchId: string, @Body() dto: RespondInviteDto) {
    const joinDto: JoinMatchDto | undefined =
      dto.status === 'accepted' && dto.payment
        ? { payment: dto.payment, guestName: dto.guestName }
        : undefined;
    return this.matches.respond(matchId, user.id, dto.inviteId, dto.status, joinDto);
  }

  // Check-in
  @Post(':id/check-in')
  checkIn(@CurrentUser() user: User, @Param('id') id: string) {
    return this.matches.checkIn(id, user.id);
  }

  // Cancelar partida (apenas host, apenas se nao confirmada)
  @Delete(':id')
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.matches.cancel(id, user.id);
  }
}
