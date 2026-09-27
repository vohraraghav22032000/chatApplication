const http = require("node:http");
const {  Server  } = require("socket.io");
const {  createApp  } = require("./app");
const {  config  } = require("./config");
const {  pool  } = require("./db");
const {  setupSocket  } = require("./socket/connection");

async function main() {
  await pool.query("SELECT 1");

  const app = createApp();
  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: config.clientOrigin,
      credentials: true
    },
    transports: ["websocket", "polling"]
  });

  setupSocket(io);

  httpServer.listen(config.port, () => {
    console.log(`Chat API listening on 4007`);
  });

  const shutdown = async () => {
    console.log("Shutting down...");
    io.close();
    httpServer.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
