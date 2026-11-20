import { GrievanceCategory, GrievancePriority, GrievanceStatus } from './entities/grievance.entity';

export function defaultSlaHours(category: GrievanceCategory, priority: GrievancePriority): number {
  if (priority === 'critical') return 12;
  if (priority === 'high' || category === 'safety_bullying') return 24;
  if (priority === 'medium' || category === 'transport' || category === 'academics') return 48;
  return 72;
}

export function computeSlaDueDate(hours: number, fromDate: Date = new Date()): Date {
  const result = new Date(fromDate);
  result.setHours(result.getHours() + hours);
  return result;
}

export function isSlaBreached(slaDueAt: Date, status: GrievanceStatus, resolvedAt?: Date | null): boolean {
  if (status === 'resolved' || status === 'closed') {
    return resolvedAt ? resolvedAt.getTime() > slaDueAt.getTime() : false;
  }
  return Date.now() > slaDueAt.getTime();
}

export function formatTicketNumber(year: number, sequence: number): string {
  return `GRV-${year}-${String(sequence).padStart(4, '0')}`;
}

export function parseTicketSequence(ticketNo: string): number | null {
  const parts = ticketNo.split('-');
  if (parts.length < 3) return null;
  const num = parseInt(parts[2], 10);
  return isNaN(num) ? null : num;
}
