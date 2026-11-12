import { MigrationInterface, QueryRunner } from 'typeorm';

export class SpecialClasses1794480000000 implements MigrationInterface {
  name = 'SpecialClasses1794480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "special_classes" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "section_id" integer NOT NULL, "subject_id" integer, "teacher_user_id" integer NOT NULL, "day_of_week" smallint NOT NULL, "period_no" smallint NOT NULL, "title" character varying(120) NOT NULL, "notes" character varying(500), CONSTRAINT "PK_ac6ab70e7b4339ab47a3d515014" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_72684c897802ac27d427959843" ON "special_classes" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_3509dece0783febb797a207ac1" ON "special_classes" ("academic_year_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_96c852dce32b58d4c04d5ff04d" ON "special_classes" ("section_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_1e34c7b91a4db2f99cd8c104dd" ON "special_classes" ("teacher_user_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_special_classes_section_slot" ON "special_classes" ("section_id", "day_of_week", "period_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "special_class_students" ("id" SERIAL NOT NULL, "special_class_id" integer NOT NULL, "student_id" integer NOT NULL, "school_id" integer NOT NULL, CONSTRAINT "PK_5e87e2b50eef627c3c7ca53dde1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4116c5d87d1e44bfb8d10699ae" ON "special_class_students" ("special_class_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_816fc444fc2e7d2107eecca726" ON "special_class_students" ("student_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_special_class_students" ON "special_class_students" ("special_class_id", "student_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "special_class_students" ADD CONSTRAINT "FK_4116c5d87d1e44bfb8d10699ae6" FOREIGN KEY ("special_class_id") REFERENCES "special_classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "special_class_students" DROP CONSTRAINT "FK_4116c5d87d1e44bfb8d10699ae6"`);
    await queryRunner.query(`DROP TABLE "special_class_students"`);
    await queryRunner.query(`DROP TABLE "special_classes"`);
  }
}
