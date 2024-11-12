import { NextFunction, Request, Response } from "express";

type ERROR_LEVELS = "LOW" | "MEDIUM" | "HIGH";

// Extends Error class to create custom error class. with extra related fields
export class AppError extends Error {
  public readonly httpCode: number;
  public readonly isOperational: boolean;
  public readonly level: ERROR_LEVELS;

  public readonly httpStatus: string;
  public readonly description: string;

  constructor(code: ErrorCode, description: string, isOperational = true, level: ERROR_LEVELS = "LOW") {
    super(description);

    Object.setPrototypeOf(this, new.target.prototype);

    this.httpCode = ErrorCodes[code];
    this.httpStatus = code;
    this.isOperational = isOperational;
    this.level = level;
    this.description = description;

    Error.captureStackTrace(this);
  }
}

const ErrorCodes = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  CONFLICT: 409,
  PERMISSION_DENIED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

// handles the error and sends the response to the client
export const expressErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
) => {
  if (err instanceof AppError) {
    // Application error
    console.error(`[ERROR]: [${err.level.toUpperCase()}] ${err.httpStatus} - ${err.description}`);

    return res.status(err.httpCode).json({
      message: err.description,
    });
  }

  if (err instanceof Error) {
    // Unexpected error
    return res.status(500).json({
      message: err.message,
    });
  }

  // Unknown error
  return res.status(500).json({
    message: "Something went wrong. see logs for more details",
  });
};

// handles the error and throw error only if it is not operational error or unexpected error.
export const errorHandler = (err: unknown, shouldThrowAlways = false) => {
  if (err instanceof AppError) {
    // Application error
    console.error(`[ERROR]: [${err.level.toUpperCase()}] ${err.httpStatus} - ${err.description}`);

    if (err.level === "HIGH" || shouldThrowAlways || !err.isOperational) {
      throw err;
    }
  } else if (err instanceof Error) {
    // Unexpected error
    console.error(`[ERROR]: [UNEXPECTED] - ${err.message}`);
    throw err;
  } else {
    // Unknown error
    console.error(`[ERROR]: [UNKNOWN] - ${err}`);
    throw err;
  }
};

type ErrorCode = keyof typeof ErrorCodes;
