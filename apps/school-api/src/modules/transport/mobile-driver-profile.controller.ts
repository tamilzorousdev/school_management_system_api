import { Body, Controller, Get, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { DRIVER_MODULE_TAGS } from '../mobile/driver-modules.catalog';
import { DriverProfileService } from './driver-profile.service';
import { DriverProfileDto, UpdateDriverProfileDto } from './dto/driver-profile.dto';

@ApiTags(DRIVER_MODULE_TAGS.MODULE_5)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER, ROLES.ATTENDANT)
@Controller('mobile/driver/profile')
export class MobileDriverProfileController {
  constructor(private readonly profile: DriverProfileService) {}

  @Get()
  @ApiOperation({
    summary: 'My profile: details, licence and badge, duty clearance checks, documents and my bus',
    description:
      'me has my details and the checks (licence, badge, medical, police; attendants only medical and police) with expiry, days left and document status. duty_message is one line to show when I am not cleared. vehicle is my bus with its details, seats, documents, road-worthiness and routes (null when I am not on a bus). 404 CREW_NOT_FOUND when the office has not added me yet.',
  })
  @ApiEnvelope(DriverProfileDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@CurrentUser() user: AuthUser) {
    return this.profile.get(user);
  }

  @Patch()
  @ResponseMessage('Profile updated')
  @ApiOperation({
    summary: 'Update my email, language, address, emergency contact and photo',
    description:
      'Send only the fields to change; null clears a field. Name, mobile (the login), licence, badge, medical and police details are kept by the transport office. Upload the photo first with POST /files (purpose profile_photo).',
  })
  @ApiEnvelope(DriverProfileDto, { message: 'Profile updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateDriverProfileDto) {
    return this.profile.update(user, dto);
  }
}
