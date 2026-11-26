import { ApiProperty } from '@nestjs/swagger';
import { UpdateDriverProfileDto } from '../../transport/dto/driver-profile.dto';
import { BankDetailsDto } from './staff-response.dto';

export class UpdateMyStaffProfileDto extends UpdateDriverProfileDto {}

export class MyStaffProfileDto {
  @ApiProperty({ example: 933 })
  user_id: number;

  @ApiProperty({ example: 'Meena Rajan' })
  name: string;

  @ApiProperty({ example: '9000000013' })
  mobile: string;

  @ApiProperty({ example: 'meena@tzms.edu.in', nullable: true, type: String })
  email: string | null;

  @ApiProperty({ example: 'en' })
  language: string;

  @ApiProperty({ example: 210, nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ nullable: true, type: String, description: 'Signed link to the photo' })
  photo_url: string | null;

  @ApiProperty({ example: 'TZMS-EMP-0331' })
  employee_no: string;

  @ApiProperty({ example: 'non_teaching' })
  staff_type: string;

  @ApiProperty({ example: 'Administrative Officer' })
  designation: string;

  @ApiProperty({ example: 'Office', nullable: true, type: String })
  department: string | null;

  @ApiProperty({ example: 'female', nullable: true, type: String })
  gender: string | null;

  @ApiProperty({ example: '1990-04-12', nullable: true, type: String })
  dob: string | null;

  @ApiProperty({ example: '2026-06-01' })
  joining_date: string;

  @ApiProperty({ example: '12, Gandhi Street, Chennai', nullable: true, type: String })
  address: string | null;

  @ApiProperty({ example: 'Rajan K (husband)', nullable: true, type: String })
  emergency_contact_name: string | null;

  @ApiProperty({ example: '9840012345', nullable: true, type: String })
  emergency_contact_mobile: string | null;

  @ApiProperty({ example: ['Administrative officer'] })
  roles: string[];

  @ApiProperty({
    example: ['photo', 'email', 'language', 'address', 'emergency_contact_name', 'emergency_contact_mobile'],
    description: 'Fields this person can change in the app; everything else only the office changes',
  })
  editable: string[];
}

export class MyBankDto extends BankDetailsDto {}

export class MyBankListDto {
  @ApiProperty({ type: [MyBankDto], description: 'account_no and pan are null here; use reveal to see them' })
  accounts: MyBankDto[];
}
