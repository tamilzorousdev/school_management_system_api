import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MOBILE_PATTERN, normalizeMobile } from '../../../shared/mobile';
import { CrewDetailDto } from '../../crew/dto/crew.dto';
import { VehicleDocumentDto, VehicleDto } from './transport.dto';

const LANGUAGES = ['en', 'ta'] as const;
const notNull = (_dto: object, value: unknown) => value !== null;
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class DriverProfileDto {
  @ApiProperty({
    type: CrewDetailDto,
    description:
      'My details, licence and badge, the checks (licence, badge, medical, police) with expiry and document status, duty status and my documents. Licence and document details are kept by the school office.',
  })
  me: CrewDetailDto;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Medical fitness expired on 10-11-2026. Renew it and give a copy to the transport office.',
    description: 'One line to show when I am not cleared for duty; null when everything is fine',
  })
  duty_message: string | null;

  @ApiProperty({
    type: VehicleDto,
    nullable: true,
    description:
      'The bus I drive or attend: details, seats, documents with expiry, road-worthiness, routes and my co-crew',
  })
  vehicle: VehicleDto | null;

  @ApiProperty({
    type: [VehicleDocumentDto],
    description:
      'The current copy of each paper of my bus (RC, insurance, fitness, permit, PUC…) with number, expiry, verification and the file to open. Empty when I am not on a bus',
  })
  vehicle_documents: VehicleDocumentDto[];
}

export class UpdateDriverProfileDto {
  @ApiPropertyOptional({ example: 'murugan@example.com', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(150)
  email?: string | null;

  @ApiPropertyOptional({ enum: LANGUAGES, description: 'App text and notification language' })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: (typeof LANGUAGES)[number];

  @ApiPropertyOptional({ example: '12, Gandhi Street, Coimbatore', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @Length(5, 255)
  address?: string | null;

  @ApiPropertyOptional({ example: 'Selvi M (wife)', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @Length(2, 120)
  emergency_contact_name?: string | null;

  @ApiPropertyOptional({ example: '9840012345', nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : normalizeMobile(value)))
  @ValidateIf(notNull)
  @Matches(MOBILE_PATTERN, { message: 'emergency_contact_mobile must be a valid 10-digit Indian mobile number' })
  emergency_contact_mobile?: string | null;

  @ApiPropertyOptional({
    example: 210,
    nullable: true,
    type: Number,
    description: 'Profile photo uploaded with POST /files (purpose profile_photo); null removes it',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  photo_file_id?: number | null;
}
