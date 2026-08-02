# Wireshark for Backend Engineers — From Packets to Real Applications

> Wireshark is an **X-ray machine for network communication**.  
> Application logs show what the application *believes* happened; Wireshark shows what actually crossed the network interface.

This README summarizes the Wireshark labs for:

1. UDP
2. TCP and plain HTTP
3. Server-Sent Events (SSE)
4. HTTP/2 over TLS
5. MongoDB traffic

The goal is **not** to memorize every packet field. The goal is to connect backend actions—`curl`, opening a database connection, streaming events—to the TCP/IP traffic underneath them.

---

## Table of Contents

- [1. What You Must Understand](#1-what-you-must-understand)
- [2. Installing Wireshark on Windows](#2-installing-wireshark-on-windows)
- [3. The Wireshark Screen](#3-the-wireshark-screen)
- [4. Capture Filters vs Display Filters](#4-capture-filters-vs-display-filters)
- [5. The Layered Packet View](#5-the-layered-packet-view)
- [6. Lab 1 — UDP](#6-lab-1--udp)
- [7. Lab 2 — TCP and Plain HTTP](#7-lab-2--tcp-and-plain-http)
- [8. Lab 3 — Server-Sent Events](#8-lab-3--server-sent-events)
- [9. Lab 4 — HTTP2 and TLS Decryption](#9-lab-4--http2-and-tls-decryption)
- [10. Lab 5 — MongoDB](#10-lab-5--mongodb)
- [11. How Wireshark Helps a Backend Developer](#11-how-wireshark-helps-a-backend-developer)
- [12. Useful Filters](#12-useful-filters)
- [13. What You Can Ignore for Now](#13-what-you-can-ignore-for-now)
- [14. Final Cheat Sheet](#14-final-cheat-sheet)
- [15. Review Questions](#15-review-questions)
- [16. Final Five-Minute Review](#16-final-five-minute-review)

---

# 1. What You Must Understand

For your first pass, understand this flow:

```text
Application action
        ↓
The OS networking stack creates network data
        ↓
Wireshark captures that data
        ↓
Wireshark separates it into readable protocol layers
```

For most labs, recognize this lifecycle:

```text
1. Connection opens
2. Application request is sent
3. Application response is received
4. Connection remains open or closes
```

Your target is **not**:

> “I can explain every field in every Wireshark row.”

Your target is:

> “I can identify who communicated, which protocol and port were used, whether the connection opened, whether data moved, and how the connection ended.”

---

# 2. Installing Wireshark on Windows

During installation:

- Install **Npcap**. It is the packet-capture driver Wireshark needs.
- Leave **USBPcap** unchecked unless you specifically want to capture USB-device traffic.
- For a normal beginner installation, leave these Npcap options unchecked:
  - Restrict Npcap access to administrators only
  - Raw 802.11 traffic and monitor mode
  - WinPcap API-compatible mode

These options are not required for normal Wi-Fi or Ethernet traffic.

> **Disk and memory note:** Wireshark only consumes meaningful RAM while it is open and capturing. Capture files can become large, but you can stop the capture and delete them.

---

# 3. The Wireshark Screen

Wireshark has three main areas:

```text
┌─────────────────────────────────────────────────────┐
│ 1. Packet List                                      │
│    One row for each captured packet                 │
├─────────────────────────────────────────────────────┤
│ 2. Packet Details                                   │
│    Frame → Ethernet → IP → TCP/UDP → Application    │
├─────────────────────────────────────────────────────┤
│ 3. Raw Bytes                                        │
│    The actual bytes in hexadecimal and text         │
└─────────────────────────────────────────────────────┘
```

A row normally shows:

- Packet number
- Capture time
- Source
- Destination
- Protocol
- Length
- Short description

The middle pane is the most educational because it exposes the protocol layers.

---

# 4. Capture Filters vs Display Filters

These are different.

## Capture filter

A capture filter decides what Wireshark records **before** capturing.

Example:

```text
host 8.8.8.8 and udp port 53
```

Only matching traffic is collected.

## Display filter

A display filter hides unrelated packets **after** they have already been captured.

Examples:

```wireshark
udp
ip.addr == 8.8.8.8
tcp.port == 80
```

For beginner labs, it is usually easier to:

1. Capture normally.
2. Produce one small action.
3. Stop quickly.
4. Use a display filter.

---

# 5. The Layered Packet View

A captured web request may look like:

```text
Frame
└── Ethernet
    └── IPv4
        └── TCP
            └── HTTP
```

Each layer answers a different question.

| Layer | What it cares about | Example |
|---|---|---|
| Ethernet / Data Link | Next device on the local link | Source and destination MAC |
| IP / Network | End-to-end host addressing | Source and destination IP |
| TCP or UDP / Transport | Application endpoints | Source and destination ports |
| HTTP, DNS, MongoDB, etc. | Application meaning | GET request, DNS query, database command |

## The important address distinction

Suppose your laptop contacts a server on the internet:

```text
Laptop → Router → Internet → Remote server
```

The packet may contain:

```text
Destination IP  = remote server
Destination MAC = your local router
```

Why?

- The **IP address** identifies the distant destination.
- The **MAC address** identifies the next device on the current local link.
- Your laptop cannot directly send an Ethernet frame to a remote server across the internet, so it sends the frame to the default gateway.

---

# 6. Lab 1 — UDP

UDP is connectionless. There is no TCP-style handshake before sending data.

## Goal

Send a small UDP datagram to Google DNS:

```text
Destination IP:   8.8.8.8
Destination port: 53
```

Port `53` is commonly used for DNS.

## Command

On Linux/macOS with netcat:

```bash
nc -u 8.8.8.8 53
```

Then type:

```text
test
```

On Windows, an Nmap installation may provide `ncat`:

```powershell
ncat -u 8.8.8.8 53
```

## Recommended display filters

```wireshark
udp
```

or:

```wireshark
ip.addr == 8.8.8.8
```

or more specifically:

```wireshark
udp && ip.addr == 8.8.8.8 && udp.port == 53
```

## What Wireshark should show

```text
Frame
└── Ethernet
    └── IPv4
        └── UDP
            └── Data / malformed DNS
```

### Ethernet layer

Shows:

- Your network adapter's MAC address
- The next-hop MAC address, normally your router

### IPv4 layer

Shows:

- Your private source IP, such as `192.168.x.x`
- Destination IP `8.8.8.8`
- TTL
- Protocol number `17`, meaning UDP

### UDP layer

UDP has a small header:

```text
Source port
Destination port
Length
Checksum
```

The UDP header is **8 bytes**.

## Why Wireshark may call it malformed DNS

Wireshark sees destination port `53`, so it attempts to decode the payload as DNS.

But the text:

```text
test
```

is not a valid DNS query packet. Therefore, Wireshark may label it as malformed DNS.

This is expected. The lab is proving that:

```text
Application bytes
      ↓
UDP header
      ↓
IP packet
      ↓
Ethernet frame
```

## What is missing compared with TCP?

You will not see:

```text
SYN
SYN/ACK
ACK
```

UDP simply sends the datagram. Delivery, ordering, and retransmission are not guaranteed by UDP itself.

---

# 7. Lab 2 — TCP and Plain HTTP

Plain HTTP is useful in a lab because Wireshark can read it without TLS decryption.

## Command

```bash
curl http://example.com
```

## Find the destination IP

You can resolve it first:

```bash
nslookup example.com
```

Then filter using the returned IP:

```wireshark
ip.addr == <EXAMPLE_COM_IP>
```

You can also use:

```wireshark
tcp.port == 80
```

Port `80` is the default port for plain HTTP.

---

## Full connection story

```text
1. TCP handshake
2. HTTP GET request
3. HTTP response
4. TCP connection termination
```

### 1. Three-way handshake

```text
Client → Server: SYN
Server → Client: SYN, ACK
Client → Server: ACK
```

The handshake establishes a TCP connection and negotiates important TCP options.

### 2. HTTP request

`curl` sends something conceptually similar to:

```http
GET / HTTP/1.1
Host: example.com
User-Agent: curl/...
Accept: */*
```

The `Host` header matters because many websites can share one IP address.

```text
Same server IP
├── example-one.com
├── example-two.com
└── example-three.com
```

The server uses the host name to decide which website the client requested.

### 3. HTTP response

The server returns headers and body content:

```http
HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: ...
```

followed by the HTML.

### 4. Connection close

A graceful TCP close commonly uses FIN and ACK flags:

```text
Side A → Side B: FIN, ACK
Side B → Side A: ACK
Side B → Side A: FIN, ACK
Side A → Side B: ACK
```

Packets can combine flags, so the exact number of visible rows may vary.

---

## Important TCP fields

### Source and destination ports

Example:

```text
192.168.1.20:53042 → 93.184.216.34:80
```

- `53042` is a temporary client-side port.
- `80` identifies the HTTP service.
- The combination of addresses and ports helps the OS identify the connection.

A TCP connection is identified by this four-part combination:

```text
Source IP
Source port
Destination IP
Destination port
```

### Sequence numbers

TCP labels bytes with sequence numbers so it can:

- Reorder received data
- Detect missing data
- Retransmit lost data

Wireshark normally shows **relative sequence numbers** beginning around `0` to make captures readable. The real initial sequence number is usually much larger.

### Acknowledgement numbers

An ACK means:

> “I have received the TCP bytes up to this point.”

It does not necessarily mean the application has processed the request.

### Window size

The receive window is flow control:

> “This is approximately how much more data I can currently receive.”

Window scaling allows TCP to advertise windows larger than the original 16-bit field can represent.

### MSS

The Maximum Segment Size tells the peer the largest TCP payload this endpoint wants in one segment.

A common Ethernet setup is:

```text
MTU = 1500 bytes
IPv4 header = 20 bytes
TCP header  = 20 bytes
Typical MSS = 1460 bytes
```

Options can increase header sizes, so real packet layouts vary.

### TTL

TTL limits how many router hops an IP packet can survive.

Each router normally decrements it:

```text
64 → 63 → 62 → ...
```

When it reaches zero, the packet is discarded.

TTL is not measured in seconds despite the historical name **Time To Live**.

---

## A useful backend debugging interpretation

Consider:

```text
Request sent:        10:00:00.100
Request ACKed:       10:00:00.110
Response begins:     10:00:04.500
```

The network delivered the request quickly, but the backend waited about 4.4 seconds before responding.

That suggests:

```text
Likely backend/database/application delay
not basic network-delivery delay
```

---

# 8. Lab 3 — Server-Sent Events

Server-Sent Events allow a server to keep one HTTP response open and continuously send text events to the client.

## Normal HTTP

```text
Client: Give me data.
Server: Here is the response.
Request finishes.
```

## SSE

```text
Client: Open an event stream.
Server: Event 1
Server: Event 2
Server: Event 3
...
```

SSE is mainly **server → client** at the application layer.

TCP ACKs still travel from the client to the server, but those acknowledgements are transport-layer behavior—not application messages.

---

## Server code from the lab

```js
const app = require("express")();

app.get("/", (req, res) => {
  res.send("hello!");
});

app.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  send(res);
});

const port = process.env.PORT || 8888;
const serverName = process.env.SERVER_NAME || "sample";

let i = 0;

function send(res) {
  res.write(`data: hello from ${serverName} ---- [${i++}]\n\n`);
  setTimeout(() => send(res), 1000);
}

app.listen(port);
console.log(`Listening on ${port}`);
```

## Zero-backend explanation

- **Node.js** runs JavaScript outside the browser.
- **Express** is a small web-server framework.
- `app.get("/stream", ...)` creates an HTTP endpoint.
- `res.setHeader(...)` sets an HTTP response header.
- `res.write(...)` sends another piece of the still-open response.
- `setTimeout(...)` schedules the next event after one second.

## Install and run

Inside the SSE project:

```bash
npm install
node index.js
```

Then:

```bash
curl http://localhost:8888/stream
```

The output continues:

```text
data: hello from sample ---- [0]

data: hello from sample ---- [1]

data: hello from sample ---- [2]
```

The blank line after each `data:` line marks the end of one SSE event.

---

## Browser client

```js
const sse = new EventSource("http://localhost:8888/stream");

sse.onmessage = (event) => {
  console.log(event.data);
};
```

`EventSource` is the browser API for consuming SSE.

---

## What Wireshark shows

```text
1. SYN
2. SYN/ACK
3. ACK
4. GET /stream
5. HTTP response headers
6. Repeated server data
7. Client TCP ACKs
8. Connection close when curl is stopped
```

The crucial response header is:

```http
Content-Type: text/event-stream
```

The server may also send:

```http
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

In HTTP/1.1, chunked transfer is common for streaming because the final response size is unknown.

However:

> SSE is defined by the `text/event-stream` format and long-lived HTTP response. Chunked encoding is a transport mechanism, not the definition of SSE.

---

## SSE packet boundaries

TCP is a byte stream. Therefore:

```text
One SSE event may be split across multiple TCP segments.
Multiple SSE events may appear in one TCP segment.
```

An application must parse the byte stream according to SSE rules. It must not assume that one Wireshark packet equals one application event.

---

## Optional HAProxy configuration from the lab

```haproxy
frontend sse
    bind *:8080
    timeout client 3s
    mode http
    use_backend allsse

backend allsse
    mode http
    timeout connect 2s
    timeout server 6000s
    server server1 localhost:1111
    server server2 localhost:2222
    server server3 localhost:3333
```

### What this means

HAProxy listens on port `8080` and forwards requests to one of three backend SSE servers.

```text
Client
   ↓
HAProxy :8080
   ├── server1 :1111
   ├── server2 :2222
   └── server3 :3333
```

The long server timeout matters because SSE connections are intentionally long-lived.

> **Helpful context:** Real production SSE configurations also need careful timeout, buffering, health-check, and reconnect handling. The lecture example is a minimal demonstration.

---

## SSE versus WebSockets

| SSE | WebSocket |
|---|---|
| Mainly server → client | Full two-way communication |
| Uses HTTP streaming | Uses the WebSocket protocol after an upgrade |
| Text events | Text or binary frames |
| Browser `EventSource` can reconnect automatically | Reconnection is usually application-managed |
| Good for feeds, notifications and logs | Good for chat, games and highly interactive systems |

Do not memorize “SSE is always lighter.” Actual overhead depends on message sizes, frequency, framing and infrastructure.

---

# 9. Lab 4 — HTTP2 and TLS Decryption

HTTP/2 supports multiple logical streams over one TCP connection.

```text
One TCP connection
├── Stream 1: request/response A
├── Stream 3: request/response B
├── Stream 5: request/response C
└── Stream 0: connection-control frames
```

In normal web use, HTTP/2 is commonly carried over TLS, so Wireshark initially shows mostly encrypted TLS application data.

---

## Important clarification

HTTP/2 is not inherently encrypted in the protocol specification; cleartext HTTP/2 (`h2c`) exists.

However, mainstream browsers normally use HTTP/2 over TLS, which is why real browser captures usually appear encrypted.

---

## Export TLS session secrets

Applications such as browsers and supported `curl` builds can write TLS session secrets to a key-log file.

### Linux/macOS

```bash
export SSLKEYLOGFILE="$HOME/tls-keys.log"
curl --http2 https://example.com
```

### Windows PowerShell

```powershell
$env:SSLKEYLOGFILE = "$HOME\tls-keys.log"
curl.exe --http2 https://example.com
```

Then configure Wireshark:

```text
Edit
→ Preferences
→ Protocols
→ TLS
→ (Pre)-Master-Secret log filename
→ Select tls-keys.log
```

Capture again. Wireshark may now decode HTTP/2 frames.

> **Security warning:** The key-log file allows captured TLS sessions to be decrypted. Use it only for your own debugging lab, protect it, and delete it afterward.

---

## Self-signed certificates

The lecture used `curl -k` / `--insecure` because the lab server had a self-signed certificate:

```bash
curl -k --http2 https://raspberrypi1/
```

`-k` disables certificate verification.

Use it only in a controlled lab. It should not become the normal production solution for certificate errors.

---

## TLS and HTTP/2 negotiation

During the TLS handshake, the client and server can negotiate the application protocol using ALPN.

Conceptually:

```text
Client: I support h2 and http/1.1
Server: Use h2
```

After that, HTTP/2 frames travel inside the encrypted TLS connection.

---

## HTTP/2 connection preface

The client begins HTTP/2 communication with this fixed byte sequence:

```text
PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n
```

Its hexadecimal form is:

```text
0x505249202a20485454502f322e300d0a0d0a534d0d0a0d0a
```

It was deliberately chosen so many HTTP/1.x-only servers and intermediaries will reject it instead of misinterpreting later HTTP/2 frames.

> **Correction:** The connection preface is not an ordinary HTTP/2 stream. It is a special sequence sent at the beginning of the connection.

---

## Stream identifiers

HTTP/2 stream identifiers are 31-bit integers.

```text
Stream 0 → connection-control messages only
Odd IDs  → streams initiated by the client
Even IDs → streams initiated by the server
```

That is why client requests commonly use:

```text
1, 3, 5, 7, ...
```

The second client request uses stream `3`, not `2`.

---

## Stream 0

Stream `0` cannot carry a normal request/response stream.

It is used for connection-level frames such as:

```text
SETTINGS
WINDOW_UPDATE
GOAWAY
```

Examples of settings include:

- Maximum concurrent streams
- Initial flow-control window size
- Maximum frame size

---

## One request in Wireshark

A simple HTTP/2 GET may appear conceptually as:

```text
TCP handshake
TLS handshake + ALPN
HTTP/2 connection preface
SETTINGS on stream 0
HEADERS on stream 1
HEADERS response on stream 1
DATA response on stream 1
Connection close
```

HTTP/2 uses pseudo-headers such as:

```text
:method    GET
:path      /
:scheme    https
:authority raspberrypi1
```

---

## Multiplexing

With HTTP/1.1, concurrent requests can require multiple connections or careful request ordering.

HTTP/2 can interleave frames from different streams:

```text
TCP connection
│
├── Stream 1 HEADERS
├── Stream 3 HEADERS
├── Stream 1 DATA
├── Stream 3 DATA
├── Stream 1 DATA
└── Stream 3 DATA
```

Each response is matched to its request using the stream ID.

This removes HTTP/1.1 application-layer head-of-line ordering between requests on the same connection, although packet loss can still block all streams temporarily at the TCP layer.

---

# 10. Lab 5 — MongoDB

MongoDB is a **document-oriented NoSQL database**. Documents are stored in a BSON format, which is related to JSON but supports additional data types.

A backend normally communicates with MongoDB through a language driver:

```text
Your Node.js code
      ↓
MongoDB Node.js driver
      ↓
MongoDB wire protocol
      ↓
TCP
      ↓
MongoDB server
```

---

## Code from the uploaded lab

```js
require("sslkeylog").hookAll();

const MongoClient = require("mongodb").MongoClient;
const uri = "mongodb://localhost:27017";

const client = new MongoClient(uri, { useNewUrlParser: true });

connect();

async function connect() {
  try {
    await client.connect({ useNewUrlParser: true });
    await sleep(1000);

    const db = client.db("thunderbolt");
    console.log(`Connected to database ${db.databaseName}`);

    const employees = db.collection("employees");

    const searchCursor = employees.find({ name: "Hussein" });
    const result = await searchCursor.next();

    // Alternative:
    // const result = await searchCursor.toArray();

    console.table(result);

    await client.close();
    await sleep(1000);

    console.log("closed.");
    process.exit();
  } catch (error) {
    console.error(error.toString());
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
```

---

## What each line means

### Create a client

```js
const client = new MongoClient(uri);
```

This creates the driver object that knows how to communicate with MongoDB.

### Connect

```js
await client.connect();
```

The driver opens or obtains network connections and performs the required MongoDB handshake and authentication steps.

### Select a database

```js
const db = client.db("thunderbolt");
```

This creates a JavaScript handle representing the database.

It does not mean that the entire database was downloaded.

### Select a collection

```js
const employees = db.collection("employees");
```

This creates a handle representing the collection.

### Build a query cursor

```js
const searchCursor = employees.find({ name: "Hussein" });
```

A cursor represents query results that can be consumed gradually.

### Consume the cursor

```js
const result = await searchCursor.next();
```

or:

```js
const result = await searchCursor.toArray();
```

Consuming the cursor is when the driver needs actual results from the server.

---

## Lazy execution

The important observation from the lecture is:

```text
db(...)
collection(...)
find(...)
```

can mostly prepare client-side objects without immediately requiring all result data from the network.

The query becomes useful when the cursor is consumed:

```text
next()
toArray()
for await (...)
```

This lets the driver combine and delay work rather than creating unnecessary network round trips for every intermediate JavaScript line.

---

## Important cursor correction

`next()` does **not necessarily perform one network round trip for every document**.

MongoDB usually returns results in **batches**:

```text
Server sends a batch of documents
        ↓
next() reads documents from the local batch
        ↓
Driver requests another batch only when required
```

`toArray()` asks the driver to collect all results into memory, while iterative cursor consumption can process results gradually.

Use `toArray()` carefully when a query can return a very large number of documents.

---

## What Wireshark may show

A remote TLS-enabled MongoDB connection may include:

```text
1. TCP handshake
2. TLS handshake
3. MongoDB hello / topology discovery
4. Authentication exchange
5. Query command
6. Query response / cursor batch
7. Background driver messages
8. Connection close or return to pool
```

The driver may perform work that your code did not explicitly write, including:

- Discovering available replica-set members
- Selecting a suitable server
- Authenticating
- Monitoring topology
- Maintaining sessions
- Sending metadata about the driver
- Ending sessions during shutdown

That is normal: a database driver is an active networking component, not merely a function that converts JavaScript into text.

---

## Replica set versus shard

These terms are different:

### Replica set

Multiple MongoDB nodes store copies of the same data for availability.

```text
Primary
├── Secondary
└── Secondary
```

### Sharded cluster

Different shards store different portions of a larger dataset.

```text
Shard A → part of the data
Shard B → another part
Shard C → another part
```

A three-node Atlas deployment is not automatically “three shards.” It may instead be a replica set.

---

## MongoDB authentication

The transcript observed a SASL/SCRAM exchange.

- **SASL** is a framework for authentication mechanisms.
- **SCRAM** means Salted Challenge Response Authentication Mechanism.
- The client and server prove knowledge of credentials without simply sending the raw password as plain text.

The exact messages depend on MongoDB version, driver version, configuration and authentication mechanism.

---

## TLS decryption caveat

The transcript used a remote encrypted Atlas connection and a TLS key-log mechanism so Wireshark could decode MongoDB traffic.

The uploaded code currently uses:

```js
mongodb://localhost:27017
```

A local MongoDB connection is not necessarily using TLS unless TLS was configured explicitly.

Therefore:

```text
Remote Atlas lecture capture → encrypted TLS traffic
Uploaded localhost code       → may be plaintext local traffic
```

Do not assume that loading `sslkeylog` automatically makes a non-TLS MongoDB connection encrypted.

---

## Why connection pooling matters

Opening a database connection can involve:

```text
TCP handshake
+ TLS handshake
+ topology discovery
+ authentication
+ server selection
```

Doing that for every API request is wasteful.

A backend should normally reuse a MongoDB client or connection pool:

```text
Backend starts
      ↓
Create MongoClient once
      ↓
Reuse pooled connections for many requests
      ↓
Close during application shutdown
```

Avoid:

```text
For every incoming HTTP request:
    connect()
    query()
    close()
```

Prefer:

```text
At application startup:
    connect once

For every request:
    reuse the existing client/pool
```

This is one of the most important backend lessons from the MongoDB capture.

---

# 11. How Wireshark Helps a Backend Developer

Wireshark helps answer questions that logs alone cannot always answer.

## Did the client reach the server?

```text
SYN →
← SYN/ACK
ACK →
```

Yes, TCP opened successfully.

## Is the destination port closed?

```text
SYN →
← RST
```

The host responded, but no service accepted the connection on that port, or a device actively rejected it.

## Is traffic being silently dropped?

```text
SYN →
SYN →
SYN →
```

No response may indicate packet loss, filtering, wrong routing, unreachable host, or a silent firewall.

## Did the backend receive the request but respond slowly?

```text
Request sent and ACKed quickly
Long silence
Response finally arrives
```

The delay may be inside the backend, database, or another downstream service.

## Is the connection being reset?

Use:

```wireshark
tcp.flags.reset == 1
```

A reset means the connection was aborted rather than closed gracefully.

## Are packets being retransmitted?

Use:

```wireshark
tcp.analysis.retransmission
```

Retransmissions may indicate loss, severe delay, duplicate traffic, or capture-analysis artifacts.

---

# 12. Useful Filters

## General protocols

```wireshark
dns
udp
tcp
http
http2
tls
mongodb
```

## Host filters

```wireshark
ip.addr == 8.8.8.8
ip.src == 192.168.1.10
ip.dst == 93.184.216.34
```

## Port filters

```wireshark
udp.port == 53
tcp.port == 80
tcp.port == 443
tcp.port == 27017
```

## TCP lifecycle

```wireshark
tcp.flags.syn == 1
tcp.flags.fin == 1
tcp.flags.reset == 1
```

## TCP analysis

```wireshark
tcp.analysis.retransmission
tcp.analysis.duplicate_ack
tcp.analysis.out_of_order
```

## Combine expressions

```wireshark
tcp && ip.addr == 93.184.216.34
```

```wireshark
udp && ip.addr == 8.8.8.8 && udp.port == 53
```

```wireshark
tcp.port == 443 && tls
```

---


# 13. What You Can Ignore for Now

You do **not** need to memorize:

- Exact TCP sequence numbers
- Every TCP flag
- TCP timestamp mathematics
- Every TLS cipher suite
- Every MongoDB handshake field
- Every HTTP/2 setting
- Raw hexadecimal bytes
- Exact packet sizes
- All Wireshark warnings
- Why every packet was grouped or reassembled
- Advanced MTU black-hole debugging
- Every internal database-driver command

Recognize these first:

```text
SYN / SYN-ACK / ACK
Source and destination IP
Source and destination port
HTTP request and response
Repeated stream data
FIN or RST
TLS means application content is encrypted
```

Return to advanced details when a real problem requires them.

---

# 14. Final Cheat Sheet

## UDP

```text
No handshake
Small 8-byte header
No built-in delivery guarantee
No built-in ordering guarantee
DNS commonly uses UDP port 53
IP protocol number = 17
```

## TCP

```text
Connection-oriented
Three-way handshake
Reliable ordered byte stream
Sequence numbers
Acknowledgements
Flow control
Graceful FIN close or abrupt RST
IP protocol number = 6
```

## HTTP/1.1

```text
Plain HTTP default port = 80
HTTPS default port = 443
GET /path
Host: example.com
Request → response
```

## SSE

```text
Long-lived HTTP response
Content-Type: text/event-stream
Main application direction: server → client
Events separated by a blank line
Browser client: EventSource
```

## HTTP/2

```text
Multiple streams on one TCP connection
Stream 0 = connection control
Client streams = odd IDs
Server streams = even IDs
Commonly used over TLS
ALPN negotiates h2
```

## MongoDB

```text
Document-oriented database
Driver communicates using MongoDB wire protocol
Connect/authenticate/query can produce many network messages
Cursors are consumed with next(), toArray(), iteration, etc.
Results are normally fetched in batches
Reuse connection pools
```

## Wireshark's core value

```text
Logs:      What the program thinks happened
Wireshark: What travelled across the interface
```

---

# 15. Review Questions

1. What is the difference between a capture filter and a display filter?
2. Why can the destination IP belong to a remote server while the destination MAC belongs to your router?
3. Why did Wireshark label the text sent to UDP port 53 as malformed DNS?
4. What are the three packets in the TCP opening handshake?
5. What does a TCP ACK prove, and what does it not prove?
6. Why does SSE keep the HTTP response open?
7. Which response header identifies an SSE stream?
8. Why can one SSE event appear across several TCP packets?
9. Why is most HTTP/2 traffic unreadable in Wireshark before TLS keys are provided?
10. What is HTTP/2 stream `0` used for?
11. Why are common client-created HTTP/2 stream IDs `1`, `3`, and `5`?
12. Why can selecting a MongoDB database or collection require no immediate database result?
13. What is the difference between `cursor.next()` and `cursor.toArray()`?
14. Why should a backend reuse a MongoDB connection pool?
15. What capture pattern might indicate a closed port?
16. What capture pattern might indicate silent packet dropping?
17. What is the difference between FIN and RST?

---

# 16. Final Five-Minute Review

- Wireshark captures traffic crossing a network interface.
- Npcap is required on Windows for normal packet capture.
- A display filter hides already captured packets.
- Ethernet contains local-link MAC addresses.
- IP contains source and destination host addresses.
- TCP/UDP contains source and destination ports.
- UDP sends without a connection handshake.
- TCP starts with `SYN → SYN/ACK → ACK`.
- Plain HTTP can be read directly; HTTPS is encrypted.
- A TCP ACK confirms received bytes, not completed backend work.
- SSE is one HTTP response kept open for repeated server events.
- HTTP/2 multiplexes multiple streams over one TCP connection.
- HTTP/2 client streams use odd IDs; stream `0` is for connection control.
- MongoDB drivers perform more network work than the visible query line suggests.
- Database connections are expensive enough that backends normally pool and reuse them.
- You do not need to understand every packet field on the first pass.
- First learn to recognize connection opening, data movement, delay, and connection closing.

---

## Source Materials Used

- Wireshark UDP lecture transcript
- Wireshark TCP and plain HTTP lecture transcript
- Wireshark Server-Sent Events lecture transcript
- Wireshark HTTP/2 lecture transcript and HTTP/2 notes
- Wireshark MongoDB lecture transcript
- Uploaded SSE Express example and HAProxy configuration
- Uploaded MongoDB Node.js examples
