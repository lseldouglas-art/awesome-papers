export class DomainError extends Error {
  constructor(code, status, message, details = undefined) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}
export function requireThat(condition, code, message, status = 400, details) {
  if (!condition) throw new DomainError(code, status, message, details);
}
