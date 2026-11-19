import { createHmac } from 'crypto';
import { safeEqual } from '../../shared/crypto';
import { GateQr, GateQrKind, readGateQr, signGateQr } from '../gate/gate.logic';

const PREFIX = 'TZS1';

export interface StudentQr {
  student_id: number;
  version: number;
}

export class QrTokens {
  constructor(private readonly secret: string) {}

  student(studentId: number, version: number): string {
    return `${PREFIX}.${studentId}.${version}.${this.signature(studentId, version)}`;
  }

  readStudent(token: string): StudentQr | null {
    const parts = token.trim().split('.');
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    const studentId = Number(parts[1]);
    const version = Number(parts[2]);
    if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(version) || version <= 0) return null;
    return safeEqual(this.signature(studentId, version), parts[3]) ? { student_id: studentId, version } : null;
  }

  gate(kind: GateQrKind, id: number, version: number): string {
    return signGateQr(this.secret, kind, id, version);
  }

  readGate(token: string): GateQr | null {
    return readGateQr(this.secret, token);
  }

  private signature(studentId: number, version: number): string {
    return createHmac('sha256', this.secret).update(`student:${studentId}:${version}`).digest('base64url').slice(0, 22);
  }
}
