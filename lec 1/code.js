// =============================================================================
// Lecture 01 — Code Examples
// =============================================================================
// Run each example independently. Requirements: Node.js (any version >= 14).
// No npm install needed — everything here uses Node's built-in 'net' module.
// =============================================================================


// =============================================================================
// EXAMPLE 1 — Socket Binding: 0.0.0.0 vs 127.0.0.1
// =============================================================================
//
// WHAT THIS DEMONSTRATES:
//   When you start a server, you choose WHICH network interface it listens on.
//   This is a layer 4 (Transport) decision — you're telling the OS:
//   "accept incoming TCP connections destined for port X, but only from..."
//
//   0.0.0.0   → ALL interfaces (your LAN IP, your public IP, loopback)
//               Anyone on the network can reach this server.
//               This is what you use in production.
//
//   127.0.0.1 → ONLY the loopback interface.
//               Traffic never leaves the machine.
//               This is what you use for local dev databases, internal services.
//
// WHY A BACKEND ENGINEER MUST KNOW THIS:
//   - Your PostgreSQL in production is (hopefully) bound to 127.0.0.1
//     so it's unreachable from the internet — only your app on the same
//     machine can connect to it.
//   - Your Express API is bound to 0.0.0.0 so the load balancer can reach it.
//   - A misconfigured Redis bound to 0.0.0.0 on a public server has caused
//     countless real-world data breaches.
//
// HOW TO RUN:
//   node code.js bind 0.0.0.0      ← accessible from other machines
//   node code.js bind 127.0.0.1    ← only accessible from THIS machine
//   Then try: curl http://localhost:3000   (always works)
//   Try from another machine on the network:
//     curl http://<your-ip>:3000          (only works with 0.0.0.0)
// =============================================================================

const net = require('net');

function runBindingDemo(host) {
  const PORT = 3000;

  const server = net.createServer((socket) => {
    // 'socket' represents one connected client — one TCP connection
    // Each connection has its own:
    //   - socket.localAddress  / socket.localPort   (your side)
    //   - socket.remoteAddress / socket.remotePort  (client's side)

    console.log('\n--- New connection ---');
    console.log(`  Server listening on : ${socket.localAddress}:${socket.localPort}`);
    console.log(`  Client connected from: ${socket.remoteAddress}:${socket.remotePort}`);
    //                                                               ^^^^^^^^^^^^^^^^^^^
    //                                  This is the CLIENT'S EPHEMERAL PORT.
    //                                  The OS on the client side picked a random
    //                                  port (usually 49152–65535) for this connection.
    //                                  The server sends responses BACK to this port.

    // Send a plain-text response (no HTTP — this is raw TCP)
    socket.write(`Hello from a raw TCP server bound to ${host}:${PORT}\n`);
    socket.write(`You connected from ${socket.remoteAddress}:${socket.remotePort}\n`);
    socket.end(); // close this connection gracefully (TCP FIN)
  });

  server.listen(PORT, host, () => {
    // server.address() returns the actual address the OS assigned
    const addr = server.address();
    console.log(`\nServer bound to: ${addr.address}:${addr.port}`);
    console.log(`Binding type   : ${host === '0.0.0.0' ? 'ALL interfaces (public)' : 'Loopback only (private)'}`);
    console.log(`\nTest it:`);
    console.log(`  From THIS machine  : curl http://localhost:${PORT}`);
    console.log(`  From ANOTHER machine: curl http://<your-ip>:${PORT}`);
    console.log(`\nWaiting for connections... (Ctrl+C to stop)\n`);
  });

  // Graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => process.exit(0));
  });
}


