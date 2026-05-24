import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  holderName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(11)
  document!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  bank!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  agency!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  accountNumber!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  accountType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pixKey?: string;
}
