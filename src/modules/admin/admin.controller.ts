import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('master')
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('users')
  listUsers(@Query() query: any) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id')
  updateUser(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: any) {
    return this.admin.updateUser(actor.id, id, body);
  }

  @Delete('users/:id')
  deleteUser(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.admin.deleteUser(actor.id, id);
  }

  @Get('reports')
  listReports(@Query('status') status?: string) {
    return this.admin.listReports(status);
  }

  @Patch('reports/:id')
  updateReport(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: any) {
    return this.admin.updateReport(id, actor.id, body);
  }

  @Get('dashboard')
  dashboard(@Query('from') from: string, @Query('to') to: string) {
    return this.admin.getDashboard(from, to);
  }

  @Get('settings/fee')
  getFeeRate() {
    return this.admin.getFeeRate();
  }

  @Patch('settings/fee')
  updateFeeRate(@CurrentUser() actor: User, @Body('feeRate') feeRate: number) {
    return this.admin.updateFeeRate(actor.id, feeRate);
  }
}
