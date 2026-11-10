import { MigrationInterface, QueryRunner } from 'typeorm';

export class MeetingReplies1793999000000 implements MigrationInterface {
  name = 'MeetingReplies1793999000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meetings"
        ADD COLUMN IF NOT EXISTS "response" varchar(10) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "responded_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "response_note" varchar(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meetings"
        DROP COLUMN IF EXISTS "response_note",
        DROP COLUMN IF EXISTS "responded_at",
        DROP COLUMN IF EXISTS "response"
    `);
  }
}
