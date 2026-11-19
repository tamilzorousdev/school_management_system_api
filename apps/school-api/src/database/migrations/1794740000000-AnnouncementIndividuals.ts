import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnnouncementIndividuals1794740000000 implements MigrationInterface {
  name = 'AnnouncementIndividuals1794740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "announcements" ALTER COLUMN "audience" TYPE character varying(12)`);
    await queryRunner.query(`ALTER TABLE "announcements" ADD IF NOT EXISTS "edited_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "announcements" ADD IF NOT EXISTS "edited_by" integer`);
    await queryRunner.query(`ALTER TABLE "announcement_targets" ADD IF NOT EXISTS "student_id" integer`);
    await queryRunner.query(`ALTER TABLE "announcement_targets" ADD IF NOT EXISTS "user_id" integer`);
    await queryRunner.query(`ALTER TABLE "announcement_recipients" ADD IF NOT EXISTS "student_ids" integer array`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "announcement_recipients" DROP COLUMN IF EXISTS "student_ids"`);
    await queryRunner.query(`ALTER TABLE "announcement_targets" DROP COLUMN IF EXISTS "user_id"`);
    await queryRunner.query(`ALTER TABLE "announcement_targets" DROP COLUMN IF EXISTS "student_id"`);
    await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "edited_by"`);
    await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "edited_at"`);
    await queryRunner.query(`UPDATE "announcements" SET "audience" = 'parents' WHERE "audience" = 'individuals'`);
    await queryRunner.query(`ALTER TABLE "announcements" ALTER COLUMN "audience" TYPE character varying(10)`);
  }
}
