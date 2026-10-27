export type ErrorDetails = Readonly<Record<string, unknown>>;

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request is invalid.', details?: ErrorDetails) {
    super('VALIDATION_ERROR', 400, message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class SessionStaleError extends AppError {
  constructor() {
    super('SESSION_STALE', 401, 'The session is stale. Sign in again.');
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super('FORBIDDEN', 403, 'You do not have permission to perform this action.');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super('NOT_FOUND', 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(
    code = 'CONFLICT',
    message = 'The request conflicts with current state.',
    details?: ErrorDetails,
  ) {
    super(code, 409, message, details);
  }
}

export class InvalidTransitionError extends AppError {
  constructor(details?: ErrorDetails) {
    super('INVALID_TRANSITION', 409, 'The requested state transition is not allowed.', details);
  }
}

export class QuorumNotMetError extends AppError {
  constructor(details?: ErrorDetails) {
    super(
      'APPROVAL_QUORUM_NOT_MET',
      409,
      'The required approval quorum has not been met.',
      details,
    );
  }
}

export class SeparationOfDutiesError extends AppError {
  constructor(details?: ErrorDetails) {
    super('APPROVER_CANNOT_EXECUTE', 409, 'An approver cannot execute this disposition.', details);
  }
}

export class EvidenceIncompleteError extends AppError {
  constructor(details?: ErrorDetails) {
    super('EVIDENCE_INCOMPLETE', 422, 'Required evidence is incomplete.', details);
  }
}

export class RateLimitedError extends AppError {
  constructor(details?: ErrorDetails) {
    super('RATE_LIMITED', 429, 'Too many requests. Try again later.', details);
  }
}

export class UpstreamError extends AppError {
  constructor(message = 'An upstream dependency failed.', details?: ErrorDetails) {
    super('UPSTREAM_ERROR', 502, message, details);
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(details?: ErrorDetails) {
    super('DEPENDENCY_UNAVAILABLE', 503, 'A required dependency is unavailable.', details);
  }
}

export class DegradationBlockedError extends AppError {
  constructor(details?: ErrorDetails) {
    super(
      'DEGRADATION_BLOCKED',
      503,
      'The operation is blocked by the current degradation level.',
      details,
    );
  }
}

export class ImmutableRecordError extends AppError {
  constructor(model: string) {
    super('IMMUTABLE_RECORD', 500, 'An immutable record cannot be changed.', { model });
  }
}
