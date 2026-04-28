import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() query: any) {
    return this.bookings.findMine(user.id, user.role, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.bookings.findOne(user.id, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.bookings.cancel(user.id, id, reason);
  }

  @Post(':id/review')
  review(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CreateReviewDto) {
    return this.bookings.createReview(user.id, id, dto);
  }
}