// =============================================================================
// EXAMPLE 2 — Raw TCP Client & Server: Seeing Layer 4 Directly
// =============================================================================
//
// WHAT THIS DEMONSTRATES:
//   HTTP, WebSockets, gRPC — they all sit ON TOP of TCP (layer 7 over layer 4).
//   Here we skip every layer-7 protocol and talk TCP directly.
//   This makes the OSI model concrete: you'll see segments, ports, and
//   connection lifecycle (SYN → established → FIN) in action.
//
//   We build a tiny message protocol ourselves:
//     - Client connects → server acknowledges
//     - Client sends a JSON message (this is us doing layer 6 manually)
//     - Server parses it, responds, closes connection
//
// WHY A BACKEND ENGINEER MUST KNOW THIS:
//   - Every time you call fetch(), axios, pg.connect(), redis.createClient()
//     you are creating a TCP socket under the hood. This is what that looks like.
//   - Understanding this helps you debug: connection refused, connection reset,
//     ECONNRESET, ETIMEDOUT — these are all TCP-level errors, not HTTP errors.
//   - Connection pooling (used by every DB client) is just reusing TCP sockets
//     instead of paying the SYN→SYN-ACK→ACK handshake cost every time.
//
// HOW TO RUN (two terminals):
//   Terminal 1: node code.js server
//   Terminal 2: node code.js client
//
//   Watch terminal 1 to see connections arrive with their ephemeral ports.
//   Watch terminal 2 to see what the client sends and receives.
// =============================================================================

const SERVER_HOST = '127.0.0.1'; // loopback — both client and server on same machine
const SERVER_PORT = 4000;

// ─── TCP SERVER ──────────────────────────────────────────────────────────────

function runTCPServer() {
  const server = net.createServer((socket) => {
    // At this point the TCP 3-way handshake is COMPLETE.
    // SYN (client) → SYN-ACK (server) → ACK (client) already happened.
    // We now have a reliable, ordered, bidirectional byte stream.

    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`\n[SERVER] New TCP connection from ${clientId}`);
    console.log(`[SERVER] (That port ${socket.remotePort} is the client's ephemeral port)`);

    // Send a greeting — raw bytes over the TCP stream
    socket.write(JSON.stringify({ type: 'greeting', message: 'Connected to raw TCP server' }) + '\n');

    // TCP is a STREAM protocol — data arrives in chunks, not neat messages.
    // We use '\n' as a message delimiter so we know where one message ends.
    let buffer = '';

    socket.on('data', (chunk) => {
      // 'chunk' is a Buffer — raw bytes received from the client.
      // Multiple sends from the client may arrive in one chunk (nagling),
      // or one send may be split across multiple chunks. Never assume 1 send = 1 chunk.
      buffer += chunk.toString();

      // Process all complete messages (delimited by newline)
      const messages = buffer.split('\n');
      buffer = messages.pop(); // last element may be incomplete — keep it in buffer

      for (const raw of messages) {
        if (!raw.trim()) continue;

        try {
          const msg = JSON.parse(raw); // Layer 6: deserialize bytes → object
          console.log(`[SERVER] Received from ${clientId}:`, msg);

          // Build a response based on message type
          const response = {
            type: 'response',
            echo: msg,
            serverTime: new Date().toISOString(),
            yourPort: socket.remotePort, // send the client's ephemeral port back to them
          };

          socket.write(JSON.stringify(response) + '\n'); // Layer 6: serialize → bytes
        } catch (e) {
          socket.write(JSON.stringify({ type: 'error', message: 'Invalid JSON' }) + '\n');
        }
      }
    });

    socket.on('end', () => {
      // Client sent a TCP FIN — they're done sending (but may still receive)
      console.log(`[SERVER] Client ${clientId} closed the connection`);
    });

    socket.on('error', (err) => {
      // Common errors:
      //   ECONNRESET — client disappeared without a proper FIN (crash, network drop)
      //   EPIPE      — tried to write to a socket that's already closed
      console.error(`[SERVER] Socket error from ${clientId}:`, err.message);
    });
  });

  server.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`[SERVER] Raw TCP server listening on ${SERVER_HOST}:${SERVER_PORT}`);
    console.log(`[SERVER] Waiting for connections...\n`);
    console.log(`Run in another terminal: node code.js client\n`);
  });

  process.on('SIGINT', () => {
    console.log('\n[SERVER] Shutting down...');
    server.close(() => process.exit(0));
  });
}

