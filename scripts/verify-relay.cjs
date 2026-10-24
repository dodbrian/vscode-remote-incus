// Portable executable verification: local TCP only; no Incus or VS Code.
const { spawn } = require('node:child_process');
const net = require('node:net');
const assert = require('node:assert/strict');
const path = require('node:path');

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('5s bounded wait exceeded')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const children = new Set();
  const sockets = new Set();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.pipe(socket);
    socket.on('end', () => socket.end());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  function relay(selectedPort = port) {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../assets/relay.js')], {
      env: { ...process.env, RELAY_HOST: '127.0.0.1', RELAY_PORT: String(selectedPort) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.add(child);
    child.done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        children.delete(child);
        resolve({ code, signal });
      });
    });
    child.stdin.on('error', () => {});
    child.stderr.resume();
    return child;
  }

  async function exchange(child, bytes) {
    const chunks = [];
    let count = 0;
    let onData;
    try {
      await bounded(
        new Promise((resolve, reject) => {
          onData = (chunk) => {
            chunks.push(chunk);
            count += chunk.length;
            if (count >= bytes.length) resolve();
          };
          child.stdout.on('data', onData);
          child.stdin.write(bytes, (error) => {
            if (error) reject(error);
          });
        }),
      );
      assert.deepEqual(Buffer.concat(chunks), bytes);
    } finally {
      child.stdout.off('data', onData);
    }
  }

  try {
    const first = relay(),
      second = relay();
    const bytes = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256));
    await Promise.all([exchange(first, bytes), exchange(second, Buffer.from(bytes).reverse())]);
    if (process.argv.includes('--exercise-failure-cleanup'))
      throw Error('injected cleanup verification');
    first.stdin.end();
    assert.equal((await bounded(first.done)).code, 0);
    await exchange(second, bytes);
    second.stdin.end();
    assert.equal((await bounded(second.done)).code, 0);
    console.log('PASS binary duplex, independent channels, stdin EOF and clean teardown');

    for (let i = 0; i < 5; i++) {
      const child = relay();
      await exchange(child, Buffer.from([0, 255, 128, 1]));
      child.stdin.end();
      assert.equal((await bounded(child.done)).code, 0);
    }
    console.log('PASS repeated connect/disconnect');

    const reservation = net.createServer();
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const refusedPort = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const refused = relay(refusedPort);
    assert.equal((await bounded(refused.done)).code, 1);
    console.log('PASS connection refusal');

    const peerClosed = relay();
    await exchange(peerClosed, Buffer.from('connected'));
    for (const socket of sockets) socket.destroy();
    assert.equal((await bounded(peerClosed.done)).code, 0);
    console.log('PASS peer closure');

    const brokenOutput = relay();
    await exchange(brokenOutput, Buffer.from('ready'));
    brokenOutput.stdout.destroy();
    brokenOutput.stdin.write(Buffer.alloc(1024 * 1024));
    assert.equal((await bounded(brokenOutput.done)).code, 1);
    console.log('PASS stdout EPIPE');
  } finally {
    // Attempt both process and socket cleanup even if one bounded check fails.
    const pending = [...children];
    for (const child of pending) child.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    const cleanup = await Promise.allSettled([
      bounded(Promise.all(pending.map((child) => child.done))),
      bounded(new Promise((resolve) => server.close(resolve))),
    ]);
    assert.ok(cleanup.every((result) => result.status === 'fulfilled'));
    assert.equal(children.size, 0);
    assert.equal(sockets.size, 0);
    console.log('PASS bounded cleanup: no owned children or sockets');
  }
}
main().catch((error) => {
  if (
    process.argv.includes('--exercise-failure-cleanup') &&
    error.message === 'injected cleanup verification'
  ) {
    console.log('PASS failure after two live channels cleaned up');
  } else {
    console.error(error);
    process.exitCode = 1;
  }
});
