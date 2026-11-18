import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmergencyLifecycle1794700000000 implements MigrationInterface {
  name = 'EmergencyLifecycle1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "send_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "expiry_value" integer`);
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "expiry_unit" character varying(8)`);
    await queryRunner.query(
      `ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "ended_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "end_reason" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "ended_by" integer`);
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "reviewed_by" integer`);
    await queryRunner.query(
      `ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "reviewed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "review_note" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_emergency_broadcasts_due" ON "emergency_broadcasts" ("status", "send_at") WHERE "status" = 'scheduled'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_emergency_broadcasts_expiry" ON "emergency_broadcasts" ("expires_at") WHERE "ended_at" IS NULL AND "expires_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "emergency_templates" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "category" character varying(20) NOT NULL, "severity" character varying(10) NOT NULL, "title" character varying(120) NOT NULL, "message" text NOT NULL, "title_ta" character varying(120), "message_ta" text, "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_emergency_templates" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_emergency_templates_school" ON "emergency_templates" ("school_id", "sort_order")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "emergency_templates"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_emergency_broadcasts_expiry"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_emergency_broadcasts_due"`);
    for (const column of [
      'review_note',
      'reviewed_at',
      'reviewed_by',
      'ended_by',
      'end_reason',
      'ended_at',
      'expires_at',
      'expiry_unit',
      'expiry_value',
      'send_at',
    ]) {
      await queryRunner.query(`ALTER TABLE "emergency_broadcasts" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
