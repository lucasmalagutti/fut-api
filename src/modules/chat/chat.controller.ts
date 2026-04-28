import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private chat: ChatService) {}

  @Get('threads')
  listThreads(@CurrentUser() user: User) {
    return this.chat.listThreads(user.id);
  }

  @Get('threads/:id/messages')
  getMessages(@CurrentUser() user: User, @Param('id') id: string) {
    return this.chat.getMessages(id, user.id);
  }

  @Post('threads/:id/messages')
  sendMessage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body('body') body: string,
  ) {
    return this.chat.sendMessage(id, user.id, body);
  }

  @Post('threads/start')
  startThread(@CurrentUser() user: User, @Body('targetUserId') targetUserId: string) {
    return this.chat.getOrCreateThread(user.id, targetUserId);
  }
}
