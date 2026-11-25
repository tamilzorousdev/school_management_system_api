import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestContextStore {
  requestId: string;
  userId?: number;
  schoolId?: number | null;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  userId(): number | undefined {
    return storage.getStore()?.userId;
  },

  schoolId(): number | null | undefined {
    return storage.getStore()?.schoolId;
  },

  ip(): string | undefined {
    return storage.getStore()?.ip;
  },

  setUser(userId: number, schoolId: number | null): void {
    const store = storage.getStore();
    if (!store) return;
    store.userId = userId;
    store.schoolId = schoolId;
  },
};

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  RequestContext.run({ requestId, ip: req.ip }, next);
}
