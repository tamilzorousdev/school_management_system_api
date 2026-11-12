import { MigrationInterface, QueryRunner } from 'typeorm';

export class HomeworkDirectPosting1794490000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" ALTER COLUMN "diary_review_mode" SET DEFAULT 'none'`);
    await queryRunner.query(`UPDATE "schools" SET "diary_review_mode" = 'none'`);
    await queryRunner.query(
      `UPDATE "diary_entries" SET "status" = 'published', "published_at" = now() WHERE "status" = 'pending_review'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" ALTER COLUMN "diary_review_mode" SET DEFAULT 'remarks'`);
  }
}
