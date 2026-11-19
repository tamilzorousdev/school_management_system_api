import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeeRescheduleRequests1794720000000 implements MigrationInterface {
  name = 'FeeRescheduleRequests1794720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_invoices" ADD "original_due_date" date`);
    await queryRunner.query(`ALTER TABLE "fee_requests" DROP CONSTRAINT "CHK_fee_requests_kind"`);
    await queryRunner.query(
      `ALTER TABLE "fee_requests" ADD CONSTRAINT "CHK_fee_requests_kind" CHECK ("kind" IN ('discount', 'cancel', 'reversal', 'refund', 'reschedule'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "fee_requests" WHERE "kind" = 'reschedule'`);
    await queryRunner.query(`ALTER TABLE "fee_requests" DROP CONSTRAINT "CHK_fee_requests_kind"`);
    await queryRunner.query(
      `ALTER TABLE "fee_requests" ADD CONSTRAINT "CHK_fee_requests_kind" CHECK ("kind" IN ('discount', 'cancel', 'reversal', 'refund'))`,
    );
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP COLUMN "original_due_date"`);
  }
}
