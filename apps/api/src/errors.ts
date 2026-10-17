export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requireValue<T>(
  v: T | null | undefined,
  message = 'The requested item was not found.',
): T {
  if (v == null) throw new AppError(404, 'NOT_FOUND', message);
  return v;
}
