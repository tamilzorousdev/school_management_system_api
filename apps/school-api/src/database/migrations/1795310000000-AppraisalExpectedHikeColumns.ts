import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppraisalExpectedHikeColumns1795310000000 implements MigrationInterface {
  name = 'AppraisalExpectedHikeColumns1795310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_appraisals"
       ADD COLUMN IF NOT EXISTS "expected_increment_percent" numeric(4,1),
       ADD COLUMN IF NOT EXISTS "hike_justification" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_appraisals"
       DROP COLUMN IF EXISTS "expected_increment_percent",
       DROP COLUMN IF EXISTS "hike_justification"`,
    );
  }
}
