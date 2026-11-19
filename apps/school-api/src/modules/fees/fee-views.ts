import type { FeePaymentDto, StudentFeesDto } from './dto/fees.dto';

const withoutStaffDetails = (payment: FeePaymentDto): FeePaymentDto => ({
  ...payment,
  reference: null,
  notes: null,
  received_by: null,
  reversed_by: null,
  reversal_reason: null,
});

export function feesForParent(fees: StudentFeesDto): StudentFeesDto {
  const payment = (row: FeePaymentDto): FeePaymentDto => ({ ...row, notes: null });
  return {
    ...fees,
    invoices: fees.invoices.map((invoice) => ({
      ...invoice,
      pending_requests: [],
      payments: invoice.payments.map(payment),
    })),
    payments: fees.payments.map(payment),
  };
}

export function feesForTeacher(fees: StudentFeesDto): StudentFeesDto {
  return {
    ...fees,
    invoices: fees.invoices.map((invoice) => ({
      ...invoice,
      discount_reason: null,
      cancel_reason: null,
      benefits: [],
      refunds: [],
      pending_requests: [],
      payments: invoice.payments.map(withoutStaffDetails),
    })),
    payments: fees.payments.map(withoutStaffDetails),
  };
}
