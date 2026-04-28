import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateMatchDto } from './dto/create-match.dto';
import { MatchesService } from './matches.service';

@ApiTags('matches')
@ApiBearerAuth()
@Controller('matches')
export class MatchesController {
  constructor(private matches: MatchesService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateMatchDto) {
    return this.matches.create(user, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.matches.findOne(id);
  }

  @Post(':id/invite')
  invite(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body('toIds') toIds: string[],
  ) {
    return this.matches.invite(id, user.id, toIds);
  }

  @Post(':id/respond')
  respond(
    @CurrentUser() user: User,
    @Param('id') matchId: string,
    @Body('inviteId') inviteId: string,
    @Body('status') status: 'accepted' | 'declined',
  ) {
    return this.matches.respond(matchId, user.id, inviteId, status);
  }

  @Post(':id/check-in')
  checkIn(@CurrentUser() user: User, @Param('id') id: string) {
    return this.matches.checkIn(id, user.id);
  }

  @Post(':id/leave')
  leave(@CurrentUser() user: User, @Param('id') id: string) {
    return this.matches.leave(id, user.id);
  }
}
