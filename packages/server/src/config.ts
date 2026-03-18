import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PORT = 4000;
const DEFAULT_DATABASE_URL =
  "postgres://postgres:postgres@localhost:5432/collab_poc";

function readPort(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_PORT;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PORT;
  }

  return parsed;
}

export const config = {
  port: readPort(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
};
