import { MigrationInterface, QueryRunner } from 'typeorm';

export class GatePassVisitType1795300000000 implements MigrationInterface {
  name = 'GatePassVisitType1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "gate_passes" ADD COLUMN IF NOT EXISTS "pass_type" character varying(10) NOT NULL DEFAULT 'pickup'`,
    );
    await queryRunner.query(`ALTER TABLE "gate_passes" ALTER COLUMN "pickup_kind" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "gate_passes" ALTER COLUMN "pickup_name" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "gate_passes" WHERE "pickup_kind" IS NULL`);
    await queryRunner.query(`ALTER TABLE "gate_passes" ALTER COLUMN "pickup_name" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "gate_passes" ALTER COLUMN "pickup_kind" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "gate_passes" DROP COLUMN IF EXISTS "pass_type"`);
  }
}
