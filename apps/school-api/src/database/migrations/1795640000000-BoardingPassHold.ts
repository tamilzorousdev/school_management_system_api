import { MigrationInterface, QueryRunner } from 'typeorm';

export class BoardingPassHold1795640000000 implements MigrationInterface {
  name = 'BoardingPassHold1795640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_boardings" ADD "pass_on_hold" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "transport_boardings" WHERE "action" = 'missed'`);
    await queryRunner.query(`ALTER TABLE "transport_boardings" DROP COLUMN "pass_on_hold"`);
  }
}
