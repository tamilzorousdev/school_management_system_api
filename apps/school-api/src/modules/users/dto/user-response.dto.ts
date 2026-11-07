import { ApiProperty } from '@nestjs/swagger';
import { APP_SECTIONS, AppSection, MOBILE_SECTIONS, MobileSection } from '../../access/entities/role.entity';
import { Language, LANGUAGES, USER_STATUSES, UserStatus } from '../entities/user.entity';

export class RoleSummaryDto {
  @ApiProperty({ example: 'TEACHER' })
  code: string;

  @ApiProperty({ example: 'Teacher' })
  name: string;

  @ApiProperty({ enum: APP_SECTIONS, example: 'staff', description: 'Which app or section this role opens' })
  app: AppSection;
}

export class SchoolSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Tamilzorous Model School' })
  name: string;

  @ApiProperty({ example: 'TZMS' })
  code: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Signed link to the school logo; null when the school has none',
  })
  logo_url: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Signed link to the school signature; null when the school has none',
  })
  signature_url: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Signed link to the school seal; null when the school has none',
  })
  seal_url: string | null;
}

export class UserListItemDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Priya Sundaram' })
  name: string;

  @ApiProperty({ example: '9876543210' })
  mobile: string;

  @ApiProperty({ example: 'priya@school.in', nullable: true, type: String })
  email: string | null;

  @ApiProperty({ enum: USER_STATUSES, example: 'active' })
  status: UserStatus;

  @ApiProperty({ enum: LANGUAGES, example: 'en' })
  language: Language;

  @ApiProperty({ example: '2026-11-02T09:15:00.000+05:30', nullable: true, type: String })
  last_login_at: Date | null;

  @ApiProperty({ example: '2026-11-01T10:00:00.000+05:30' })
  created_at: Date;

  @ApiProperty({ type: [RoleSummaryDto] })
  roles: RoleSummaryDto[];
}

export class ProfileSectionDto {
  @ApiProperty({ enum: APP_SECTIONS, example: 'parent' })
  app: AppSection;

  @ApiProperty({ example: 'Parent', description: 'Label for the role switcher' })
  label: string;

  @ApiProperty({ example: false, description: 'true for parent, staff and driver: opens in the mobile app' })
  mobile: boolean;

  @ApiProperty({ type: [RoleSummaryDto] })
  roles: RoleSummaryDto[];
}

export class UserProfileDto extends UserListItemDto {
  @ApiProperty({ type: SchoolSummaryDto, nullable: true })
  school: SchoolSummaryDto | null;

  @ApiProperty({
    enum: APP_SECTIONS,
    isArray: true,
    example: ['staff', 'parent'],
    description: 'Distinct apps this user can open. Show a role picker when there is more than one.',
  })
  apps: AppSection[];

  @ApiProperty({
    enum: MOBILE_SECTIONS,
    isArray: true,
    example: ['parent', 'staff'],
    description:
      'Sections this user can open in the mobile app. One: open it directly. Two or more: show a role switcher; the same token works for all of them.',
  })
  mobile_apps: MobileSection[];

  @ApiProperty({
    type: [ProfileSectionDto],
    description: 'Each section the user can open, with its label and roles, for the profile screen and role switcher',
  })
  sections: ProfileSectionDto[];

  @ApiProperty({ type: [String], example: ['users.view', 'fleet.view'] })
  permissions: string[];

  @ApiProperty({ example: null, nullable: true, type: Number })
  photo_file_id: number | null;
}

export class UserInsightsDto {
  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 40 })
  active: number;

  @ApiProperty({ example: 2 })
  inactive: number;

  @ApiProperty({ example: 6, description: 'Users who have never signed in' })
  never_signed_in: number;

  @ApiProperty({ example: 5, description: 'Users who get the app and messages in Tamil' })
  tamil: number;

  @ApiProperty({ example: { admin: 3, staff: 24, parent: 12, driver: 3 } })
  by_app: Record<AppSection, number>;
}
