import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateReportDto) {
    return this.reports.create(user.id, dto);
  }

  @Get('mine')
  findMine(@CurrentUser() user: User) {
    return this.reports.findMine(user.id);
  }
}
