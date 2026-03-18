import type { NextFunction, Request, Response } from "express";
import type { ApiErrorCode, ApiErrorResponse } from "@collab/shared";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sendKnownError(
  response: Response,
  statusCode: number,
  code: ApiErrorCode,
  message: string
): void {
  const payload: ApiErrorResponse = {
    error: {
      code,
      message
    }
  };
  response.status(statusCode).json(payload);
}

export function notFoundHandler(request: Request, response: Response): void {
  sendKnownError(response, 404, "NOT_FOUND", `Route not found: ${request.path}`);
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
): void {
  if (error instanceof AppError) {
    sendKnownError(response, error.statusCode, error.code, error.message);
    return;
  }

  console.error("Unhandled server error:", error);
  sendKnownError(response, 500, "SERVER_ERROR", "Unexpected server error");
}
