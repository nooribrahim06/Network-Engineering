# Backend Networking Performance: TCP, Proxies, Load Balancers, and Safe Databases

### From a socket call to a database row and back — with every delay explained

---

> [!NOTE]
> This is not a glossary. It is one path, walked start to finish:
>
> ```text
> Client application
>     -> socket -> TCP -> IP -> local link
>     -> routers and proxies
>     -> backend listening socket -> backend code
>     -> database connection
> ```
>
> Every section below is a place on that path where performance can be won or lost.

---

## Table of Contents

- [Part 1 — The Stack, the Packet, and the Path](#part-1--the-stack-the-packet-and-the-path)
  - [1. The layer map we actually use](#1-the-layer-map-we-actually-use)
  - [2. MTU, MSS, and why packet size matters](#2-mtu-mss-and-why-packet-size-matters)
- [Part 2 — Congestion, Nagle, and the Real Cost of a Connection](#part-2--congestion-nagle-and-the-real-cost-of-a-connection)
  - [3. Congestion control vs. flow control](#3-congestion-control-vs-flow-control)
  - [4. Nagle's algorithm and delayed ACK](#4-nagles-algorithm-and-delayed-ack--two-good-ideas-that-fight-each-other)
  - [5. The real cost of a TCP connection](#5-the-real-cost-of-a-tcp-connection)
  - [6. Persistent connections and connection pooling](#6-persistent-connections-and-connection-pooling)
- [Part 3 — Startup, Fast Open, and Listening Sockets](#part-3--startup-fast-open-and-listening-sockets)
  - [7. Backend startup: eager vs. lazy loading](#7-backend-startup-eager-vs-lazy-loading)
  - [8. TCP Fast Open (TFO)](#8-tcp-fast-open-tfo)
  - [9. Listening servers: what "listen" really means](#9-listening-servers-what-listen-really-means)
  - [10. TCP head-of-line blocking](#10-tcp-head-of-line-blocking)
- [Part 4 — Proxies, Meshes, and Load Balancers](#part-4--proxies-meshes-and-load-balancers)
  - [11. Forward proxy vs. reverse proxy](#11-forward-proxy-vs-reverse-proxy)
  - [12. Service mesh, sidecars, and retries](#12-service-mesh-sidecars-and-retries)
  - [13. Load balancer from zero](#13-load-balancer-from-zero)
  - [14. Layer 4 load balancing](#14-layer-4-load-balancing)
  - [15. Layer 7 load balancing](#15-layer-7-load-balancing) — includes API gateway behavior & JWT auth
- [Part 5 — Databases, Safely](#part-5--databases-safely)
  - [16. Databases from zero](#16-databases-from-zero)
- [Full Flow — One Complete Backend Request](#full-flow--one-complete-backend-request)
- [Compact Memory Sheet](#compact-memory-sheet)
- [Selected Commands and Snippets](#selected-commands-and-snippets)
- [Checklist — What You Should Know After This](#checklist--what-you-should-know-after-this)
- [Sources used in this chapter](#sources-used-in-this-chapter)

---

# Part 1 — The Stack, the Packet, and the Path

## 1. The layer map we actually use

> **Analogy:** think of a letter mailed across the world — the street address, the postal sorting code, and the actual message inside are handled by different people who don't need to read each other's part.

Seven OSI layers exist, but backend work really only needs five questions:

| Practical layer | Main question | Examples |
|---|---|---|
| Application | What does the message *mean*? | HTTP, DNS, gRPC, PostgreSQL protocol |
| Transport | Which process, and how is data delivered? | TCP, UDP, ports |
| Network | Which host, across networks? | IP, routing, ICMP |
| Data Link | Which next device on *this* local link? | Ethernet, Wi-Fi, MAC, ARP |
| Physical | How do the bits physically move? | Radio, electricity, light |

![Devices operate only as high in the stack as they need](imgs/layers-across-network.png)

> [!NOTE]
> 📸 The diagram shows the rule that matters most in this chapter: the **client** and **backend server** run the full stack, a **Layer 4 proxy/firewall** only needs Transport and below, and a **Layer 7 load balancer/CDN** climbs all the way to Application. That's the entire reason "Layer 4 vs Layer 7" load balancing exists — later sections build directly on this picture.

**Backend relevance:** when someone says "the load balancer doesn't understand HTTP," this table is why — it never climbed past Transport.

### Encapsulation, in both directions

```text
Application data
    -> TCP segment
        -> IP packet
            -> Ethernet/Wi-Fi frame
                -> physical signals
```

The receiver unwraps the same way:

```text
Frame
└── IP packet
    └── TCP segment
        └── application data
```

### The three addresses to remember

```text
Port -> process or socket
IP   -> host and network
MAC  -> next interface on the current local link
```

A TCP connection is identified by its **four-tuple**:

```text
source IP + source port + destination IP + destination port
```

```text
10.0.0.1:5555 -> 10.0.0.2:8080
```

> [!IMPORTANT]
> The four-tuple *is* the connection. Change any one of the four values and TCP considers it a different connection — this comes back hard in §5 (switching networks) and §14 (load balancer stickiness).

---

## 2. MTU, MSS, and why packet size matters

### MTU: the Layer 3 size limit of a link

> **Analogy:** MTU is the size of the biggest box a delivery truck on a given road is allowed to carry — a bigger truck on a highway doesn't help if a side street only allows small trucks.

**MTU (Maximum Transmission Unit)** is usually quoted as `1500` for Ethernet — but that 1500 is the IP packet carried *inside* the frame, not the whole frame including headers.

> [!WARNING]
> It's common to casually say "MTU is the frame size." It isn't — an Ethernet MTU of 1500 refers to the Layer 3 packet inside the frame. The Ethernet header/trailer sit outside that limit.

```text
Normal Ethernet:     often 1500 bytes
Jumbo-frame network: often ~9000 bytes
Tunnel/VPN link:     often lower — the tunnel adds its own headers
```

### MSS: the actual TCP payload budget

**MSS (Maximum Segment Size)** limits the TCP *data* portion only, not the whole segment.

```text
MTU              = 1500 bytes
IPv4 header      =   20 bytes
TCP header       =   20 bytes
--------------------------------
TCP MSS          = 1460 bytes
```

![How the frame, IP packet, TCP segment, and MSS fit together](imgs/network-performance-page-06.png)

> [!NOTE]
> 📸 Reading outward from PAYLOAD: TCP MSS (1460) sits inside the IP MTU (1480, IP header included), which sits inside the HW MTU (1500, L2 header + trailer included). Segment ⊂ IP Packet ⊂ Frame — same data, three names depending on which header boundary you're measuring from.

So a 1460-byte payload becomes:

```text
1460 bytes application data
+  20 bytes TCP header
+  20 bytes IPv4 header
= 1500-byte IP packet
```

**Backend relevance:** this is the number curl, browsers, and your own sockets are silently respecting on every write — it's why chunking large responses doesn't cost as much as you'd think.

### Why not always use giant packets?

Bigger packets mean less per-packet header overhead, but:

- Every device on the path must actually support the size.
- A lost large packet costs more to retransmit.
- Oversized packets may get fragmented on a later, smaller-MTU link.

### IP fragmentation — and why it's avoided

If a packet is too big for a link, IPv4 can split it into fragments. This is bad because:

- **Every** fragment must arrive before reassembly is possible.
- Losing one fragment effectively loses the whole original packet.
- It's historically been a source of security and reliability bugs.

Modern stacks actively try to avoid it.

### Path MTU Discovery (PMTUD)

> **Analogy:** it's like a truck driver discovering the low bridge only when they hit it — then getting redirected to use smaller trucks for that route from now on.

The sender doesn't control every hop to the destination. The smallest MTU anywhere on the route is the **Path MTU**.

![Path MTU Discovery finds the smallest supported MTU](imgs/network-performance-page-07.png)

> [!NOTE]
> 📸 The client's MTU is 9000, but the path narrows to 1500 then 512 across two hops before reaching a peer at 1500. PMTUD's job is to find that 512 bottleneck *before* it silently drops your traffic.

```mermaid
sequenceDiagram
    participant S as Sender
    participant R as Router (smaller MTU)
    S->>R: IP packet, DF flag set
    R--xR: Packet too big to forward, can't fragment (DF set)
    R->>S: ICMP "Fragmentation Needed"
    S->>S: Lower packet size, retry
```

For IPv6, routers never fragment forwarded packets — an oversized packet triggers ICMPv6 **Packet Too Big** instead.

### ICMP, quick reference

**ICMP** is Layer 3's error/status channel — it doesn't carry your application's business data.

```text
ping                       -> Echo Request / Echo Reply
TTL reaches zero           -> Time Exceeded
Destination cannot be used -> Destination Unreachable
Packet is too large        -> Fragmentation Needed / Packet Too Big
```

---

# Part 2 — Congestion, Nagle, and the Real Cost of a Connection

## 3. Congestion control vs. flow control

| Mechanism | Protects | Main question |
|---|---|---|
| Flow control | The receiver | Can the receiver's buffer accept more? |
| Congestion control | The network path | Can the network carry more without collapsing? |

### TCP slow start

> **Analogy:** merging onto an unfamiliar highway — you don't floor it immediately, you accelerate gradually while reading how the traffic actually behaves.

A new connection doesn't know the path's safe capacity. It starts with a small congestion window and grows it as ACKs confirm delivery.

```text
New connection
    -> send a limited amount
    -> ACKs return successfully
    -> increase in-flight data allowed
    -> keep learning the path
```

> [!IMPORTANT]
> "Slow" is relative — growth can actually be fast. The real cost is that a **brand-new** connection can't immediately use the capacity a long-lived, already-tested connection has earned. That's the whole argument for connection reuse in §6.

**Backend relevance:** this is one reason opening a fresh HTTP connection per request is slower than it looks on paper — you're paying the slow-start tax every single time.

---

## 4. Nagle's algorithm and delayed ACK — two good ideas that fight each other

Both mechanisms exist to cut down on wasteful tiny packets. Together, they can create real latency.

### Nagle's algorithm: the sender may wait

> **Analogy:** not mailing a postcard the instant you write one word on it — you wait to see if you'll have more to say before the envelope goes out, since postage costs the same either way.

Sending one byte of data with ~40 bytes of IPv4+TCP header overhead is wasteful. Nagle's rule, roughly:

```text
If there is no unacknowledged data in flight:
    send now
Else if new data fills a full MSS-sized segment:
    send the full segment
Else:
    buffer the small write and wait
```

The buffered data goes out when either an ACK arrives for the outstanding data, or enough new data arrives to fill a segment.

Example — `MSS = 1460`, application writes 5000 bytes:

```text
Segment 1: 1460 bytes - full, send
Segment 2: 1460 bytes - full, send
Segment 3: 1460 bytes - full, send
Remaining:   620 bytes - small, may be held
```

![A small final segment may wait for an ACK under Nagle's algorithm](imgs/network-performance-page-12.png)

> [!NOTE]
> 📸 A wants to send 5000 bytes. Three full 1460-byte segments go out immediately; the final 620 bytes wait — not because of a timer, but because older data from A is still unacknowledged. The moment B's ACK arrives, the 620 bytes are released.

> [!IMPORTANT]
> The ACK is not "permission for segment 4" — its arrival simply removes the condition ("outstanding data exists") that was holding segment 4 back.

**Disabling it — `TCP_NODELAY`:**

Low-latency apps (like `curl`, by default in common builds) disable Nagle so small writes go out immediately.

```js
// Node.js — turn off Nagle's buffering for this socket
socket.setNoDelay(true);
```

```c
// C — same effect via setsockopt
#include <netinet/tcp.h>
#include <sys/socket.h>

int enabled = 1;
setsockopt(socket_fd, IPPROTO_TCP, TCP_NODELAY, &enabled, sizeof(enabled));
// socket_fd = your TCP socket
// IPPROTO_TCP = we're setting a TCP-level option
// TCP_NODELAY = disable Nagle's algorithm on this socket
```

### Delayed ACK: the receiver may wait too

> **Analogy:** waiting a beat before replying to a text, in case the sender fires off a second message right after — one reply covers both.

TCP ACKs are cumulative, so a receiver may briefly delay acknowledging, hoping to cover more data in one ACK.

```text
Receive segment 1
Wait briefly for segment 2
Send one cumulative ACK for both
```

> [!NOTE]
> The receiver has no actual signal that more data is coming — it's a blind, timer-based bet, not a prediction. The real mechanism:
>
> ```text
> Receive segment 1
> Start a timer (commonly ~40ms, capped roughly 200-500ms depending on OS/stack)
>     -> segment 2 arrives before timer expires: send one ACK covering both
>     -> timer expires first: send the ACK for segment 1 alone, late
> ```
>
> And the receiver doesn't delay *every* ACK — per RFC 1122 / RFC 5681, it ACKs immediately when either of these happen:
>
> ```text
> Two full-sized segments received back-to-back -> ACK immediately
> An out-of-order segment arrives                -> ACK immediately
> Otherwise                                        -> hold, start/reset the delay timer
> ```
>
> So delayed ACK mainly bites on **small, sparse writes** — the exact case Nagle also triggers on. That overlap is *why* the two mechanisms interact so badly: both are independent heuristics guessing "more is probably coming," and both guess wrong at the same time.

Linux software can request quicker ACKs with `TCP_QUICKACK`:

```c
// Linux-specific — request faster ACK behavior (a request, not a guarantee)
int enabled = 1;
setsockopt(socket_fd, IPPROTO_TCP, TCP_QUICKACK, &enabled, sizeof(enabled));
```

### Why Nagle + delayed ACK together can be painful

```text
Sender:   "I have a small segment, but Nagle says wait for an ACK."
Receiver: "I'll delay my ACK in case more data is coming."
```

Both sides end up waiting on each other until the delayed-ACK timer finally expires.

![Nagle and delayed ACK can make both endpoints wait](imgs/network-performance-page-16.png)

> [!WARNING]
> 📸 This combination has historically produced delays around **400ms** in real systems — a classic, hard-to-diagnose latency spike. If you see mysterious ~200–400ms stalls on small writes over TCP, this pairing is a prime suspect.

**Backend relevance:** if your API feels randomly slow on small POST bodies or chatty protocols, check `TCP_NODELAY` before you suspect anything else.

---

## 5. The real cost of a TCP connection

Opening a connection is never free. A fresh one may pay for:

1. DNS resolution (if resolving a hostname)
2. The TCP three-way handshake
3. A TLS handshake, for HTTPS
4. Application/database authentication
5. TCP slow start, while path capacity is learned
6. Memory, buffers, socket state, and file descriptors on both ends

The farther apart the endpoints, the more expensive every required round trip.

### How long does an open connection stay open?

TCP doesn't close itself just because no data is currently moving.

```text
Open connection != continuous traffic
```

It stays open until something ends it:

- one side calls `close()`
- an idle timeout expires
- a proxy/firewall/LB drops idle state
- a process restarts or crashes
- the network changes or fails
- keepalive probes eventually detect a dead peer

### Why switching Wi-Fi to mobile data breaks ordinary TCP

A connection is tied to its four-tuple. Switching networks usually changes your source IP (and often port and route).

```text
Old Wi-Fi:    public-Wi-Fi-IP:53000 -> server:443
After switch: carrier-IP:61000      -> server:443
```

That's a different four-tuple — ordinary TCP can't just continue the old connection. QUIC was built with connection migration to handle exactly this.

---

## 6. Persistent connections and connection pooling

### Persistent connection

> **Analogy:** keeping one phone call open for a whole conversation instead of hanging up and redialing after every sentence.

```text
Bad:    open -> request -> close  (repeated every time)
Better: open -> request -> request -> request -> close later
```

This skips repeated handshakes and keeps a connection that's already past slow start.

### Connection pooling

A **connection pool** is a managed set of already-open connections — commonly to a database.

```text
Without pooling, every request:
    open DB connection -> authenticate -> query -> close

With pooling:
    Pool: [conn1: free] [conn2: busy] [conn3: free]
    Request: borrow conn1 -> run SQL -> return conn1 to pool
```

Returning a connection to the pool does **not** close it. The pool also protects the database from being overwhelmed by unbounded connection creation — when everything's busy, new requests wait, time out, or hit an overflow policy.

### Reverse proxies pool too

```text
Clients -> reverse proxy -> pool of warm backend connections
```

This stops every client request from forcing a fresh proxy-to-backend handshake.

**Backend relevance:** if your app opens a new DB connection per request, connection pooling is very likely the single highest-leverage performance fix available to you.

---

# Part 3 — Startup, Fast Open, and Listening Sockets

## 7. Backend startup: eager vs. lazy loading

A backend is a long-running process. Startup is the one-time prep phase before it's ready to serve traffic:

```text
1. OS creates the process
2. Runtime starts (Node.js, Python, etc.)
3. Source files and libraries load
4. Configuration is read
5. Database pools and other resources may be created
6. Server binds a listening socket
7. Enters an event loop, waits for requests
```

```js
// The event loop model frameworks implement for you
while (serverIsRunning) {
    const request = await waitForRequest();
    handle(request);
}
```

The process runs until terminated, crashed, restarted by a deploy, or the machine shuts down. Graceful shutdown: stop accepting new work, finish in-flight requests, close pools, exit.

### Eager loading

> **Analogy:** a restaurant prepping all its ingredients before opening — customers get fast service, but opening takes longer.

```text
Backend starts -> open 10 DB connections -> load config/caches -> begin accepting requests
```

Trade-off: **slower startup, faster first request**, resources reserved before needed.

### Lazy loading

> **Analogy:** the same restaurant preparing each dish only when it's ordered — opens the doors instantly, but the first customer waits longer.

```text
Backend starts quickly -> first DB request arrives -> create pool -> execute
```

Trade-off: **faster startup, slower first use**, nothing consumed unless needed.

```text
Eager: pay the preparation cost during startup.
Lazy:  pay the preparation cost during first use.
```

**Backend relevance:** serverless/autoscaled backends usually favor lazy loading (cold starts are already slow); long-running services with predictable traffic usually favor eager.

---

## 8. TCP Fast Open (TFO)

A normal handshake sends no application data until it's mostly done:

```text
Client -> SYN
Client <- SYN-ACK
Client -> ACK + application data
```

**TFO** lets a *returning* client include early data right in the SYN:

```text
Client -> SYN + TFO cookie + data
Client <- SYN-ACK + possible response
Client -> ACK
```

First-time flow:

```text
1. Client and server complete a normal connection.
2. Server issues a protected TFO cookie.
3. Client stores it.
4. On a later new connection, client sends the cookie + early data.
5. Server validates the cookie before accepting the early data.
```

```bash
curl --tcp-fastopen https://example.com/
# --tcp-fastopen : ask curl/OS/server to use TFO if all three support it
```

> [!IMPORTANT]
> TFO doesn't replace persistent connections, and it doesn't remove slow start:
>
> ```text
> Connection still open?  -> reuse it, no handshake needed.
> Connection gone?        -> TFO may make the *new* handshake more useful.
> ```
>
> TFO changes *when* early data may be sent; slow start still controls how aggressively the new connection ramps up.

The TFO cookie proves prior reachability — it is **not** a login identity, and is commonly bound to the source IP. Switch networks and an old cookie may not validate, falling back to a normal handshake.

```text
TFO cookie         -> transport-level prior reachability
TLS session ticket -> resumes encryption state
Login token        -> identifies an application user/account
```

---

## 9. Listening servers: what "listen" really means

This whole topic is from the **server's** point of view: `Server listens. Client connects.`

A server registers a local **IP + port** with the OS: *"deliver new connections addressed here to my process."*

### One machine, many local addresses

```text
127.0.0.1       IPv4 loopback
::1             IPv6 loopback
192.168.1.10    Wi-Fi interface
10.0.0.20       Ethernet / private-cloud interface
172.17.0.1      possible Docker bridge
```

### Loopback

> **Analogy:** talking to yourself in a mirror — the message never leaves the room.

```text
Program A -> 127.0.0.1 -> OS networking stack -> Program B (same machine)
```

Traffic never touches the Wi-Fi card or router.

```text
127.0.0.1 -> IPv4 loopback
::1       -> IPv6 loopback
localhost -> a hostname that commonly resolves to one or both
```

> [!WARNING]
> `localhost` resolution order can differ by OS/config. When it actually matters, use the exact address you intend.

### Binding examples

```text
127.0.0.1:8080    -> only IPv4 loopback clients
::1:8080          -> only IPv6 loopback clients
192.168.1.10:8080 -> clients reaching that Wi-Fi interface
0.0.0.0:8080      -> every local IPv4 interface (wildcard bind)
```

> [!WARNING]
> `0.0.0.0` means "listen on all local IPv4 interfaces" — it is a **bind address**, not something a remote client should target as a destination. Binding to it can accidentally expose a dev/admin service beyond your machine, depending on routing, NAT, and firewall rules.

### Why "exposed" is actually two separate questions

Being reachable from the internet is the **AND** of two independent layers — either one alone can block a request:

```text
1. Does the packet even reach this machine?
   -> routing, NAT, firewall / cloud security group
   -> entirely outside the server's control

2. Is the server listening on a bind address that accepts packets from that door?
   -> 0.0.0.0  = accepts packets arriving through ANY interface (loopback, Wi-Fi, public IP, all of them)
   -> 127.0.0.1 = only accepts packets that arrived through the loopback interface
```

A packet from the public internet, addressed to your machine's public IP, physically arrives at an interface like `10.0.0.20` — never at `127.0.0.1`. So:

```text
server.listen({ host: "127.0.0.1", port: 8080 })
    -> even if the packet reaches the machine, it's ignored: wrong door
server.listen({ host: "0.0.0.0", port: 8080 })
    -> accepted, regardless of which door it came through
```

`0.0.0.0` doesn't *create* internet access by itself — Step 1's gates still decide whether a packet gets to the machine at all. The risk is that if those outer gates are ever left open (a common cloud-security-group default, or one misconfiguration), a `0.0.0.0`-bound service will happily answer. Binding to `127.0.0.1` is a second, independent safety net: even if Step 1 fails open, the server itself silently ignores anything not coming from loopback.

> [!IMPORTANT]
> Most real "oops, my dev server was public" incidents happen when **both** layers are left open at once: a cloud security group allowing the port, *and* the app bound to `0.0.0.0` instead of `127.0.0.1`.

A minimal Node.js listening server:

```js
const http = require("node:http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello from the server\n");
});

server.on("error", (error) => {
  // catches bind failures like EADDRINUSE
  console.error("Server error:", error);
});

server.listen({ host: "127.0.0.1", port: 8080 }, () => {
  const address = server.address();
  console.log(`Listening on http://${address.address}:${address.port}`);
});
```

Only same-machine programs can reach that loopback endpoint. To accept from every local IPv4 interface:

```js
server.listen({ host: "0.0.0.0", port: 8080 });
// still gated by firewalls, NAT, and cloud security rules
```

Passing port `0` asks the OS to pick a free ephemeral port — handy for parallel automated tests:

```js
server.listen({ host: "127.0.0.1", port: 0 }, () => {
  console.log(server.address());
});
```

### How does the client find the server IP?

```js
fetch("https://api.example.com/users");
```

```text
api.example.com -> DNS lookup -> server/proxy IP -> connect to IP:443
```

Locally, `http://localhost:8080` usually resolves to a loopback address.

### "Address already in use"

Only one socket can normally listen on the same local endpoint:

```text
Process A binds 127.0.0.1:8080 -> success
Process B binds 127.0.0.1:8080 -> EADDRINUSE
```

The same port number can be used on *different* local IPs — `127.0.0.1:8080` and `192.168.1.10:8080` are different endpoints.

### The exception: `SO_REUSEPORT`

Some OSes let multiple listening sockets bind the *same* IP+port. The kernel distributes new **flows/connections** among them, commonly hashing the four-tuple.

![The kernel can map different four-tuples to different listening processes](imgs/network-performance-page-29.png)

> [!WARNING]
> 📸 The slide label reads `SO_PORTREUSE` and frames this as "balancing segments" — the actual socket option is **`SO_REUSEPORT`**, and the correct mental model is *the kernel assigns whole connections/flows to processes*, not that individual segments of one TCP connection get scattered across processes.

```text
10.0.0.1:5555 -> 10.0.0.2:8080 -> App X
10.0.0.1:7712 -> 10.0.0.2:8080 -> App Y
```

Once a connection is assigned, its packets stay with that process — it owns the connection state.

---

## 10. TCP head-of-line blocking

> **Analogy:** a single-lane checkout — even if the person three carts back has already paid, nobody moves until the person right in front finishes.

TCP is one reliable, ordered byte stream. If segments 1, 2, 3, 4 are sent and 1 is lost while 2–4 arrive, TCP can hold and selectively-ACK the later bytes, but it **cannot** hand them to the application out of order.

```text
Expected: 1 2 3 4
Received:   2 3 4
Application delivery: blocked, waiting for 1
```

![One missing TCP segment blocks later application data](imgs/network-performance-page-32.png)

### Why this hurt HTTP/2

HTTP/2 multiplexes multiple independent streams over *one* TCP connection:

```text
Request A -> segments 1, 2
Request B -> segments 3, 4
```

Lose segment 1, and TCP won't deliver segment 3/4's bytes yet — Request B is logically independent but trapped behind Request A's missing bytes. This is **TCP head-of-line blocking**.

> [!IMPORTANT]
> HTTP/3 runs over QUIC (UDP), which gives each stream independent reliability — packet loss in one stream no longer blocks unrelated streams. This single problem is the main reason HTTP/3 exists.

---

# Part 4 — Proxies, Meshes, and Load Balancers

## 11. Forward proxy vs. reverse proxy

Both forward traffic on someone else's behalf. The difference is **which side they represent**.

### Forward proxy: represents clients

> **Analogy:** a personal assistant who makes calls *for* you — the person on the other end sees the assistant's number, not knowing (or caring) who's really behind it.

![A forward proxy makes the external request for the client](imgs/proxy-page-02.png)

```text
Client -> forward proxy -> destination server
```

The client knows the destination, but is configured to reach it through the proxy. At Layer 4, the destination often sees the *proxy's* IP; at Layer 7, headers may still reveal client info, depending on config.

Common uses: access policy/blocking, logging, caching, controlled outbound access, partial IP anonymity, service-to-service traffic control.

> [!WARNING]
> A forward proxy is not automatically a privacy guarantee — it can see and log traffic metadata, and may reveal the original client anyway.

### Reverse proxy: represents servers

> **Analogy:** a company receptionist — every visitor only ever sees the front desk, never which specific employee (or which building) actually handles their request.

![The client sees one public endpoint while the reverse proxy chooses a backend](imgs/proxy-page-04.png)

```text
Client -> reverse proxy -> private backend server(s)
```

The client treats the reverse proxy *as* the destination, usually with no idea which backend actually served the request. It's the public front door of a backend system.

![Common reverse-proxy use cases](imgs/proxy-page-05.png)

> [!NOTE]
> 📸 Five recurring jobs for a reverse proxy: **caching**, **load balancing**, **ingress** (single entry point into a cluster), **canary deployment** (routing a slice of traffic to a new version), and **microservices** (fronting many internal services with one address).

**Backend relevance:** in practice you configure Nginx, HAProxy, or Envoy rather than hand-writing this logic:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    location /users/ {
        proxy_pass http://user-service:8000/;
    }

    location /orders/ {
        proxy_pass http://order-service:9000/;
    }
}
```

### Can both exist at once? Yes.

```text
Client
 -> company forward proxy
 -> public reverse proxy
 -> private backend
```

The client usually knows about its own forward proxy — it may have no idea the public destination is itself a reverse proxy.

---

## 12. Service mesh, sidecars, and retries

### Sidecar

> **Analogy:** a translator standing beside a diplomat — the diplomat focuses purely on the conversation's content; the translator handles everything about *how* it gets communicated.

```text
┌────────────────────────────┐
│ Order Service               │
│   business logic            │
│                              │
│ Sidecar proxy                │
│   networking concerns        │
└────────────────────────────┘
```

Main service: `create order -> calculate total -> save order`
Sidecar: `encryption, logging/tracing, timeouts, retries, load balancing, service discovery`

### Retry

```text
Attempt 1 -> temporary failure
wait briefly
Attempt 2 -> success
```

> [!WARNING]
> Careless retries are dangerous: they can multiply load during an outage, and retrying a **non-idempotent** operation (like a payment) may repeat its effect even if the original actually succeeded but the response was lost. A safe policy needs a max attempt count, timeout, exponential backoff, jitter, and idempotency awareness.

### Service mesh

A **service mesh** manages inter-service communication, typically via a proxy beside each service:

```text
Order Service -> Order sidecar -> network -> Payment sidecar -> Payment Service
```

Without a mesh, every service reimplements retries, TLS, tracing, discovery, and balancing. With one, the sidecars provide it consistently — the interconnected proxies form the "mesh." A sidecar is often *both*: a forward proxy for its service's outgoing calls, and a reverse proxy for incoming ones.

> [!IMPORTANT]
> A mesh adds power *and* complexity, latency, config, and another failure surface. Add it because you have a real operational need — not just because microservices exist.

---

## 13. Load balancer from zero

A load balancer is a reverse proxy or packet-forwarder that chooses among backend instances.

```text
Client -> Load Balancer -> Backend 1
                      └-> Backend 2
                      └-> Backend 3
```

Why use one: spread traffic, avoid unhealthy servers, scale horizontally, hide private instances, enable controlled deployments.

> [!WARNING]
> A load balancer isn't automatically fault-tolerant — a single instance is a single point of failure. Real systems make the balancing layer itself redundant.

---

## 14. Layer 4 load balancing

A Layer 4 load balancer only needs: `source IP, source port, destination IP, destination port, TCP/UDP state`. It doesn't need to know whether the bytes mean `GET /users`, a PostgreSQL query, gRPC, or TLS-encrypted data.

![A client's TCP connection goes to whichever backend the L4 balancer chose](imgs/network-performance-page-38.png)

> [!NOTE]
> 📸 The client completes its full three-way handshake (SYN/SYN-ACK/ACK) *with the load balancer*, which then owns the decision of which backend server gets this connection — for its entire lifetime.

### Connection stickiness

A TCP connection is stateful — once assigned to Backend 1, **all** its bytes must keep going there. Sequence numbers and socket state wouldn't match otherwise.

```text
Connection A -> Backend 1, for its entire lifetime
Connection B -> Backend 2, for its entire lifetime
```

### Two L4 implementation styles

**L4 proxy mode — two TCP connections:**
```text
Client <== TCP conn 1 ==> L4 proxy <== TCP conn 2 ==> Backend
```
The LB terminates the client connection and copies bytes onto a separate backend connection.

**NAT/pass-through mode — one end-to-end TCP connection:**
```text
Client <================ TCP =================> Backend
             L4 NAT device rewrites addresses
```
```text
Before destination NAT: 10.0.0.5:55000 -> 44.1.1.2:443
After destination NAT:  10.0.0.5:55000 -> 10.0.0.20:443
```
The backend owns the TCP state; return traffic is rewritten so the client still sees the public LB address.

### Strengths vs. limitations

| Strengths | Limitations |
|---|---|
| Efficient, simple | Balances per *connection*, not per request |
| Works with any TCP/UDP protocol | Can't route `/images` vs `/orders` |
| Preserves end-to-end encryption untouched | Can't meaningfully cache HTTP |
| Doesn't need to parse HTTP | Long-lived connections can skew distribution |

---

## 15. Layer 7 load balancing

An L7 load balancer understands a specific application protocol — commonly HTTP — and can inspect `Host header, URL path, method, cookies, authorization headers, content type`.

### Request-level decisions

One HTTP request can span several TCP segments; the L7 balancer reconstructs enough of the protocol to identify the *logical* request and apply a rule.

![The L7 load balancer parses the request carried across TCP segments](imgs/network-performance-page-49.png)

> [!NOTE]
> 📸 `HTTP GET /1` arrives as segments 1, 2, 3. The L7 balancer parses and understands those segments as one logical request before deciding which backend gets it.

A second request on the *same* client connection can be routed elsewhere entirely:

![A later HTTP request on the same client connection can go to another backend](imgs/network-performance-page-50.png)

```text
GET /users   -> User Service
POST /orders -> Order Service
GET /images  -> Image Service or cache
```

> [!IMPORTANT]
> This is the core L4-vs-L7 distinction: L4 balances once per *connection* (see §14's stickiness); L7 can balance per *request*, even across one reused client connection.

A production L7 proxy doesn't need to buffer an entire request body — it can parse headers, pick a backend, and stream the body — but it must understand enough of the protocol to know request boundaries.

### TLS termination

To inspect HTTPS payloads, the L7 balancer normally terminates TLS itself:

```text
Client -- encrypted TLS --> L7 load balancer
L7 load balancer -- new (often TLS) connection --> Backend
```

The certificate and private key live on the TLS-terminating balancer (or a secrets system feeding it).

### API gateway behavior

An **API gateway** is not a separate technology — it's an L7 load balancer/reverse proxy configured as the single front door for a set of backend APIs, handling cross-cutting concerns so each backend service doesn't reimplement them:

```text
Client -> API Gateway -> User Service
                       -> Order Service
                       -> Payment Service
                       -> Inventory Service
```

```text
Authentication          -> verify the caller's identity once, at the door
Rate limiting            -> "this client gets 100 req/min, no more"
Request/response shaping -> transform formats, aggregate multiple backend calls into one
Versioning               -> /v1/orders vs /v2/orders routed differently
Logging & metrics        -> one place to observe all API traffic
Protocol translation      -> e.g. client speaks REST, backend speaks gRPC
```

> [!NOTE]
> None of this is possible at Layer 4 — a Layer 4 balancer can't see a URL path or an auth header. Since an L7 balancer already has to parse HTTP to route requests, gateway features are a natural thing to bolt on at the same layer.

```nginx
location /v1/orders/ {
    # check auth header, apply rate limit, then forward
    proxy_pass http://order-service-v1:9000/;
}

location /v2/orders/ {
    proxy_pass http://order-service-v2:9000/;
}
```

#### Authenticating with a JWT at the gateway

A **JWT (JSON Web Token)** is a self-contained, signed token used to prove "who this request is from" without a database lookup. It has three dot-separated, Base64-encoded parts:

```text
header.payload.signature

eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI0MiJ9.SflKxwRJSMeKKF2QT4fw...
```

```json
// header — how it's signed
{ "alg": "HS256", "typ": "JWT" }

// payload — claims: data about the user/request
{ "userId": "42", "role": "admin", "exp": 1735689600 }
```

The signature is computed as:

```text
signature = HMAC-SHA256(base64(header) + "." + base64(payload), secret_key)
```

Only whoever holds `secret_key` can produce a valid signature — the payload itself is readable by anyone (not encrypted), but can't be edited or forged without invalidating the signature.

```text
Client -> sends request with: Authorization: Bearer eyJhbGciOi...

Gateway:
    1. splits the token into header.payload.signature
    2. recomputes the signature using its known secret_key
    3. compares -> match: valid, forward the request
              -> mismatch: reject, 401
    4. reads payload.userId / payload.role to apply rate limits, routing, etc.
```

```text
Session-based auth: server stores session data -> DB lookup on every request
JWT-based auth:      the token itself carries the data -> just verify the signature, no lookup
```

> [!WARNING]
> `exp` (expiry) is just a claim in the payload — the server must actively check it isn't in the past. A JWT has no built-in revocation, so it can be replayed by anyone who captures it until it naturally expires.

### Strengths vs. limitations

| Strengths | Limitations |
|---|---|
| Smart routing by host/path/header/user | More CPU/memory: parsing, TLS, policy, buffering |
| HTTP caching | Must explicitly support the protocol in use |
| API gateway behavior | Can become a bottleneck if under-sized |
| Auth, rate limiting, canary deploys | Proxy/backend parsing mismatches can cause request smuggling |
| Per-request balancing on one connection | |

### Core comparison

| Question | Layer 4 | Layer 7 |
|---|---|---|
| Understands HTTP? | No | Yes |
| Typical balancing unit | Connection/flow | Logical request |
| Can route by `/path`? | No | Yes |
| Works with unknown TCP protocols? | Often yes | Only if supported |
| Can cache HTTP responses? | Not meaningfully | Yes |
| Typical cost | Lower | Higher |
| TLS inspection required? | No | Yes, for HTTPS rules |

---

# Part 5 — Databases, Safely

## 16. Databases from zero

### A database is usually a server process

PostgreSQL isn't a file your code opens — it's a long-lived server process.

```text
Backend application
    -> database client library
    -> socket/connection
    -> PostgreSQL server process
    -> database files on storage
```

The backend sends SQL over the connection; PostgreSQL checks permissions, executes, and returns results.

### What is database configuration?

Settings controlling server behavior, separate from your application code: which local IPs/port to listen on, which client IPs may connect, which users may authenticate, where data lives, how much memory it may use.

```text
PostgreSQL starts
    -> reads configuration files
    -> opens listening sockets
    -> loads access rules
    -> waits for database clients
```

Some settings reload live; others (like `listen_addresses`) need a restart because the server must reopen listening sockets.

### The two files that matter here

**`postgresql.conf`** — *which doors does PostgreSQL open?*

```conf
# Only accept TCP connections via loopback
listen_addresses = 'localhost'
port = 5432
```
```conf
# Or on a private database interface
listen_addresses = '10.0.0.30'
port = 5432
```

**`pg_hba.conf`** — host-based authentication: *who's allowed through, once the door is open?*

```conf
# TYPE  DATABASE  USER      ADDRESS          METHOD
host    appdb     app_user  127.0.0.1/32     scram-sha-256
```
```text
Connection type: TCP/IP
Database:        appdb
Database user:   app_user
Allowed source:  exactly 127.0.0.1
Authentication:  SCRAM password authentication
```

> **Analogy:** `postgresql.conf` decides which doors of the building are unlocked at all; `pg_hba.conf` decides who's on the guest list once someone reaches a door.

### `/32` means exactly one IPv4 address

```text
127.0.0.1/32 -> all 32 bits must match, exactly one host
10.0.0.20/32 -> exactly that one host
10.0.0.0/24  -> the whole 10.0.0.x subnet
0.0.0.0/0    -> every IPv4 address
```

> [!WARNING]
> Never use `0.0.0.0/0` on a production database just to make connection errors go away.

### Safe two-machine example

```text
Backend:  10.0.0.20
Database: 10.0.0.30
```

```conf
# postgresql.conf on the database server
listen_addresses = '10.0.0.30'
port = 5432
```

```conf
# pg_hba.conf — allow only this one backend host
host    appdb    app_user    10.0.0.20/32    scram-sha-256
```

PostgreSQL then checks, in order:

```text
1. Did the connection reach an address PostgreSQL listens on?
2. Does pg_hba.conf allow this source IP/database/user combo?
3. Are the supplied credentials correct?
4. Does this database user have permission for the requested SQL?
```

**Backend relevance:** network allow-listing is a barrier, not a substitute — it never replaces real passwords and per-user SQL permissions.

### Local Unix-domain sockets ≠ loopback TCP

A `local` rule in `pg_hba.conf` typically means a Unix-domain socket:

```text
Backend process -> Unix-domain socket -> PostgreSQL process
```

Two processes, same machine, but **no** TCP/IP and no `127.0.0.1` involved.

```conf
local   appdb   app_user   scram-sha-256
```

### Finding real config paths, and reloading

```sql
SHOW config_file;
SHOW hba_file;
-- locations vary by OS, package manager, container image, and managed service
```

```sql
SELECT pg_reload_conf();
-- re-reads reloadable settings without a restart;
-- listen_addresses still needs a full restart
```

### Backend connection string

```env
DATABASE_URL=postgresql://app_user:strong-password@10.0.0.30:5432/appdb
```

```text
postgresql://    protocol/driver scheme
app_user         database username
strong-password  credential
10.0.0.30        database server IP or hostname
5432             PostgreSQL port
appdb            target database
```

> [!WARNING]
> Never commit real production passwords into Git — use environment variables or a secrets manager.

### Why "listen on everything" is dangerous

```conf
# postgresql.conf
listen_addresses = '*'
```
```conf
# pg_hba.conf
host    all    all    0.0.0.0/0    scram-sha-256
```

This invites every reachable IPv4 host to attempt authentication. A password alone doesn't stop scanning, credential guessing, exploit attempts, or resource exhaustion.

> [!IMPORTANT]
> A database should be reachable only from the exact private networks and backend identities that need it. Cloud firewalls/security groups are a *separate* required layer — PostgreSQL's own config isn't the only line of defense.

---

# Full Flow — One Complete Backend Request

```mermaid
sequenceDiagram
    participant B as Browser
    participant D as DNS
    participant P as L7 Reverse Proxy
    participant O as Order Service
    participant DB as PostgreSQL

    B->>D: Resolve api.example.com
    D-->>B: Reverse-proxy IP
    B->>P: TCP+TLS handshake (or reuse existing connection)
    Note over B,P: Congestion control, slow start, Nagle/delayed ACK all apply here
    B->>P: POST /orders
    P->>O: Route to Order Service (warm pooled connection)
    O->>DB: Borrow a connection from the pool
    Note over O,DB: PostgreSQL checks listen_addresses, pg_hba.conf, credentials, SQL permissions
    DB-->>O: Query result
    O-->>P: Response
    P-->>B: Response
```

Every performance problem in this chapter now has a clear address on that diagram:

```text
DNS delay                       -> resolution step
new TCP/TLS handshakes          -> §5
slow start                      -> §3
Nagle + delayed ACK             -> §4
packet loss, TCP HOL blocking   -> §10
overloaded reverse proxy        -> §14 / §15
empty connection pool           -> §6
slow SQL query / conn limit     -> §16
```

---

# Compact Memory Sheet

```text
MTU                 Maximum IP packet size a link/interface supports.
MSS                 Maximum TCP application payload in one segment.
PMTUD               Finds the smallest usable MTU on the route, via ICMP feedback.
Nagle's algorithm   Holds small writes while older data is unacknowledged.
Delayed ACK         Briefly waits so one ACK may cover more received data.
Slow start          A new connection gradually learns safe in-flight capacity.
Persistent conn.    One open connection reused for multiple exchanges.
Connection pool     A managed set of reusable open connections.
Eager loading       Prepare during startup — slower start, faster first use.
Lazy loading        Prepare on demand — faster start, slower first use.
TCP Fast Open       Lets a validated returning client send early data in the SYN.
Listening           Registering a local IP:port so the OS routes new conns here.
Loopback            Network traffic that stays inside the same machine.
Forward proxy       Represents clients when contacting destinations.
Reverse proxy       Represents backend servers behind one public endpoint.
Sidecar             A helper process deployed beside a service.
Service mesh        A comms-management layer, often built from sidecar proxies.
L4 load balancer    Balances TCP/UDP flows using connection/address info.
L7 load balancer    Understands an app protocol, balances logical requests.
pg_hba.conf         PostgreSQL rules for who may authenticate, and how.
```

---

# Selected Commands and Snippets

```bash
curl https://api.example.com/users
# quick way to hit an HTTP endpoint from the shell
```

```bash
curl --tcp-fastopen https://example.com/
# request TCP Fast Open when curl, OS, and server all support it
```

```bash
ip address     # Linux — local IP configuration
ifconfig       # macOS — local IP configuration
ipconfig       # Windows (PowerShell/cmd) — local IP configuration
```

```bash
ip neigh show
# Linux — inspect the neighbor/ARP table
```

```sql
SHOW config_file;      -- where postgresql.conf actually lives
SHOW hba_file;          -- where pg_hba.conf actually lives
SELECT pg_reload_conf(); -- reload reloadable settings without a restart
```

---

# Checklist — What You Should Know After This

- [ ] Can you explain why an Ethernet "MTU of 1500" is not the whole frame size?
- [ ] Can you walk through a Path MTU Discovery exchange, including the ICMP message involved?
- [ ] Can you explain the difference between congestion control and flow control?
- [ ] Can you describe why Nagle's algorithm and delayed ACK combine badly, and how to disable each?
- [ ] Do you know every cost a fresh TCP connection pays for (handshake, TLS, slow start, etc.)?
- [ ] Can you explain why switching networks breaks a live TCP connection but not QUIC?
- [ ] Can you explain the difference between a persistent connection and a connection pool?
- [ ] Can you contrast eager loading and lazy loading with a concrete trade-off each?
- [ ] Can you explain what TCP Fast Open actually skips, and what it does *not* skip?
- [ ] Do you know the difference between binding to `127.0.0.1`, a specific interface IP, and `0.0.0.0`?
- [ ] Can you explain what `SO_REUSEPORT` actually does, and what it does *not* do?
- [ ] Can you explain TCP head-of-line blocking and why HTTP/3 avoids it?
- [ ] Can you distinguish a forward proxy from a reverse proxy by "which side it represents"?
- [ ] Can you explain the strengths and limits of Layer 4 vs. Layer 7 load balancing?
- [ ] Can you configure a safe `pg_hba.conf` rule restricting a database to one backend IP?
- [ ] Can you trace a real-world request end-to-end using everything from this chapter?

---

## Sources used in this chapter

- *Network Performance* lecture slides: MTU/MSS, PMTUD, Nagle, delayed ACK, listening sockets, `SO_REUSEPORT`, TCP head-of-line blocking, and Layer 4/Layer 7 load balancing visuals.
- *Proxy vs Reverse Proxy* lecture slides: proxy/reverse-proxy diagrams and use cases.
- Lecture transcripts and clarification questions developed through this study session.