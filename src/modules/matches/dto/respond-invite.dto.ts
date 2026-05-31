import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { JoinMatchDto } from './join-match.dto';
import { MatchPaymentPreferenceDto } from './match-payment-preference.dto';

export class RespondInviteDto {
  @ApiProperty()
  @IsString()
  inviteId!: string;

  @ApiProperty({ enum: ['accepted', 'declined'] })
  @IsEnum(['accepted', 'declined'])
  status!: 'accepted' | 'declined';

  @ApiPropertyOptional()
  @ValidateIf((o) => o.status === 'accepted')
  @ValidateNested()
  @Type(() => MatchPaymentPreferenceDto)
  payment?: MatchPaymentPreferenceDto;

  @ApiPropertyOptional()
  @IsString()
  @ValidateIf((o) => o.status === 'accepted')
  guestName?: string;
}
