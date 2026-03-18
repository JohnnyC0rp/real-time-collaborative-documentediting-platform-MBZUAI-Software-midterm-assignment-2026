import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../utils/db.js";

const migrationFiles = ["001_init.sql"];

async function runMigrations(): Promise<void> {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirPath = path.dirname(currentFilePath);
  const migrationsDirPath = path.resolve(currentDirPath, "../../migrations");

  for (const migrationFile of migrationFiles) {
    const migrationPath = path.join(migrationsDirPath, migrationFile);
    const sql = await readFile(migrationPath, "utf8");
    await pool.query(sql);
    console.log(`Applied migration: ${migrationFile}`);
  }
}

runMigrations()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
