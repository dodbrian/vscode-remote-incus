// In-container stdio<->TCP relay (bundled asset of the extension; staged into
// the instance at ~/.vscode-server/relay.js on every install and run with the
// server's OWN bundled node — zero extra dependencies inside the instance).
//
//   RELAY_HOST / RELAY_PORT come in via `incus exec --env` (always 127.0.0.1).
//
// Writes ONLY mirrored bytes to stdout; stderr keeps diagnostics.
// Teardown semantics (spike-verified, docs/DESIGN.md §6):
//   stdin EOF        -> client.end()   (server sees FIN)
//   client close     -> process.exit(0)
//   stdout EPIPE     -> process.exit(1) (client side died)
const net = require('net');
process.stdin.pause();
const client = net.createConnection(
  { host: process.env.RELAY_HOST, port: +process.env.RELAY_PORT },
  () => {},
);
client.pipe(process.stdout);
process.stdin.pipe(client);
process.stdin.on('end', () => {
  client.end();
});
process.stdin.on('error', () => process.exit(1));
process.stdout.on('error', () => process.exit(1)); // EPIPE kills us when the client side dies
client.on('close', () => process.exit(0));
client.on('error', () => process.exit(1));
