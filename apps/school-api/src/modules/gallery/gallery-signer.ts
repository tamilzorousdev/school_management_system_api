import { hmac, safeEqual } from '../../shared/crypto';

export type MediaVariant = 'view' | 'thumb' | 'download';

export interface SignedMediaQuery {
  variant: MediaVariant;
  expires: number;
  user: number;
  signature: string;
}

export class GallerySigner {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  sign(mediaId: number, variant: MediaVariant, userId: number, now = Date.now()): SignedMediaQuery {
    const expires = Math.floor(now / 1000) + this.ttlSeconds;
    return { variant, expires, user: userId, signature: this.signature(mediaId, variant, userId, expires) };
  }

  verify(mediaId: number, query: SignedMediaQuery, now = Date.now()): boolean {
    if (!Number.isInteger(query.expires) || query.expires < Math.floor(now / 1000)) return false;
    return safeEqual(this.signature(mediaId, query.variant, query.user, query.expires), query.signature);
  }

  private signature(mediaId: number, variant: MediaVariant, userId: number, expires: number): string {
    return hmac(this.secret, `gallery:${mediaId}:${variant}:${userId}:${expires}`);
  }
}
