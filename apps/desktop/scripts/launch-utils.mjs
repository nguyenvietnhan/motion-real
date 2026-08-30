import { createServer } from "node:net";

function portFree(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
}

export async function findFreePort(preferredPort, searchWidth = 20) {
  if (await portFree(preferredPort)) return preferredPort;
  for (let port = preferredPort + 1; port < preferredPort + searchWidth; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error(`No free port near ${preferredPort}`);
}
