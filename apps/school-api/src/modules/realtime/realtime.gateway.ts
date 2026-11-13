import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DataSource } from 'typeorm';
import { Namespace, Socket } from 'socket.io';
import { AppException, AuthUser } from '@app/common';
import { AccessService } from '../access/access.service';
import { TokenService } from '../auth/token.service';

export const COMM_NAMESPACE = '/comm';

interface SocketData {
  user?: AuthUser;
}

type Ack = { ok: true } | { ok: false; error: string; message: string };

export const userRoom = (userId: number) => `user.${userId}`;

const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: COMM_NAMESPACE,
  cors: { origin: corsOrigins.length ? corsOrigins : true, credentials: true },
})
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger('Comm');

  @WebSocketServer() private readonly server: Namespace;

  constructor(
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly dataSource: DataSource,
  ) {}

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then(async (user) => {
          (socket.data as SocketData).user = user;
          await socket.join(userRoom(user.id));
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

  toUsers(userIds: number[], event: string, payload: object): void {
    const rooms = [...new Set(userIds.filter(Boolean))].map(userRoom);
    if (!rooms.length || !this.server) return;
    this.server.to(rooms).emit(event, payload);
    this.logger.debug(`${event} → ${rooms.join(', ')}`);
  }

  @SubscribeMessage('chat.typing')
  async typing(@ConnectedSocket() socket: Socket, @MessageBody() body: { thread_id?: number }): Promise<Ack> {
    const user = (socket.data as SocketData).user;
    const threadId = Number(body?.thread_id);
    if (!user || !Number.isInteger(threadId)) {
      return { ok: false, error: 'VALIDATION_FAILED', message: 'Send { "thread_id": number }' };
    }
    const [thread]: { is_group: boolean; teacher_user_id: number | null; parent_user_id: number | null }[] =
      await this.dataSource.query(
        `SELECT is_group, teacher_user_id, parent_user_id FROM chat_threads WHERE id = $1 AND deleted_at IS NULL`,
        [threadId],
      );
    let members: number[] = [];
    if (thread?.is_group) {
      const rows: { user_id: number }[] = await this.dataSource.query(
        `SELECT user_id FROM chat_group_members WHERE thread_id = $1`,
        [threadId],
      );
      members = rows.map((r) => Number(r.user_id));
    } else if (thread) {
      members = [Number(thread.teacher_user_id), Number(thread.parent_user_id)].filter(Boolean);
    }
    if (!members.includes(user.id)) return { ok: false, error: 'FORBIDDEN', message: 'Not your conversation' };
    this.toUsers(
      members.filter((id) => id !== user.id),
      'chat.typing',
      { thread_id: threadId, user_id: user.id },
    );
    return { ok: true };
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

  private tokenFrom(socket: Socket): string {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    const header = socket.handshake.headers.authorization;
    const token = auth?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw AppException.unauthorized('Sign in to continue', 'TOKEN_MISSING');
    return token.replace(/^Bearer\s+/i, '');
  }
}
