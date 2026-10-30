//! Error → status mapping. Denial classes stay distinct so a rejection
//! can never degrade to a generic 500.

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthorized = (m = 'unauthorized') => new HttpError(401, m);
export const forbidden = (m = 'forbidden') => new HttpError(403, m);
export const badRequest = (m: string) => new HttpError(400, m);
export const notFound = (m = 'not found') => new HttpError(404, m);
export const tooMany = (retryAfter: number) =>
  Object.assign(new HttpError(429, 'rate limited'), { retryAfter });
