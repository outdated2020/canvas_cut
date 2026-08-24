export interface StructuredError {
  code: string;
  message: string;
  retryable?: boolean;
}

export const ERROR_CODES = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_EXISTS: 'PROJECT_EXISTS',
  CANVAS_NOT_FOUND: 'CANVAS_NOT_FOUND',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  EDGE_INVALID: 'EDGE_INVALID',
  INVALID_PARAMS: 'INVALID_PARAMS',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_CANCELLED: 'JOB_CANCELLED',
  DAEMON_UNAVAILABLE: 'DAEMON_UNAVAILABLE',
  GENERATION_TIMEOUT: 'GENERATION_TIMEOUT',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  RENDER_FAILED: 'RENDER_FAILED',
  IPC_TIMEOUT: 'IPC_TIMEOUT',
  IPC_AUTH_FAILED: 'IPC_AUTH_FAILED',
  IPC_BAD_REQUEST: 'IPC_BAD_REQUEST',
  IPC_PROTOCOL_VERSION: 'IPC_PROTOCOL_VERSION'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class CanvasCutError extends Error implements StructuredError {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(code: string, message: string, options?: { retryable?: boolean; cause?: unknown; details?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'CanvasCutError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }

  toJSON(): StructuredError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable
    };
  }
}

export function isCanvasCutError(error: unknown): error is CanvasCutError {
  return error instanceof Error && 'code' in error;
}

export function toStructuredError(error: unknown): StructuredError {
  if (isCanvasCutError(error)) {
    return error.toJSON();
  }
  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message,
      retryable: false
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: String(error),
    retryable: false
  };
}
