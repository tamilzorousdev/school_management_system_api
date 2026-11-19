import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeeDueReminders1795075169571 implements MigrationInterface {
  name = 'FeeDueReminders1795075169571';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_settings" ADD "reminder_days" smallint NOT NULL DEFAULT '3'`);
    await queryRunner.query(`ALTER TABLE "fee_invoices" ADD "due_reminded_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "fee_settings" DROP CONSTRAINT "CHK_fee_settings_values"`);
    await queryRunner.query(
      `ALTER TABLE "fee_settings" ADD CONSTRAINT "CHK_fee_settings_values" CHECK ("grace_days" >= 0 AND "grace_days" <= 90 AND "late_fee_type" IN ('none', 'flat', 'percent') AND "late_fee_value" >= 0 AND ("late_fee_type" <> 'percent' OR "late_fee_value" <= 100) AND "reminder_days" >= 0 AND "reminder_days" <= 30)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_settings" DROP CONSTRAINT "CHK_fee_settings_values"`);
    await queryRunner.query(
      `ALTER TABLE "fee_settings" ADD CONSTRAINT "CHK_fee_settings_values" CHECK ("grace_days" >= 0 AND "grace_days" <= 90 AND "late_fee_type" IN ('none', 'flat', 'percent') AND "late_fee_value" >= 0 AND ("late_fee_type" <> 'percent' OR "late_fee_value" <= 100))`,
    );
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP COLUMN "due_reminded_at"`);
    await queryRunner.query(`ALTER TABLE "fee_settings" DROP COLUMN "reminder_days"`);
  }
}
