import { MigrationInterface, QueryRunner } from 'typeorm';

export class TripHandover1794720000000 implements MigrationInterface {
  name = 'TripHandover1794720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD IF NOT EXISTS "handover_of" integer`);
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD IF NOT EXISTS "replaced_by" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN IF EXISTS "replaced_by"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN IF EXISTS "handover_of"`);
  }
}
