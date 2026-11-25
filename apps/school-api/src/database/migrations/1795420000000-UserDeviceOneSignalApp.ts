import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserDeviceOneSignalApp1795420000000 implements MigrationInterface {
  name = 'UserDeviceOneSignalApp1795420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_devices" ADD "onesignal_app_id" character varying(64)`);
    await queryRunner.query(`CREATE INDEX "IDX_user_devices_onesignal_app" ON "user_devices" ("onesignal_app_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_user_devices_onesignal_app"`);
    await queryRunner.query(`ALTER TABLE "user_devices" DROP COLUMN "onesignal_app_id"`);
  }
}
