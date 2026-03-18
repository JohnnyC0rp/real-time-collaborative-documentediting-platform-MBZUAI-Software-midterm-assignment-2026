import type { DocumentRecord, UpdateDocumentRequest } from "@collab/shared";
import { query } from "../utils/db.js";

interface DocumentRow {
  id: string;
  title: string;
  owner_id: string;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function toDocumentRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    owner_id: row.owner_id,
    content: row.content,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

export async function listDocumentsByOwner(
  ownerId: string
): Promise<DocumentRecord[]> {
  const result = await query<DocumentRow>(
    `
      SELECT id, title, owner_id, content, created_at, updated_at
      FROM documents
      WHERE owner_id = $1 AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `,
    [ownerId]
  );

  return result.rows.map(toDocumentRecord);
}

export async function getDocumentById(id: string): Promise<DocumentRecord | null> {
  const result = await query<DocumentRow>(
    `
      SELECT id, title, owner_id, content, created_at, updated_at
      FROM documents
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [id]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return toDocumentRecord(result.rows[0]);
}

export async function createDocument(
  title: string,
  ownerId: string
): Promise<DocumentRecord> {
  const result = await query<DocumentRow>(
    `
      INSERT INTO documents (title, owner_id, content)
      VALUES ($1, $2, '')
      RETURNING id, title, owner_id, content, created_at, updated_at
    `,
    [title, ownerId]
  );

  return toDocumentRecord(result.rows[0]);
}

export async function updateDocumentById(
  id: string,
  payload: UpdateDocumentRequest
): Promise<DocumentRecord | null> {
  const updates: string[] = [];
  const values: unknown[] = [];

  if (payload.title !== undefined) {
    values.push(payload.title);
    updates.push(`title = $${values.length}`);
  }

  if (payload.content !== undefined) {
    values.push(payload.content);
    updates.push(`content = $${values.length}`);
  }

  values.push(id);

  const result = await query<DocumentRow>(
    `
      UPDATE documents
      SET ${updates.join(", ")}
      WHERE id = $${values.length} AND deleted_at IS NULL
      RETURNING id, title, owner_id, content, created_at, updated_at
    `,
    values
  );

  if (result.rowCount === 0) {
    return null;
  }

  return toDocumentRecord(result.rows[0]);
}

export async function softDeleteDocumentById(id: string): Promise<boolean> {
  const result = await query(
    `
      UPDATE documents
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}
