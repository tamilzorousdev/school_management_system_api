import { ROLES } from '../../modules/access/access.catalog';
import { School } from '../../modules/schools/entities/school.entity';
import { SeedUser } from './seed-helpers';

export const DEMO_PLATFORM_USERS: SeedUser[] = [
  { name: 'Tamilzorous Super Admin', mobile: '9999999999', roles: [ROLES.SUPER_ADMIN] },
];

export const DEMO_SCHOOL: Partial<School> = {
  code: 'TZMS',
  name: 'Tamilzorous Model School',
  board: 'CBSE',
  address: '12, 2nd Avenue, Anna Nagar',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600040',
  phone: '04426201234',
  emergency_phone: '04426201235',
  email: 'office@tzms.edu.in',
  timezone: 'Asia/Kolkata',
  latitude: 13.0878,
  longitude: 80.2101,
  geofence_radius_m: 200,
};

export const DEMO_SCHOOL_USERS: SeedUser[] = [
  { name: 'School Admin', mobile: '9876543210', roles: [ROLES.ADMIN] },
  { name: 'Meenakshi Sundaram', mobile: '9000000001', roles: [ROLES.PRINCIPAL] },
  { name: 'Karthik Raman', mobile: '9000000002', roles: [ROLES.AO] },
  { name: 'Selvam Murugan', mobile: '9000000003', roles: [ROLES.TRANSPORT_INCHARGE] },
  { name: 'Priya Venkatesh', mobile: '9000000004', roles: [ROLES.TEACHER, ROLES.HOD] },
  { name: 'Lakshmi Narayanan', mobile: '9000000005', roles: [ROLES.PARENT], language: 'ta' },
  { name: 'Arun Prakash', mobile: '9000000006', roles: [ROLES.TEACHER, ROLES.PARENT] },
  { name: 'Ganesan Pillai', mobile: '9000000007', roles: [ROLES.DRIVER], language: 'ta' },
  { name: 'Revathi Kannan', mobile: '9000000008', roles: [ROLES.ATTENDANT], language: 'ta' },
  { name: 'Kalaivani Sekar', mobile: '9000000009', roles: [ROLES.LIBRARIAN] },
];
