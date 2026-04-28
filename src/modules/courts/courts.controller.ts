import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { diskStorage } from 'multer';
import * as path from 'path';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateBlockDto } from './dto/create-block.dto';
import { CreateCourtDto } from './dto/create-court.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { CourtsService } from './courts.service';

@ApiTags('courts')
@ApiBearerAuth()
@Controller('courts')
export class CourtsController {
  constructor(private courts: CourtsService) {}

  @Roles('owner')
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateCourtDto) {
    return this.courts.create(user, dto);
  }

  @Get()
  findAll(@Query() query: any) {
    return this.courts.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.courts.findOne(id);
  }

  @Roles('owner')
  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateCourtDto) {
    return this.courts.update(user, id, dto);
  }

  @Roles('owner')
  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.courts.remove(user, id);
  }

  @Roles('owner')
  @ApiConsumes('multipart/form-data')
  @Post(':id/photos')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './storage/courts',
        filename: (_req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
      }),
    }),
  )
  addPhoto(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('position') position: string,
  ) {
    const url = `/storage/courts/${file.filename}`;
    return this.courts.addPhoto(user, id, url, parseInt(position ?? '0'));
  }

  @Get(':id/availability')
  availability(@Param('id') id: string, @Query('date') date: string) {
    return this.courts.getAvailability(id, date);
  }

  @Roles('owner')
  @Post(':id/schedules')
  addSchedule(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CreateScheduleDto) {
    return this.courts.addSchedule(user, id, dto);
  }

  @Roles('owner')
  @Post(':id/blocks')
  addBlock(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CreateBlockDto) {
    return this.courts.addBlock(user, id, dto);
  }

  @Get(':id/reviews')
  getReviews(@Param('id') id: string) {
    return this.courts.getReviews(id);
  }
}
