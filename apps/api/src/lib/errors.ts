export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = 'resource') => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (code = 'forbidden', message?: string) => new AppError(403, code, message ?? 'not allowed');
export const unauthorized = (code = 'unauthorized') => new AppError(401, code, 'authentication required');
export const conflict = (code: string, message?: string) => new AppError(409, code, message);
export const unprocessable = (code: string, message?: string, extra?: Record<string, unknown>) => new AppError(422, code, message, extra);
export const badRequest = (code: string, message?: string) => new AppError(400, code, message);
