import { createHmac } from 'crypto';
import { AppException } from '@app/common';
import { RazorpayClient } from './razorpay.client';

const config = (overrides: Partial<ConstructorParameters<typeof RazorpayClient>[0]> = {}) =>
  ({
    razorpayKeyId: 'rzp_test_abcdefgh',
    razorpayKeySecret: 'secret_secret_secret',
    razorpayWebhookSecret: 'webhook_secret',
    razorpayApiUrl: 'https://api.razorpay.com',
    timeoutMs: 1000,
    ...overrides,
  }) as ConstructorParameters<typeof RazorpayClient>[0];

describe('Razorpay signatures', () => {
  it('accepts the checkout signature made with the key secret', () => {
    const client = new RazorpayClient(config());
    const signature = createHmac('sha256', 'secret_secret_secret').update('order_1|pay_1').digest('hex');
    expect(client.paymentSignatureValid('order_1', 'pay_1', signature)).toBe(true);
  });

  it('refuses a signature for another payment or a missing one', () => {
    const client = new RazorpayClient(config());
    const signature = createHmac('sha256', 'secret_secret_secret').update('order_1|pay_1').digest('hex');
    expect(client.paymentSignatureValid('order_1', 'pay_2', signature)).toBe(false);
    expect(client.paymentSignatureValid('order_1', 'pay_1', undefined)).toBe(false);
    expect(client.paymentSignatureValid('order_1', 'pay_1', 'short')).toBe(false);
  });

  it('checks the webhook signature on the raw body', () => {
    const client = new RazorpayClient(config());
    const raw = Buffer.from('{"event":"payment.captured"}');
    const signature = createHmac('sha256', 'webhook_secret').update(raw).digest('hex');
    expect(client.webhookSignatureValid(raw, signature)).toBe(true);
    expect(client.webhookSignatureValid(Buffer.from('{"event":"x"}'), signature)).toBe(false);
  });

  it('is switched off without keys', () => {
    const client = new RazorpayClient(config({ razorpayKeyId: '', razorpayKeySecret: '' }));
    expect(client.enabled).toBe(false);
    expect(() => client.assertEnabled()).toThrow(AppException);
  });

  it('refuses every webhook when no webhook secret is set', () => {
    const client = new RazorpayClient(config({ razorpayWebhookSecret: '' }));
    expect(client.webhookSignatureValid(Buffer.from('{}'), 'abc')).toBe(false);
  });
});
