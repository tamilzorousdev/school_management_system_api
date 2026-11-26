export const decimal = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null || value === undefined ? null : Number(value)),
};
