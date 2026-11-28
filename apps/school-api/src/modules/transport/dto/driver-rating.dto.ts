import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { RATING_TAGS, RatingTag } from '../entities/driver-rating.entity';

export class RatingTagDto {
  @ApiProperty({ enum: RATING_TAGS, example: 'safe_driving' })
  code: RatingTag;

  @ApiProperty({ example: 'Safe driving' })
  label: string;

  @ApiProperty({ example: true, description: 'false for a complaint (rash driving, rude …)' })
  positive: boolean;
}

export class RatedDriverDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ example: 'Murugan K' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

export class RatedBusDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'TN 09 AB 1234' })
  registration_no: string;

  @ApiProperty({ example: 'Bus 1' })
  name: string;
}

export class MyDriverRatingDto {
  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  rating: number;

  @ApiProperty({ enum: RATING_TAGS, isArray: true, example: ['safe_driving', 'on_time'] })
  tags: RatingTag[];

  @ApiProperty({ nullable: true, type: String, example: 'Always waits until my son is seated.' })
  comment: string | null;

  @ApiProperty()
  updated_at: Date;
}

export class ParentDriverRatingDto {
  @ApiProperty({ type: RatedDriverDto, nullable: true, description: 'null when the bus has no driver yet' })
  driver: RatedDriverDto | null;

  @ApiProperty({ type: RatedBusDto, nullable: true })
  vehicle: RatedBusDto | null;

  @ApiProperty({
    example: '2026-11',
    description: 'One rating per driver per month; sending again this month updates it',
  })
  month: string;

  @ApiProperty({ example: true, description: 'false when the child does not use the bus or the bus has no driver' })
  can_rate: boolean;

  @ApiProperty({ example: 2, description: 'Ratings at or below this many stars need a reason' })
  low_rating_max: number;

  @ApiProperty({ type: MyDriverRatingDto, nullable: true, description: 'My rating for this driver this month' })
  my_rating: MyDriverRatingDto | null;

  @ApiProperty({ type: [RatingTagDto], description: 'Chips to show; send their codes in tags' })
  tags: RatingTagDto[];
}

export class DriverRatingInputDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ enum: RATING_TAGS, isArray: true, example: ['safe_driving', 'polite'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(RATING_TAGS.length)
  @ArrayUnique()
  @IsIn(RATING_TAGS, { each: true })
  tags?: RatingTag[];

  @ApiPropertyOptional({ example: 'Drives carefully and waits for the children to sit.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  comment?: string;
}

export class RatingStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;
}

export class DriverRatingDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 4 })
  rating: number;

  @ApiProperty({ type: [RatingTagDto] })
  tags: RatingTagDto[];

  @ApiProperty({ nullable: true, type: String })
  comment: string | null;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ type: RefDto })
  driver: RefDto;

  @ApiProperty({ type: RatedBusDto, nullable: true })
  vehicle: RatedBusDto | null;

  @ApiProperty({ type: RatingStudentDto })
  student: RatingStudentDto;

  @ApiProperty({ type: RefDto, description: 'The parent who rated' })
  parent: RefDto;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}

export class DriverRatingQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 21, description: 'The driver (users.id)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  driver_user_id?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vehicle_id?: number;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ example: true, description: 'Only 1 and 2 star ratings' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  low?: boolean;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class TopTagDto extends RatingTagDto {
  @ApiProperty({ example: 6 })
  count: number;
}

export class DriverRatingSummaryDto {
  @ApiProperty({ type: RatedDriverDto })
  driver: RatedDriverDto;

  @ApiProperty({ type: RatedBusDto, nullable: true, description: 'The bus they drive now' })
  vehicle: RatedBusDto | null;

  @ApiProperty({ nullable: true, type: Number, example: 4.3, description: 'All ratings; null when none yet' })
  average: number | null;

  @ApiProperty({ example: 18 })
  count: number;

  @ApiProperty({ nullable: true, type: Number, example: 4.5, description: 'This month' })
  month_average: number | null;

  @ApiProperty({ example: 6 })
  month_count: number;

  @ApiProperty({ example: 1, description: '1 and 2 star ratings' })
  low_count: number;

  @ApiProperty({ type: [Number], example: [0, 1, 2, 6, 9], description: 'How many 1, 2, 3, 4 and 5 star ratings' })
  distribution: number[];

  @ApiProperty({ type: [TopTagDto], description: 'Every chip parents picked with its count, most first' })
  top_tags: TopTagDto[];

  @ApiProperty({ example: true, description: 'This month’s average is at or below the low rating line' })
  needs_attention: boolean;
}

export class DriverRatingInsightsDto {
  @ApiProperty({ nullable: true, type: Number, example: 4.2 })
  average: number | null;

  @ApiProperty({ example: 42 })
  count: number;

  @ApiProperty({ example: 11 })
  month_count: number;

  @ApiProperty({ example: 2, description: '1 and 2 star ratings this month' })
  month_low: number;

  @ApiProperty({ example: 3 })
  drivers_rated: number;
}

export class DriverRatingSettingsInputDto {
  @ApiPropertyOptional({ example: 2, enum: [2, 3], description: 'Ratings at or below this many stars are low' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([2, 3], { message: 'low_rating_max must be 2 or 3' })
  low_rating_max?: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    maximum: 50,
    description: 'A driver sees an average after this many ratings',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  min_responses?: number;
}

export class DriverRatingSettingsDto {
  @ApiProperty({ example: 2 })
  low_rating_max: number;

  @ApiProperty({ example: 3 })
  min_responses: number;
}

export class OfficeDriverRatingSettingsDto extends DriverRatingSettingsDto {
  @ApiProperty({ example: true, description: 'false when my role may only read the settings' })
  can_edit: boolean;
}

export class DriverOwnRatingsDto {
  @ApiProperty({ example: 3 })
  min_responses: number;

  @ApiProperty({ example: 5, description: 'Ratings received, always shown' })
  count: number;

  @ApiProperty({
    example: true,
    description: 'false until count reaches min_responses; the fields below are then empty',
  })
  enough: boolean;

  @ApiProperty({ nullable: true, type: Number, example: 4.2 })
  average: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 4.5, description: 'This month' })
  month_average: number | null;

  @ApiProperty({ example: 2 })
  month_count: number;

  @ApiProperty({ type: [Number], example: [0, 0, 1, 2, 2], description: 'Counts for 1 to 5 stars' })
  distribution: number[];

  @ApiProperty({
    type: [TopTagDto],
    description: 'Every chip parents picked with its count, most first. Parents and comments are never shown',
  })
  top_tags: TopTagDto[];
}

export class OfficeRatedDriversQueryDto {
  @ApiPropertyOptional({ example: 'ganesan', description: 'Driver name, bus name or registration number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: true, description: 'Only drivers whose month average is at or below the low line' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  needs_attention?: boolean;
}

export class OfficeRatedDriversDto {
  @ApiProperty({ example: 2, description: 'Drivers after the search and filter' })
  total: number;

  @ApiProperty({ example: 1, description: 'Drivers needing attention in the whole school, whatever the search' })
  needs_attention_count: number;

  @ApiProperty({ type: [DriverRatingSummaryDto], description: 'Lowest average first; drivers without ratings last' })
  items: DriverRatingSummaryDto[];
}
