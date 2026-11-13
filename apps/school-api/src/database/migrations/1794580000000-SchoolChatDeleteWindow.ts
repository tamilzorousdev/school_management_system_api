import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchoolChatDeleteWindow1794580000000 implements MigrationInterface {
  name = 'SchoolChatDeleteWindow1794580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "chat_delete_window" varchar(20) NOT NULL DEFAULT '24_hours'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN IF EXISTS "chat_delete_window"`);
  }
}
