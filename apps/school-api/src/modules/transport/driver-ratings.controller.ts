import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { DriverRatingsService } from './driver-ratings.service';
import {
  DriverRatingDto,
  DriverRatingInsightsDto,
  DriverRatingQueryDto,
  DriverRatingSummaryDto,
} from './dto/driver-rating.dto';

@ApiTags('Admin · Transport')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/transport/driver-ratings')
export class DriverRatingsController {
  constructor(private readonly ratings: DriverRatingsService) {}

  @Get('insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Rating cards: average, total, this month, low ratings this month, drivers rated' })
  @ApiEnvelope(DriverRatingInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.ratings.insights(schoolId);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Each driver with average stars, this month, low ratings, 1–5 star counts and most picked chips',
    description: 'Every driver of an active bus is listed, even before the first rating. Lowest average first.',
  })
  @ApiEnvelope(DriverRatingSummaryDto, { isArray: true })
  summary(@SchoolId() schoolId: number) {
    return this.ratings.summary(schoolId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Parent ratings of drivers, newest first',
    description:
      'search: driver, parent or student name, or the comment. Filters: driver_user_id, vehicle_id, rating, low (1 and 2 stars), from, to. sort: updated_at, created_at, rating.',
  })
  @ApiEnvelope(DriverRatingDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: DriverRatingQueryDto) {
    return this.ratings.list(schoolId, query);
  }
}
