import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeacherFeedback1794610000000 implements MigrationInterface {
  name = 'TeacherFeedback1794610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "teacher_ratings" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "teacher_user_id" integer NOT NULL, "parent_user_id" integer NOT NULL, "student_id" integer NOT NULL, "section_id" integer, "stars" smallint NOT NULL, "behaviour" character varying(4) NOT NULL, "remark" character varying(500), "cycle_start" date NOT NULL, "cycle_end" date NOT NULL, CONSTRAINT "PK_be5be870d808e0c09a472b39d33" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_63538f20944aded241675e0318" ON "teacher_ratings" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_teacher_ratings_teacher" ON "teacher_ratings" ("school_id", "teacher_user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_teacher_ratings_cycle" ON "teacher_ratings" ("parent_user_id", "teacher_user_id", "student_id", "cycle_start") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "student_feedback" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "term_id" integer NOT NULL DEFAULT '0', "teacher_user_id" integer NOT NULL, "student_id" integer NOT NULL, "section_id" integer, "studies" smallint NOT NULL, "behaviour" smallint NOT NULL, "sports" smallint, "remark" character varying(500), CONSTRAINT "PK_62d4a9be66752e38bd228a78223" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_3567f939b185dfc26346957660" ON "student_feedback" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_feedback_student" ON "student_feedback" ("school_id", "student_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_student_feedback_term" ON "student_feedback" ("teacher_user_id", "student_id", "academic_year_id", "term_id") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "teacher_rating_enabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "teacher_rating_months" smallint NOT NULL DEFAULT '3'`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "student_feedback_enabled" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "student_feedback_enabled"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "teacher_rating_months"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "teacher_rating_enabled"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_student_feedback_term"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_student_feedback_student"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3567f939b185dfc26346957660"`);
    await queryRunner.query(`DROP TABLE "student_feedback"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_teacher_ratings_cycle"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_teacher_ratings_teacher"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_63538f20944aded241675e0318"`);
    await queryRunner.query(`DROP TABLE "teacher_ratings"`);
  }
}
