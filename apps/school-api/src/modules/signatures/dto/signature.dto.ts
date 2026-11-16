import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, ValidateIf } from 'class-validator';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  SIGNATURE_ACTIONS,
  SIGNATURE_SIDES,
  SignatureAction,
  SignatureSide,
} from '../entities/signature-change.entity';

export class SetSignatureDto {
  @ApiPropertyOptional({
    example: 140,
    nullable: true,
    type: Number,
    description: 'A file uploaded with purpose signature_pad (drawn) or signature (photo). null removes it.',
  })
  @IsOptional()
  @ValidateIf((dto: SetSignatureDto) => dto.signature_file_id !== null)
  @IsInt()
  signature_file_id?: number | null;
}

export class SignatureSavedDto {
  @ApiProperty({ example: 140, nullable: true, type: Number })
  signature_file_id: number | null;

  @ApiProperty({ example: 'https://...', nullable: true, type: String })
  signature_url: string | null;

  @ApiProperty({ description: 'A teacher who is also a parent: the first signature was copied to the Parent app' })
  parent_signature_copied: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'This signature is also set for your Parent app. You can change it there anytime.',
    description: 'Show this short note when present',
  })
  message: string | null;
}

export class SignatureChangeDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ enum: SIGNATURE_SIDES })
  side: SignatureSide;

  @ApiProperty({ enum: SIGNATURE_ACTIONS })
  action: SignatureAction;

  @ApiProperty({ nullable: true, type: String, description: 'The signature before this change' })
  old_url: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'The signature after this change' })
  new_url: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  changed_by: RefDto | null;

  @ApiProperty({ description: 'Done by the school office, not the person' })
  by_admin: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'Copied from the teacher signature' })
  note: string | null;

  @ApiProperty()
  at: Date;

  @ApiProperty({
    description:
      'This row has a signature image that is not the current one; POST .../signature/history/{id}/use makes it current again',
  })
  can_use_again: boolean;
}

export class SignatureDetailDto {
  @ApiProperty({ enum: SIGNATURE_SIDES })
  side: SignatureSide;

  @ApiProperty({ type: RefDto, description: 'Whose signature (staff or parent)' })
  owner: RefDto;

  @ApiProperty({ nullable: true, type: Number })
  signature_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  signature_url: string | null;

  @ApiProperty({ nullable: true, type: Date, description: 'When it was last added, changed or removed' })
  updated_at: Date | null;

  @ApiProperty({ type: [SignatureChangeDto], description: 'Newest first' })
  history: SignatureChangeDto[];
}
