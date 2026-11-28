import { MigrationInterface, QueryRunner } from 'typeorm';

export class DriverRatingSettings1795800000001 implements MigrationInterface {
  name = 'DriverRatingSettings1795800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" ADD "driver_low_rating_max" smallint NOT NULL DEFAULT '2'`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "driver_rating_min_responses" smallint NOT NULL DEFAULT '3'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "driver_rating_min_responses"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "driver_low_rating_max"`);
  }
}
