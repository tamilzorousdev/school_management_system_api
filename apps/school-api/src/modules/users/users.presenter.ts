import { UserAccess } from '../access/access.service';
import { MOBILE_SECTIONS, MobileSection, SECTION_LABELS } from '../access/entities/role.entity';
import { RoleSummaryDto, UserListItemDto, UserProfileDto } from './dto/user-response.dto';

export function toRoleSummaries(access: UserAccess): RoleSummaryDto[] {
  return access.roles.map((role) => ({ code: role.code, name: role.name, app: role.app }));
}

export function toUserListItem(access: UserAccess): UserListItemDto {
  const { user } = access;
  return {
    id: user.id,
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    status: user.status,
    language: user.language,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    roles: toRoleSummaries(access),
  };
}

export function toUserProfile(
  access: UserAccess,
  logoUrl: string | null = null,
  signatureUrl: string | null = null,
  sealUrl: string | null = null,
): UserProfileDto {
  const { user } = access;
  return {
    ...toUserListItem(access),
    school: user.school
      ? {
          id: user.school.id,
          name: user.school.name,
          code: user.school.code,
          logo_url: logoUrl,
          signature_url: signatureUrl,
          seal_url: sealUrl,
        }
      : null,
    apps: access.apps,
    mobile_apps: MOBILE_SECTIONS.filter((section) => access.apps.includes(section)) as MobileSection[],
    sections: access.apps.map((app) => ({
      app,
      label: SECTION_LABELS[app],
      mobile: (MOBILE_SECTIONS as readonly string[]).includes(app),
      roles: toRoleSummaries(access).filter((role) => role.app === app),
    })),
    permissions: access.permissions,
    photo_file_id: user.photo_file_id,
  };
}
