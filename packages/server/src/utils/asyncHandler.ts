import type { NextFunction, Request, Response, RequestHandler } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import type { ParsedQs } from "qs";

export function asyncHandler<
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = ParsedQs,
  Locals extends Record<string, unknown> = Record<string, unknown>
>(
  handler: (
    request: Request<P, ResBody, ReqBody, ReqQuery, Locals>,
    response: Response<ResBody, Locals>,
    next: NextFunction
  ) => Promise<unknown>
): RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals> {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}
