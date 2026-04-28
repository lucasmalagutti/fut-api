import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsString, Max, Min } from 'class-validator';

export class CreateScheduleDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '08:00' })
  @IsString()
  openTime!: string;

  @ApiProperty({ example: '22:00' })
  @IsString()
  closeTime!: string;

  @ApiPropertyOptional({ default: 60 })
  @IsInt()
  slotMinutes: number = 60;

  @ApiProperty()
  @IsNumber()
  basePrice!: number;
}
