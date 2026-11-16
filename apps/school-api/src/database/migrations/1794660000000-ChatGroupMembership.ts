import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatGroupMembership1794660000000 implements MigrationInterface {
  name = 'ChatGroupMembership1794660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_group_members" ADD "left_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "chat_group_members" ADD "left_reason" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "chat_group_members" ADD "removed_by" integer`);
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "event" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "event_user_id" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "event_user_id"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "event"`);
    await queryRunner.query(`ALTER TABLE "chat_group_members" DROP COLUMN "removed_by"`);
    await queryRunner.query(`ALTER TABLE "chat_group_members" DROP COLUMN "left_reason"`);
    await queryRunner.query(`ALTER TABLE "chat_group_members" DROP COLUMN "left_at"`);
  }
}
