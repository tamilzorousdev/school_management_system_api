import { OnlineQuiz } from './entities/online-quiz.entity';

interface Person {
  id: number;
  name: string;
}

function person(user?: { id: number; name: string } | null): Person | null {
  return user ? { id: user.id, name: user.name } : null;
}

export function presentAdminQuiz(quiz: OnlineQuiz, questionsCount?: number, attemptsCount = 0) {
  const totalMarks = Number(quiz.total_marks);
  const passMarks = quiz.pass_marks === null ? null : Number(quiz.pass_marks);
  const questions = (quiz.questions ?? []).map((question) => ({
    id: question.id,
    sequence: question.sequence,
    question_text: question.question_text,
    question_type: question.question_type,
    options: question.options,
    correct_option: question.correct_option,
    explanation: question.explanation,
    marks: Number(question.marks),
  }));
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    instructions: quiz.instructions,
    status: quiz.status,
    rejection_reason: quiz.rejection_reason,
    start_at: quiz.start_at,
    end_at: quiz.end_at,
    duration_minutes: quiz.duration_minutes,
    total_marks: totalMarks,
    pass_marks: passMarks,
    pass_percentage: passMarks === null || totalMarks <= 0 ? null : Math.round((passMarks / totalMarks) * 1000) / 10,
    expire_on_exit: quiz.expire_on_exit,
    require_camera: quiz.require_camera,
    require_microphone: quiz.require_microphone,
    created_at: quiz.created_at,
    approved_at: quiz.approved_at,
    class: quiz.section?.school_class
      ? { id: quiz.section.school_class.id, name: quiz.section.school_class.name }
      : null,
    section: quiz.section ? { id: quiz.section.id, name: quiz.section.name } : null,
    subject: quiz.subject ? { id: quiz.subject.id, name: quiz.subject.name, code: quiz.subject.code } : null,
    teacher: person(quiz.teacher),
    approved_by: person(quiz.approved_by),
    questions_count: questionsCount ?? questions.length,
    attempts_count: attemptsCount,
    ...(quiz.questions ? { questions } : {}),
  };
}