// ─── TCP CLIENT ──────────────────────────────────────────────────────────────

function runTCPClient() {
  console.log(`[CLIENT] Connecting to ${SERVER_HOST}:${SERVER_PORT}...`);
  console.log(`[CLIENT] (OS will assign us a random ephemeral source port)\n`);

  // net.createConnection triggers the TCP 3-way handshake:
  //   Client → SYN         → Server
  //   Client ← SYN-ACK     ← Server
  //   Client → ACK         → Server
  // 'connect' event fires after ACK is sent — connection is established.
  const socket = net.createConnection({ host: SERVER_HOST, port: SERVER_PORT });

  socket.on('connect', () => {
    // socket.localPort is the ephemeral port the OS assigned to US
    console.log(`[CLIENT] Connected!`);
    console.log(`[CLIENT] Our ephemeral source port : ${socket.localPort}`);
    console.log(`[CLIENT] Server destination port   : ${socket.remotePort}`);
    console.log(`[CLIENT] (Server sees us as ${socket.localAddress}:${socket.localPort})\n`);

    // Send three messages with a short delay between them
    // to demonstrate that TCP is a stream — server may receive them merged
    const messages = [
      { type: 'hello', payload: 'First message from client' },
      { type: 'data',  payload: { key: 'value', number: 42 } },
      { type: 'bye',   payload: 'Last message, closing after this' },
    ];

    messages.forEach((msg, i) => {
      setTimeout(() => {
        const serialized = JSON.stringify(msg) + '\n'; // Layer 6: serialize
        console.log(`[CLIENT] Sending message ${i + 1}:`, msg);
        socket.write(serialized);

        // After the last message, half-close (send FIN) so server knows we're done
        if (i === messages.length - 1) {
          setTimeout(() => {
            console.log('\n[CLIENT] Sending FIN (done writing)...');
            socket.end();
          }, 500);
        }
      }, i * 600); // stagger sends by 600ms
    });
  });

  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    const messages = buffer.split('\n');
    buffer = messages.pop();

    for (const raw of messages) {
      if (!raw.trim()) continue;
      try {
        const msg = JSON.parse(raw); // Layer 6: deserialize
        console.log(`[CLIENT] Received from server:`, msg);
      } catch (e) {
        console.log(`[CLIENT] Raw data from server: ${raw}`);
      }
    }
  });

  socket.on('end', () => {
    console.log('\n[CLIENT] Server closed the connection. Done.');
  });

  socket.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      console.error(`[CLIENT] Connection refused — is the server running?`);
      console.error(`[CLIENT] Start it with: node code.js server`);
    } else {
      console.error(`[CLIENT] Error:`, err.message);
    }
  });
}


// =============================================================================
// ENTRY POINT — parse CLI argument and run the right example
// =============================================================================

const arg = process.argv[2];

if (arg === 'bind') {
  const host = process.argv[3] || '0.0.0.0';
  if (!['0.0.0.0', '127.0.0.1'].includes(host)) {
    console.error('Usage: node code.js bind [0.0.0.0|127.0.0.1]');
    process.exit(1);
  }
  runBindingDemo(host);

} else if (arg === 'server') {
  runTCPServer();

} else if (arg === 'client') {
  runTCPClient();

} else {
  console.log(`
Lecture 02 — Code Examples
===========================

Example 1: Socket Binding (0.0.0.0 vs 127.0.0.1)
  node code.js bind 0.0.0.0       ← listen on all interfaces
  node code.js bind 127.0.0.1     ← listen on loopback only

Example 2: Raw TCP Client & Server (Layer 4 directly)
  Terminal 1: node code.js server
  Terminal 2: node code.js client
`);
}