import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString } from 'class-validator';

export class CreateCardDto {
  @ApiProperty()
  @IsString()
  providerToken!: string;

  @ApiProperty()
  @IsString()
  brand!: string;

  @ApiProperty()
  @IsString()
  last4!: string;

  @ApiProperty()
  @IsString()
  holderName!: string;

  @ApiProperty()
  @IsInt()
  expMonth!: number;

  @ApiProperty()
  @IsInt()
  expYear!: number;
}
