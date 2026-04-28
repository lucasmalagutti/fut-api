import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ enum: ['player', 'owner'] })
  @IsEnum(['player', 'owner'])
  role!: 'player' | 'owner';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;
}
