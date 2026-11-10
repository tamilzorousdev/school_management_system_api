import { MigrationInterface, QueryRunner } from 'typeorm';

export class MeetingRing1794001000000 implements MigrationInterface {
  name = 'MeetingRing1794001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meetings"
        ADD COLUMN IF NOT EXISTS "ring_call_id" varchar(24),
        ADD COLUMN IF NOT EXISTS "ring_to" varchar(10),
        ADD COLUMN IF NOT EXISTS "ring_by" int,
        ADD COLUMN IF NOT EXISTS "ring_started_at" timestamptz
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_meetings_ringing" ON "meetings" ("ring_started_at") WHERE "ring_call_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meetings_ringing"`);
    await queryRunner.query(`
      ALTER TABLE "meetings"
        DROP COLUMN IF EXISTS "ring_started_at",
        DROP COLUMN IF EXISTS "ring_by",
        DROP COLUMN IF EXISTS "ring_to",
        DROP COLUMN IF EXISTS "ring_call_id"
    `);
  }
}
