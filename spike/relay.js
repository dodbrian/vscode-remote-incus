// In-container stdio<->TCP relay. Run with the server's OWN bundled node:
//   incus exec ... -- node /home/ubuntu/.vscode-server/bin/relay/relay.js
// Writes ONLY mirrored bytes to stdout; stderr keeps diagnostics.
const net = require("net");
process.stdin.pause();
const client = net.createConnection(
  { host: process.env.RELAY_HOST, port: +process.env.RELAY_PORT },
  () => {}
);
client.pipe(process.stdout);
process.stdin.pipe(client);
process.stdin.on("end", () => { client.end(); });
process.stdin.on("error", () => process.exit(1));
process.stdout.on("error", () => process.exit(1)); // EPIPE kills us when the client side dies
client.on("close", () => process.exit(0));
client.on("error", () => process.exit(1));
