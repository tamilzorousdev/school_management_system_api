import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { DRIVER_MODULE_TAGS } from '../mobile/driver-modules.catalog';
import { DriverRatingsService } from './driver-ratings.service';
import { DriverOwnRatingsDto } from './dto/driver-rating.dto';

@ApiTags(DRIVER_MODULE_TAGS.MODULE_5)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER)
@Controller('mobile/driver/ratings')
export class MobileDriverRatingsController {
  constructor(private readonly ratings: DriverRatingsService) {}

  @Get()
  @ApiOperation({
    summary: 'My parent ratings: average, this month, star counts and most picked chips',
    description:
      'Anonymous: no parent, student or comment is shown. Until the school’s minimum number of ratings is reached, enough is false and only count is filled.',
  })
  @ApiEnvelope(DriverOwnRatingsDto)
  mine(@CurrentUser() user: AuthUser) {
    return this.ratings.ownRatings(user.school_id!, user.id);
  }
}
