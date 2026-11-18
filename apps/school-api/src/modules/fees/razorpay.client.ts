import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AppException } from '@app/common';
import { paymentsConfig, PaymentsConfig } from '../../config/configuration';
import { safeEqual } from '../../shared/crypto';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger('Razorpay');

  constructor(@Inject(paymentsConfig.KEY) private readonly config: PaymentsConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.razorpayKeyId && this.config.razorpayKeySecret);
  }

  get keyId(): string {
    return this.config.razorpayKeyId;
  }

  assertEnabled(): void {
    if (!this.enabled) {
      throw AppException.unavailable('Online payment is not switched on for this school', 'ONLINE_PAYMENTS_OFF');
    }
  }

  async createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<RazorpayOrder> {
    this.assertEnabled();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.razorpayApiUrl}/v1/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${this.config.razorpayKeyId}:${this.config.razorpayKeySecret}`).toString('base64')}`,
        },
        body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Partial<RazorpayOrder> & {
        error?: { description?: string };
      };
      if (!response.ok || !body.id) {
        this.logger.warn(`Order not created (${response.status}): ${body.error?.description ?? 'no detail'}`);
        throw AppException.unavailable('Online payment could not be started. Try again.', 'PAYMENT_GATEWAY_ERROR');
      }
      return body as RazorpayOrder;
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.warn(`Order not created: ${(error as Error).message}`);
      throw AppException.unavailable('Online payment could not be started. Try again.', 'PAYMENT_GATEWAY_ERROR');
    } finally {
      clearTimeout(timer);
    }
  }

  paymentSignatureValid(orderId: string, paymentId: string, signature: string | undefined): boolean {
    if (!signature || !this.config.razorpayKeySecret) return false;
    const expected = createHmac('sha256', this.config.razorpayKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return safeEqual(expected, signature);
  }

  webhookSignatureValid(raw: Buffer | undefined, signature: string | undefined): boolean {
    if (!raw || !signature || !this.config.razorpayWebhookSecret) return false;
    const expected = createHmac('sha256', this.config.razorpayWebhookSecret).update(raw).digest('hex');
    return safeEqual(expected, signature);
  }
}
