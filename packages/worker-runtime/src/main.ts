import { createServer } from "node:http";
import { registerHandler } from "./gates.js";
import { registerGitHubHandlers } from "./handlers/github.js";
import { logger } from "./logger.js";
import { makeHandler } from "./server.js";

// Register built-in primitive op handlers
registerGitHubHandlers(registerHandler);

const port = Number(process.env.PORT ?? 8080);

const server = createServer(makeHandler());
server.listen(port, "0.0.0.0", () => {
  logger.info(`[holyshipper] worker-runtime listening on :${port}`, { port });
});
