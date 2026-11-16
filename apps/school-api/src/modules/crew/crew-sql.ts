import { DUE_SOON_DAYS } from '../transport/transport.logic';
import { CREW_CHECKS, CrewCheckDefinition, DutyStatus, ExpiryFilter } from './crew.logic';

export const CREW_ROLE_SQL = `EXISTS (SELECT 1 FROM user_roles cur JOIN roles cr ON cr.id = cur.role_id
  WHERE cur.user_id = st.user_id AND cr.code IN ('DRIVER', 'ATTENDANT'))`;

export const DRIVER_SQL = `EXISTS (SELECT 1 FROM user_roles dur JOIN roles dr ON dr.id = dur.role_id
  WHERE dur.user_id = st.user_id AND dr.code = 'DRIVER')`;

export const ON_BUS_SQL = `EXISTS (SELECT 1 FROM vehicles bv WHERE bv.school_id = st.school_id AND bv.deleted_at IS NULL
  AND (bv.driver_user_id = st.user_id OR bv.attendant_user_id = st.user_id))`;

export const VEHICLE_SQL = `EXISTS (SELECT 1 FROM vehicles fv WHERE fv.id = :vehicleId AND fv.deleted_at IS NULL
  AND (fv.driver_user_id = st.user_id OR fv.attendant_user_id = st.user_id))`;

const documentVerified = (check: CrewCheckDefinition) =>
  `(SELECT d.status FROM staff_documents d WHERE d.staff_id = st.id AND d.type = '${check.document}'
    AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT 1) = 'verified'`;

const checkClear = (check: CrewCheckDefinition) =>
  `(${documentVerified(check)} AND st.${check.field} >= CAST(:today AS date))`;

const forRole = (check: CrewCheckDefinition, sql: string) =>
  check.roles.includes('attendant') ? sql : `(${DRIVER_SQL} AND ${sql})`;

export const CLEAR_SQL = `(${CREW_CHECKS.map((check) =>
  check.roles.includes('attendant') ? checkClear(check) : `(NOT ${DRIVER_SQL} OR ${checkClear(check)})`,
).join(' AND ')})`;

export const DUTY_SQL: Record<DutyStatus, string> = {
  pending: 'st.duty_approved_at IS NULL',
  approved: `(st.duty_approved_at IS NOT NULL AND ${CLEAR_SQL})`,
  blocked: `(st.duty_approved_at IS NOT NULL AND NOT ${CLEAR_SQL})`,
};

const anyDate = (condition: (field: string) => string) =>
  `(${CREW_CHECKS.map((check) => forRole(check, condition(`st.${check.field}`))).join(' OR ')})`;

export const EXPIRY_SQL: Record<ExpiryFilter, string> = {
  expired: anyDate((field) => `${field} < CAST(:today AS date)`),
  due_soon: anyDate((field) => `${field} BETWEEN CAST(:today AS date) AND CAST(:today AS date) + ${DUE_SOON_DAYS}`),
  missing: anyDate((field) => `${field} IS NULL`),
};
