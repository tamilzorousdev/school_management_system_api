import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { AppException, AuthUser } from '@app/common';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { AccessService } from '../access/access.service';
import { TokenService } from '../auth/token.service';
import { BoardingDto } from './dto/boarding.dto';
import { AlertDto } from './dto/fleet-alert.dto';
import { TransportTrip } from './entities/transport-trip.entity';
import { TripAccessService } from './trip-access.service';

export const LIVE_NAMESPACE = '/live';

interface SocketData {
  user?: AuthUser;
}

type Ack = { ok: true; room: string } | { ok: false; error: string; message: string };

const tripRoom = (tripId: number) => `trip.${tripId}`;
const fleetRoom = (schoolId: number) => `fleet.${schoolId}`;

const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: LIVE_NAMESPACE,
  cors: { origin: corsOrigins.length ? corsOrigins : true, credentials: true },
})
export class LiveGateway implements OnGatewayInit {
  private readonly logger = new Logger('Live');

  @WebSocketServer() private readonly server: Namespace;

  constructor(
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly tripAccess: TripAccessService,
  ) {}

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          (socket.data as SocketData).user = user;
          next();
        })
        .catch((error: unknown) => {
          const response =
            error instanceof AppException ? (error.getResponse() as { code?: string; message?: string }) : null;
          const refused = new Error(response?.message ?? 'Sign in again') as Error & { data: object };
          refused.data = { error: response?.code ?? 'TOKEN_INVALID', message: response?.message ?? 'Sign in again' };
          next(refused);
        });
    });
  }

  private async authenticate(socket: Socket): Promise<AuthUser> {
    const payload = await this.tokens.verifyAccess(this.tokenFrom(socket));
    await this.tokens.activeSession(payload.sid, payload.sub);
    const access = await this.access.load(payload.sub);
    if (!access || access.user.status !== 'active' || access.user.deleted_at) {
      throw AppException.unauthorized('Your account is not active', 'ACCOUNT_INACTIVE');
    }
    return {
      id: access.user.id,
      session_id: payload.sid,
      school_id: access.user.school_id,
      name: access.user.name,
      mobile: access.user.mobile,
      roles: access.roles.map((role) => role.code),
      permissions: access.permissions,
    };
  }

  @SubscribeMessage('trip.subscribe')
  async subscribeTrip(@ConnectedSocket() socket: Socket, @MessageBody() body: { trip_id?: number }): Promise<Ack> {
    const user = (socket.data as SocketData).user;
    const tripId = Number(body?.trip_id);
    if (!user || !Number.isInteger(tripId)) {
      return { ok: false, error: 'VALIDATION_FAILED', message: 'Send { "trip_id": number }' };
    }
    const allowed = await this.tripAccess.canFollow(user, tripId);
    if (!allowed) return { ok: false, error: 'FORBIDDEN', message: 'You cannot follow this trip' };
    await socket.join(tripRoom(tripId));
    return { ok: true, room: tripRoom(tripId) };
  }

  @SubscribeMessage('trip.unsubscribe')
  async unsubscribeTrip(@ConnectedSocket() socket: Socket, @MessageBody() body: { trip_id?: number }) {
    await socket.leave(tripRoom(Number(body?.trip_id)));
    return { ok: true };
  }

  @SubscribeMessage('fleet.subscribe')
  async subscribeFleet(@ConnectedSocket() socket: Socket, @MessageBody() body: { school_id?: number }): Promise<Ack> {
    const user = (socket.data as SocketData).user;
    if (!user?.permissions.includes(PERMISSIONS.FLEET_VIEW)) {
      return { ok: false, error: 'FORBIDDEN', message: 'You cannot see the fleet' };
    }
    const schoolId = user.roles.includes(ROLES.SUPER_ADMIN) ? Number(body?.school_id) : user.school_id;
    if (!schoolId) return { ok: false, error: 'SCHOOL_REQUIRED', message: 'Send { "school_id": number }' };
    await socket.join(fleetRoom(schoolId));
    return { ok: true, room: fleetRoom(schoolId) };
  }

  position(trip: TransportTrip, payload: object): void {
    const message = {
      trip_id: trip.id,
      route_id: trip.route_id,
      vehicle_id: trip.vehicle_id,
      device_id: trip.device_id,
      ...payload,
    };
    this.server?.to(tripRoom(trip.id)).to(fleetRoom(trip.school_id)).emit('trip.position', message);
  }

  event(trip: TransportTrip, payload: object): void {
    const message = {
      trip_id: trip.id,
      route_id: trip.route_id,
      vehicle_id: trip.vehicle_id,
      device_id: trip.device_id,
      ...payload,
    };
    this.server?.to(tripRoom(trip.id)).to(fleetRoom(trip.school_id)).emit('trip.event', message);
    this.logger.debug(`trip ${trip.id} event ${JSON.stringify(payload).slice(0, 120)}`);
  }

  passenger(trip: TransportTrip, boarding: BoardingDto): void {
    const name = boarding.action === 'boarded' ? 'passenger.boarded' : 'passenger.alighted';
    const message = {
      trip_id: trip.id,
      route_id: trip.route_id,
      vehicle_id: trip.vehicle_id,
      boarding_id: boarding.id,
      student_id: boarding.student_id,
      action: boarding.action,
      method: boarding.method,
      stop: boarding.stop,
      occurred_at: boarding.occurred_at,
    };
    this.server?.to(tripRoom(trip.id)).except(fleetRoom(trip.school_id)).emit(name, message);
    this.server
      ?.to(fleetRoom(trip.school_id))
      .emit(name, { ...message, full_name: boarding.full_name, class_section: boarding.class_section });
  }

  passengerUndone(trip: TransportTrip, boarding: { id: number; student_id: number; action: string }): void {
    this.server?.to(tripRoom(trip.id)).to(fleetRoom(trip.school_id)).emit('passenger.undone', {
      trip_id: trip.id,
      route_id: trip.route_id,
      vehicle_id: trip.vehicle_id,
      boarding_id: boarding.id,
      student_id: boarding.student_id,
      action: boarding.action,
    });
  }

  alert(schoolId: number, name: 'alert.raised' | 'alert.updated', alert: AlertDto): void {
    this.server?.to(fleetRoom(schoolId)).emit(name, alert);
  }

  private tokenFrom(socket: Socket): string {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    const header = socket.handshake.headers.authorization;
    const token = auth?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw AppException.unauthorized('Sign in to continue', 'TOKEN_MISSING');
    return token.replace(/^Bearer\s+/i, '');
  }
}
