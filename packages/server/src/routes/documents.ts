import { Router, type Request, type Response } from "express";
import {
  DOCUMENT_TITLE_MAX_LENGTH,
  isUuid,
  type CreateDocumentRequest,
  type DeleteDocumentResponse,
  type ListDocumentsResponse,
  type UpdateDocumentRequest
} from "@collab/shared";
import { config } from "../config.js";
import {
  createDocument,
  getDocumentById,
  listDocumentsByOwner,
  softDeleteDocumentById,
  updateDocumentById
} from "../models/documents.js";
import { AppError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const documentsRouter = Router();

function readDocumentId(request: Request): string {
  const { id } = request.params;
  if (!isUuid(id)) {
    throw new AppError(404, "NOT_FOUND", "Document not found");
  }
  return id;
}

function validateTitle(title: unknown): string {
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Title is required");
  }

  const nextTitle = title.trim();
  if (nextTitle.length > DOCUMENT_TITLE_MAX_LENGTH) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Title must be at most ${DOCUMENT_TITLE_MAX_LENGTH} characters`
    );
  }

  return nextTitle;
}

documentsRouter.get(
  "/",
  asyncHandler(async (_request: Request, response: Response<ListDocumentsResponse>) => {
    const documents = await listDocumentsByOwner(config.demoUserId);
    response.json({
      documents,
      total: documents.length
    });
  })
);

documentsRouter.post(
  "/",
  asyncHandler(async (
    request: Request<unknown, unknown, CreateDocumentRequest>,
    response: Response
  ) => {
    const title = validateTitle(request.body?.title);
    const document = await createDocument(title, config.demoUserId);
    response.status(201).json(document);
  })
);

documentsRouter.get("/:id", asyncHandler(async (request: Request, response: Response) => {
  const id = readDocumentId(request);
  const document = await getDocumentById(id, config.demoUserId);

  if (!document) {
    throw new AppError(404, "NOT_FOUND", "Document not found");
  }

  response.json(document);
}));

documentsRouter.put(
  "/:id",
  asyncHandler(async (
    request: Request<{ id: string }, unknown, UpdateDocumentRequest>,
    response: Response
  ) => {
    const id = readDocumentId(request);
    const nextTitle =
      request.body?.title === undefined
        ? undefined
        : validateTitle(request.body.title);
    const nextContent = request.body?.content;

    if (nextContent !== undefined && typeof nextContent !== "string") {
      throw new AppError(400, "VALIDATION_ERROR", "Content must be a string");
    }

    if (nextTitle === undefined && nextContent === undefined) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "At least one field (title or content) must be provided"
      );
    }

    const updated = await updateDocumentById(id, config.demoUserId, {
      title: nextTitle,
      content: nextContent
    });

    if (!updated) {
      throw new AppError(404, "NOT_FOUND", "Document not found");
    }

    response.json(updated);
  })
);

documentsRouter.delete(
  "/:id",
  asyncHandler(async (
    request: Request<{ id: string }>,
    response: Response<DeleteDocumentResponse>
  ) => {
    const id = readDocumentId(request);
    const wasDeleted = await softDeleteDocumentById(id, config.demoUserId);

    if (!wasDeleted) {
      throw new AppError(404, "NOT_FOUND", "Document not found");
    }

    response.json({ success: true });
  })
);
