import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentSpecialCategoryAndCaregiverPickup1793995000000 implements MigrationInterface {
  name = 'StudentSpecialCategoryAndCaregiverPickup1793995000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "students"
      ADD COLUMN IF NOT EXISTS "is_specially_abled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "disability_category" varchar(80),
      ADD COLUMN IF NOT EXISTS "disability_percentage" numeric(5,1),
      ADD COLUMN IF NOT EXISTS "is_adopted" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "student_guardians"
      ADD COLUMN IF NOT EXISTS "can_pickup" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "student_guardians"
      DROP COLUMN IF EXISTS "can_pickup"
    `);

    await queryRunner.query(`
      ALTER TABLE "students"
      DROP COLUMN IF EXISTS "is_specially_abled",
      DROP COLUMN IF EXISTS "disability_category",
      DROP COLUMN IF EXISTS "disability_percentage",
      DROP COLUMN IF EXISTS "is_adopted"
    `);
  }
}
