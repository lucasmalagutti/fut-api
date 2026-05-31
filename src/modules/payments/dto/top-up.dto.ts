import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class TopUpDto {
  @ApiProperty({ minimum: 5 })
  @IsNumber()
  @Min(5)
  amount!: number;
}
