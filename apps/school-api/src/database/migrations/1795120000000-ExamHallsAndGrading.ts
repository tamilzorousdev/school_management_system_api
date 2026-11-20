import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExamHallsAndGrading1795120000000 implements MigrationInterface {
  name = 'ExamHallsAndGrading1795120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS exam_halls (
        id SERIAL PRIMARY KEY,
        school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(80) NOT NULL,
        building VARCHAR(80),
        floor VARCHAR(50),
        capacity INT NOT NULL DEFAULT 30,
        rows_count INT NOT NULL DEFAULT 5,
        columns_count INT NOT NULL DEFAULT 6,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exam_halls_school_name" ON exam_halls (school_id, name) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS exam_hall_allocations (
        id SERIAL PRIMARY KEY,
        school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        hall_id INT NOT NULL REFERENCES exam_halls(id) ON DELETE CASCADE,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        seat_number VARCHAR(30) NOT NULL,
        desk_order INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exam_hall_student" ON exam_hall_allocations (exam_id, student_id);
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exam_hall_seat" ON exam_hall_allocations (exam_id, hall_id, seat_number);

      CREATE TABLE IF NOT EXISTS exam_invigilators (
        id SERIAL PRIMARY KEY,
        school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        hall_id INT NOT NULL REFERENCES exam_halls(id) ON DELETE CASCADE,
        teacher_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exam_date DATE NOT NULL,
        session VARCHAR(20) NOT NULL DEFAULT 'Morning',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS "IDX_exam_invig_exam_date" ON exam_invigilators (exam_id, exam_date);

      CREATE TABLE IF NOT EXISTS grading_scales (
        id SERIAL PRIMARY KEY,
        school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        board VARCHAR(50) NOT NULL DEFAULT 'CBSE',
        name VARCHAR(80) NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        tiers JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_grading_scales_school_name" ON grading_scales (school_id, name) WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS grading_scales CASCADE;
      DROP TABLE IF EXISTS exam_invigilators CASCADE;
      DROP TABLE IF EXISTS exam_hall_allocations CASCADE;
      DROP TABLE IF EXISTS exam_halls CASCADE;
    `);
  }
}

