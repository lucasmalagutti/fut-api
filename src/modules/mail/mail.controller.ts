import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { IsEmail, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MailService } from './mail.service';

class SendTestMailDto {
  @IsOptional()
  @IsEmail()
  to?: string;
}

@ApiTags('mail')
@ApiBearerAuth()
@Controller('mail')
export class MailController {
  constructor(private mail: MailService) {}

  @Post('test')
  sendTest(@CurrentUser() user: User, @Body() dto: SendTestMailDto) {
    return this.mail.sendTest(dto.to ?? user.email);
  }
}
