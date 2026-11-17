import { MigrationInterface, QueryRunner } from 'typeorm';

export class TripFlagsSent1794670000000 implements MigrationInterface {
  name = 'TripFlagsSent1794670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD "flags_sent_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN "flags_sent_at"`);
  }
}
