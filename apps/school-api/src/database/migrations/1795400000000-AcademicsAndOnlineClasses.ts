import { MigrationInterface, QueryRunner } from 'typeorm';

export class AcademicsAndOnlineClasses1795400000000 implements MigrationInterface {
  name = 'AcademicsAndOnlineClasses1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "syllabus_units" (
        "id" SERIAL PRIMARY KEY,
        "school_id" int NOT NULL,
        "academic_year_id" int NOT NULL,
        "class_id" int NOT NULL,
        "subject_id" int NOT NULL,
        "unit_number" int NOT NULL,
        "unit_name" varchar(200) NOT NULL,
        "description" text,
        "total_planned_hours" numeric(5,2) DEFAULT 0,
        "is_completed" boolean DEFAULT false,
        "completed_at" timestamptz,
        "completion_percentage" numeric(5,2) DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "IDX_syllabus_units_school_subject" ON "syllabus_units" ("school_id", "class_id", "subject_id");

      CREATE TABLE IF NOT EXISTS "lesson_plans" (
        "id" SERIAL PRIMARY KEY,
        "school_id" int NOT NULL,
        "unit_id" int NOT NULL REFERENCES "syllabus_units"("id") ON DELETE CASCADE,
        "teacher_user_id" int NOT NULL,
        "section_id" int NOT NULL,
        "planned_date" date NOT NULL,
        "topic" varchar(250) NOT NULL,
        "learning_objectives" text,
        "teaching_aid" text,
        "homework_assigned" text,
        "status" varchar(30) DEFAULT 'draft',
        "reviewed_by_user_id" int,
        "review_notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "IDX_lesson_plans_teacher" ON "lesson_plans" ("school_id", "teacher_user_id");
      CREATE INDEX IF NOT EXISTS "IDX_lesson_plans_section" ON "lesson_plans" ("school_id", "section_id");

      CREATE TABLE IF NOT EXISTS "study_materials" (
        "id" SERIAL PRIMARY KEY,
        "school_id" int NOT NULL,
        "class_id" int NOT NULL,
        "subject_id" int NOT NULL,
        "section_id" int,
        "unit_id" int REFERENCES "syllabus_units"("id") ON DELETE SET NULL,
        "uploader_user_id" int NOT NULL,
        "title" varchar(200) NOT NULL,
        "description" text,
        "material_type" varchar(30) DEFAULT 'document',
        "file_id" int,
        "file_url" text,
        "external_url" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "IDX_study_materials_subject" ON "study_materials" ("school_id", "class_id", "subject_id");

      CREATE TABLE IF NOT EXISTS "online_classes" (
        "id" SERIAL PRIMARY KEY,
        "school_id" int NOT NULL,
        "section_id" int NOT NULL,
        "subject_id" int NOT NULL,
        "teacher_user_id" int NOT NULL,
        "title" varchar(200) NOT NULL,
        "description" text,
        "scheduled_start" timestamptz NOT NULL,
        "scheduled_end" timestamptz NOT NULL,
        "status" varchar(20) DEFAULT 'scheduled',
        "channel_name" varchar(150) NOT NULL,
        "meeting_url" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "IDX_online_classes_section" ON "online_classes" ("school_id", "section_id");
      CREATE INDEX IF NOT EXISTS "IDX_online_classes_teacher" ON "online_classes" ("school_id", "teacher_user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "online_classes";
      DROP TABLE IF EXISTS "study_materials";
      DROP TABLE IF EXISTS "lesson_plans";
      DROP TABLE IF EXISTS "syllabus_units";
    `);
  }
}
