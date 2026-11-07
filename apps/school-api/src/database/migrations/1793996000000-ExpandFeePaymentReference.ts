import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandFeePaymentReference1793996000000 implements MigrationInterface {
  name = 'ExpandFeePaymentReference1793996000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_payments" ALTER COLUMN "reference" TYPE character varying(200)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_payments" ALTER COLUMN "reference" TYPE character varying(60)`);
  }
}
