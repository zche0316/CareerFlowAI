export class JobSourceError extends Error {
  constructor(code, message, status = 503, retryAfter = null) {
    super(message);
    this.name = 'JobSourceError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
