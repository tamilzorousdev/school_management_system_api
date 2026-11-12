import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import { AppException, AuthenticatedRequest } from '@app/common';
import { resolveSchoolId } from './school-context';
import { parseYearHeader, runInYear, YEAR_HEADER } from './year-context';

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

@Injectable()
export class YearContextInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const yearId = parseYearHeader(request.header(YEAR_HEADER));
    if (yearId === null || !request.path.includes('/admin/')) return next.handle();
    if (yearId === 'invalid') {
      throw AppException.badRequest('X-Academic-Year-Id must be an academic year id', 'INVALID_ACADEMIC_YEAR');
    }
    const schoolId = this.schoolOf(request);
    if (schoolId === null) return next.handle();
    const [year]: { id: number; name: string; is_current: boolean }[] = await this.dataSource.query(
      `SELECT id, name, is_current FROM academic_years WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [yearId, schoolId],
    );
    if (!year) throw AppException.notFound('Academic year not found', 'ACADEMIC_YEAR_NOT_FOUND');
    if (year.is_current) return next.handle();
    if (!READ_METHODS.includes(request.method)) {
      throw AppException.forbidden(
        `You are viewing ${year.name}. Earlier years are read-only: switch back to the current year to make changes.`,
        'YEAR_READ_ONLY',
      );
    }
    const id = Number(year.id);
    return new Observable((subscriber) => runInYear(id, () => next.handle().subscribe(subscriber)));
  }

  private schoolOf(request: AuthenticatedRequest): number | null {
    try {
      return resolveSchoolId(request);
    } catch {
      return null;
    }
  }
}
