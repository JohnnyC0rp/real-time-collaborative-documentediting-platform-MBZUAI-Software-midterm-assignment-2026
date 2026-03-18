import { config } from "./config.js";
import { createApp } from "./app.js";
import { pool } from "./utils/db.js";

async function startServer(): Promise<void> {
  await pool.query("SELECT 1");

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Server is listening on http://localhost:${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
