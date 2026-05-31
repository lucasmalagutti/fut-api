import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class RequestPayoutDto {
  @ApiProperty()
  @IsUUID()
  bankAccountId!: string;

  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  amount!: number;
}
