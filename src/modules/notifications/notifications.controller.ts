import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.notifications.findAll(user.id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: User) {
    return this.notifications.markAllRead(user.id);
  }

  @Post('devices')
  registerDevice(
    @CurrentUser() user: User,
    @Body('expoToken') expoToken: string,
    @Body('platform') platform: string,
  ) {
    return this.notifications.registerDevice(user.id, expoToken, platform);
  }
}
