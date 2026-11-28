import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeacherRatingPeriod1795800000000 implements MigrationInterface {
  name = 'TeacherRatingPeriod1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "teacher_rating_period" character varying(10) NOT NULL DEFAULT 'months'`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "teacher_rating_min_responses" smallint NOT NULL DEFAULT '1'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "teacher_rating_min_responses"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "teacher_rating_period"`);
  }
}
