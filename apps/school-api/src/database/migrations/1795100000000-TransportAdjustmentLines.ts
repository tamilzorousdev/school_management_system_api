import { MigrationInterface, QueryRunner } from 'typeorm';

export class TransportAdjustmentLines1795100000000 implements MigrationInterface {
  name = 'TransportAdjustmentLines1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP CONSTRAINT IF EXISTS "CHK_fee_invoice_lines_amount"`);
    await queryRunner.query(
      `ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "CHK_fee_invoice_lines_amount" CHECK ("amount" >= 0 OR "kind" = 'transport_adjustment')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP CONSTRAINT "CHK_fee_invoice_lines_amount"`);
    await queryRunner.query(
      `ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "CHK_fee_invoice_lines_amount" CHECK ("amount" >= 0)`,
    );
  }
}
