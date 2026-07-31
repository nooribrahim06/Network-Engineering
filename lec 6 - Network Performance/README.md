# Backend Networking Performance: TCP, Proxies, Load Balancers, and Safe Databases

This chapter connects low-level networking to the things a backend developer actually builds: HTTP servers, persistent connections, reverse proxies, microservices, load balancers, and databases.

The goal is not to memorize isolated definitions. The goal is to see one complete path:

```text
Client application
    -> socket
    -> TCP
    -> IP
    -> local link
    -> routers and proxies
    -> backend listening socket
    -> backend code
    -> database connection
```

---

## 1. The layer map we will use

The OSI model has seven layers, but for practical backend work it is easier to think in five groups:

| Practical layer | Main question | Examples |
|---|---|---|
| Application | What does the message mean? | HTTP, DNS, gRPC, PostgreSQL protocol |
| Transport | Which process, and how is data delivered? | TCP, UDP, ports |
| Network | Which host across networks? | IP, routing, ICMP |
| Data Link | Which next device on this local link? | Ethernet, Wi-Fi, MAC, ARP |
| Physical | How do the bits physically move? | Radio, electricity, light |

![Devices operate only as high in the stack as they need](imgs/layers-across-network.png)

The diagram above shows an important rule:

- The **client** and **backend server** use the complete stack.
- A **Layer 4 proxy or firewall** needs to understand transport information such as TCP and ports, but not necessarily HTTP.
- A **Layer 7 load balancer or CDN** understands application data such as HTTP paths and headers.

### Encapsulation

When an application sends data, each lower layer wraps it:

```text
Application data
    -> TCP segment
        -> IP packet
            -> Ethernet/Wi-Fi frame
                -> physical signals
```

The reverse happens at the receiver.

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

A TCP connection is identified by the **four-tuple**:

```text
source IP + source port + destination IP + destination port
```

Example:

```text
10.0.0.1:5555 -> 10.0.0.2:8080
```

---

## 2. MTU, MSS, and why packet size matters

### MTU: the Layer 3 size limit of a link

**MTU** means **Maximum Transmission Unit**.

For a normal Ethernet interface, an MTU of `1500` usually means that the Ethernet frame can carry an IP packet of at most 1500 bytes. The Ethernet header and trailer are outside that 1500-byte IP payload limit.

> Important correction: it is common to casually say “MTU is the frame size,” but an Ethernet MTU of 1500 normally refers to the maximum Layer 3 packet carried inside the frame, not the entire Ethernet frame.

Different links can have different MTUs:

```text
Normal Ethernet: often 1500 bytes
Jumbo-frame network: often around 9000 bytes
Tunnel/VPN link: may be lower because the tunnel adds headers
```

### MSS: maximum TCP payload in one segment

**MSS** means **Maximum Segment Size**. It limits the TCP data portion, not the complete TCP segment.

For typical IPv4 and TCP headers with no options:

```text
MTU              = 1500 bytes
IPv4 header      =   20 bytes
TCP header       =   20 bytes
--------------------------------
TCP MSS          = 1460 bytes
```

![How the frame, IP packet, TCP segment, and MSS fit together](imgs/network-performance-page-06.png)

A 1460-byte TCP payload becomes:

```text
1460 bytes application data
+ 20 bytes TCP header
+ 20 bytes IPv4 header
= 1500-byte IP packet
```

### Why not always use giant packets?

Larger packets reduce per-packet overhead because fewer headers must be processed. But they also have trade-offs:

- Every device on the path must support the size.
- A damaged or lost large packet means more data must be retransmitted.
- Large packets may need fragmentation if a later link has a smaller MTU.

### IP fragmentation

If an IPv4 packet is too large for a link, it may be split into fragments. Fragmentation is undesirable because:

- Every fragment must arrive before the original packet can be reconstructed.
- Losing one fragment effectively loses the whole original packet.
- It adds work and has historically created security and reliability problems.

Modern systems normally try to avoid fragmentation.

### Path MTU Discovery

The sender does not control every network interface between itself and the destination. The smallest MTU anywhere along the route is the **Path MTU**.

![Path MTU Discovery finds the smallest supported MTU](imgs/network-performance-page-07.png)

A simplified IPv4 Path MTU Discovery flow is:

```text
1. Sender transmits a packet with the Don't Fragment (DF) flag.
2. A router encounters a link whose MTU is too small.
3. The router cannot fragment because DF is set.
4. It drops the packet.
5. It returns an ICMP "Fragmentation Needed" message.
6. The sender reduces its packet size.
```

For IPv6, routers never fragment forwarded packets; an oversized packet triggers an ICMPv6 **Packet Too Big** message.

### ICMP reminder

**ICMP** is a Layer 3 helper protocol used to report network conditions and errors.

```text
ping                       -> Echo Request / Echo Reply
TTL reaches zero           -> Time Exceeded
Destination cannot be used -> Destination Unreachable
Packet is too large        -> Fragmentation Needed / Packet Too Big
```

ICMP does not normally carry your application’s business data.

---

## 3. Congestion control vs. flow control

These solve different problems:

| Mechanism | Protects | Main question |
|---|---|---|
| Flow control | The receiver | Can the receiver’s buffer accept more data? |
| Congestion control | The network path | Can the network carry more data without becoming overloaded? |

### TCP slow start

A new TCP connection does not know how much traffic its path can safely carry. It begins with a limited congestion window and increases it as acknowledgments arrive.

```text
New connection
    -> send a limited amount
    -> ACKs return successfully
    -> increase the allowed in-flight data
    -> continue learning the path
```

Despite its name, the early growth can be fast. The problem is that a brand-new connection cannot immediately use the full capacity that a long-lived, already-tested connection may have reached.

We do not normally “turn slow start off.” We avoid repeatedly throwing away useful connections and creating new ones unnecessarily.

---

## 4. Nagle’s algorithm and delayed acknowledgments

Both mechanisms were designed to reduce unnecessary packets. They can also introduce latency.

### Nagle’s algorithm: the sender may wait

Imagine an application repeatedly writes tiny pieces of data. Sending one byte with roughly 40 bytes of minimum IPv4 + TCP headers is wasteful.

Nagle’s rule is approximately:

```text
If there is no unacknowledged data:
    send now
Else if the new data can fill a full MSS-sized segment:
    send the full segment
Else:
    temporarily buffer the small write
```

The buffered data is sent when either:

- an ACK arrives for the outstanding data, or
- enough new data arrives to fill a segment.

Example with `MSS = 1460` and an application writing 5000 bytes:

```text
Segment 1: 1460 bytes - full, send
Segment 2: 1460 bytes - full, send
Segment 3: 1460 bytes - full, send
Remaining:   620 bytes - small
```

If older data is still unacknowledged, Nagle may hold the final 620 bytes.

![A small final segment may wait for an ACK under Nagle's algorithm](imgs/network-performance-page-12.png)

The ACK is not “permission for segment 4.” Its arrival removes the condition that outstanding unacknowledged data exists.

### Disabling Nagle: `TCP_NODELAY`

Low-latency applications often disable Nagle’s waiting behavior.

In Node.js:

```js
socket.setNoDelay(true);
```

In C:

```c
#include <netinet/tcp.h>
#include <sys/socket.h>

int enabled = 1;
setsockopt(socket_fd, IPPROTO_TCP, TCP_NODELAY, &enabled, sizeof(enabled));
```

`curl` enables TCP no-delay behavior by default in common builds because small handshake writes can otherwise be delayed.

### Delayed ACK: the receiver may wait

TCP acknowledgments are cumulative. Instead of acknowledging every segment immediately, a receiver may briefly wait so one ACK can cover more data.

```text
Receive segment 1
Wait briefly for segment 2
Send one cumulative ACK for both
```

This reduces ACK traffic, but delays feedback to the sender.

### Why Nagle + delayed ACK can be painful

```text
Sender:
“I have a small segment, but Nagle tells me to wait for an ACK.”

Receiver:
“I will delay the ACK because another segment may arrive.”
```

Both sides wait until the delayed-ACK timer expires.

![Nagle and delayed ACK can make both endpoints wait](imgs/network-performance-page-16.png)

The delay is implementation-dependent; historical combinations could produce delays of hundreds of milliseconds.

On Linux, low-level software may request quicker ACK behavior using `TCP_QUICKACK`:

```c
#include <netinet/tcp.h>
#include <sys/socket.h>

int enabled = 1;
setsockopt(socket_fd, IPPROTO_TCP, TCP_QUICKACK, &enabled, sizeof(enabled));
```

`TCP_QUICKACK` is Linux-specific and is generally a request to the TCP stack, not a permanent promise that every future ACK will always be immediate.

---

## 5. The real cost of a TCP connection

Opening a connection is not free.

A fresh connection may pay for:

1. DNS resolution, when a hostname must be resolved.
2. The TCP three-way handshake.
3. A TLS handshake for HTTPS.
4. Authentication at the application or database layer.
5. TCP slow start while the path capacity is learned.
6. Memory, buffers, socket state, and file descriptors on both endpoints.

The farther apart the endpoints are, the more expensive every required round trip becomes.

### How long does an open connection remain open?

TCP does not automatically close merely because no application data is currently moving.

A connection may remain open for seconds, hours, days, or theoretically longer until something ends it:

- one application calls `close()`;
- an idle timeout expires;
- a proxy, firewall, or load balancer removes idle state;
- a process restarts or crashes;
- the network changes or fails;
- keepalive probes eventually detect a dead peer.

```text
Open connection != continuous traffic
```

### Why changing Wi-Fi to mobile data breaks ordinary TCP

A TCP connection is tied to its four-tuple. Switching networks usually changes the client’s source IP and often its source port and route.

```text
Old Wi-Fi connection:
public-Wi-Fi-IP:53000 -> server:443

After switching to mobile data:
carrier-IP:61000 -> server:443
```

That is a different four-tuple, so ordinary TCP cannot simply continue the old connection. QUIC was designed with connection migration mechanisms that can handle this case more gracefully.

---

## 6. Persistent connections and connection pooling

### Persistent connection

A persistent connection is one connection reused for more than one exchange.

```text
Bad pattern:
open -> request -> close
open -> request -> close
open -> request -> close

Better pattern:
open -> request -> request -> request -> close later
```

This avoids repeating handshakes and preserves a connection that has already progressed through slow start.

### Connection pooling

A **connection pool** is a managed collection of already-open connections.

Suppose a backend talks to PostgreSQL.

Without pooling:

```text
Every web request:
    open database connection
    authenticate
    send SQL query
    receive result
    close connection
```

With pooling:

```text
Pool:
    connection 1 - available
    connection 2 - busy
    connection 3 - available

Request:
    borrow connection 1
    run SQL
    return connection 1 to the pool
```

Returning a connection to the pool does **not** close it.

A pool also protects the database. If every incoming web request created unlimited database connections, the database could be overwhelmed.

When all pooled connections are busy, additional requests normally wait, fail after a timeout, or follow a configured overflow policy.

### Reverse proxies use a similar idea

A reverse proxy may keep connections to backend servers open:

```text
Clients -> reverse proxy -> pool of warm backend connections
```

That prevents every client request from forcing a new proxy-to-backend handshake.

---

## 7. Backend startup, eager loading, and lazy loading

### What is backend startup?

A backend is a long-running process. Startup is the one-time preparation phase after the process begins and before it is fully ready to serve traffic.

```text
1. OS creates the process.
2. Runtime starts, such as Node.js or Python.
3. Source files and libraries are loaded.
4. Configuration is read.
5. Database pools and other resources may be created.
6. The server binds a listening socket.
7. It enters an event loop and waits for requests.
```

The startup phase ends, but the process keeps running.

A simplified model is:

```js
while (serverIsRunning) {
    const request = await waitForRequest();
    handle(request);
}
```

Frameworks implement the real event loop for you.

The backend stops when it is terminated, crashes, is restarted by a deployment platform, or the machine shuts down. A graceful shutdown usually stops accepting new work, finishes in-flight requests, closes pools, and exits.

### Eager loading

Eager loading prepares resources during startup.

```text
Backend starts
    -> open 10 database connections
    -> load configuration and caches
    -> begin accepting requests
```

Trade-off:

```text
Slower startup
Faster first request
Resources may be reserved before they are needed
```

### Lazy loading

Lazy loading prepares a resource only when it is first needed.

```text
Backend starts quickly
    -> first database request arrives
    -> create database pool
    -> execute request
```

Trade-off:

```text
Faster startup
Slower first use
Resources are not consumed unless needed
```

Memorize the difference:

```text
Eager: pay preparation cost during startup.
Lazy:  pay preparation cost during first use.
```

---

## 8. TCP Fast Open

A normal TCP connection sends no application data until the handshake has progressed:

```text
Client -> SYN
Client <- SYN-ACK
Client -> ACK + application data
```

**TCP Fast Open (TFO)** may allow a returning client to include early data in the SYN:

```text
Client -> SYN + TFO cookie + data
Client <- SYN-ACK + possible response
Client -> ACK
```

A simplified first-time flow is:

```text
1. Client and server establish a normal connection.
2. Server gives the client a protected TFO cookie.
3. The client stores it.
4. On a later new connection, the client sends the cookie and early data.
5. The server validates the cookie before accepting the early data.
```

Example command when the installed `curl`, OS, and server support it:

```bash
curl --tcp-fastopen https://example.com/
```

### TFO does not replace persistent connections

```text
Connection still open?
    Reuse it. No new handshake is required.

Connection is gone and a new one is unavoidable?
    TFO may make the new handshake more useful.
```

TFO also does not remove TCP slow start. Fast Open changes when early data may be sent; slow start controls how aggressively the new connection increases traffic.

### How does the server know this is a previous client?

The TFO cookie proves prior reachability; it is not a login identity. Implementations commonly bind validation to network information such as the source IP. If the client changes from Wi-Fi to mobile data, an old cookie may not validate and the connection falls back to a normal handshake.

```text
TFO cookie         -> transport-level prior reachability
TLS session ticket -> helps resume encryption state
Login token        -> identifies an application user/account
```

---

## 9. Listening servers: what does “listen” really mean?

This entire topic is from the **server’s point of view**.

```text
Server: listens
Client: connects
```

A server registers a local **IP address + port** with the operating system.

```text
“Deliver new connections addressed to this local endpoint to my process.”
```

### One machine can have many local addresses

```text
127.0.0.1       IPv4 loopback
::1             IPv6 loopback
192.168.1.10    Wi-Fi interface
10.0.0.20       Ethernet or private-cloud interface
172.17.0.1      possible Docker bridge
```

### Loopback

Loopback means the computer talks to itself through its local networking stack.

```text
Program A
    -> 127.0.0.1
    -> OS networking stack
    -> Program B on the same machine
```

Traffic does not leave through the Wi-Fi card or router.

```text
127.0.0.1 -> IPv4 loopback
::1       -> IPv6 loopback
localhost -> a hostname that commonly resolves to one or both
```

`localhost` resolution order can differ by OS and configuration. When exact behavior matters, use the exact address you intend.

### Binding examples

```text
127.0.0.1:8080  -> only IPv4 loopback clients
::1:8080        -> only IPv6 loopback clients
192.168.1.10:8080 -> clients reaching that Wi-Fi interface
0.0.0.0:8080    -> every local IPv4 interface
```

`0.0.0.0` is a wildcard **bind address**. It means “listen on all local IPv4 interfaces.” It is not an address a remote client should normally use as a destination.

Binding to all interfaces can accidentally expose a development or admin service to other devices or even the public Internet, depending on routing, NAT, firewall, and cloud security rules.

### Minimal Node.js listening server

```js
const http = require("node:http");

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello from the server\n");
});

server.on("error", (error) => {
    console.error("Server error:", error);
});

server.listen({ host: "127.0.0.1", port: 8080 }, () => {
    const address = server.address();
    console.log(`Listening on http://${address.address}:${address.port}`);
});
```

Only programs on the same machine can reach that IPv4 loopback endpoint.

To accept connections through every local IPv4 interface:

```js
server.listen({ host: "0.0.0.0", port: 8080 });
```

That does not by itself guarantee Internet access. Firewalls, routers, NAT, and cloud security rules still control reachability.

### Let the OS choose a temporary port

Passing port `0` asks the OS to choose an available ephemeral port:

```js
server.listen({ host: "127.0.0.1", port: 0 }, () => {
    console.log(server.address());
});
```

This is useful in automated tests where several server instances may run simultaneously.

### How does the client know the server IP?

The client usually knows a hostname:

```js
fetch("https://api.example.com/users");
```

The client then performs:

```text
api.example.com
    -> DNS lookup
    -> server or reverse-proxy IP
    -> connect to IP:443
```

For local development:

```text
http://localhost:8080
```

usually resolves to a loopback address.

### “Address already in use”

Normally, only one socket can listen on the same local endpoint:

```text
Process A binds 127.0.0.1:8080 -> success
Process B binds 127.0.0.1:8080 -> EADDRINUSE
```

The same numeric port can be used on different local IP addresses:

```text
127.0.0.1:8080
192.168.1.10:8080
```

These are different endpoints.

### `SO_REUSEPORT`

Some operating systems support `SO_REUSEPORT`, allowing multiple listening sockets to bind the same IP and port. The kernel distributes **new flows/connections** among them, commonly using a hash related to the four-tuple.

> Correction: the lecture slide says `SO_PORTREUSE` and describes balancing segments. The usual socket option name is `SO_REUSEPORT`, and the useful mental model is that the kernel assigns connections/flows, not that it randomly sends consecutive segments of one TCP connection to different processes.

![The kernel can map different four-tuples to different listening processes](imgs/network-performance-page-29.png)

Example:

```text
10.0.0.1:5555 -> 10.0.0.2:8080 -> App X
10.0.0.1:7712 -> 10.0.0.2:8080 -> App Y
```

Once a connection is assigned, its packets must remain with the same process because that process owns the connection state.

---

## 10. TCP head-of-line blocking

TCP exposes one reliable, ordered byte stream.

Suppose the sender transmits bytes carried in segments 1, 2, 3, and 4. Segment 1 is lost, but 2, 3, and 4 arrive.

TCP can store the later bytes and may report them using selective acknowledgments, but it cannot deliver those later bytes to the application as a continuous ordered stream until the missing earlier bytes arrive.

```text
Expected: 1 2 3 4
Received:   2 3 4
Application delivery: blocked waiting for 1
```

![One missing TCP segment blocks later application data](imgs/network-performance-page-32.png)

### Why this hurt HTTP/2

HTTP/2 multiplexes multiple independent streams inside one TCP connection.

```text
Request A -> TCP bytes in segments 1 and 2
Request B -> TCP bytes in segments 3 and 4
```

If segment 1 is lost, TCP cannot deliver the later byte range yet. Request B may be logically independent, but it is still trapped behind missing bytes in the shared TCP stream.

This is **TCP head-of-line blocking**.

HTTP/3 uses QUIC over UDP. QUIC provides separate reliable streams, so packet loss in one stream does not necessarily block delivery for unrelated streams.

---

## 11. Forward proxy vs. reverse proxy

Both are servers that create or forward communication on behalf of someone else. The difference is **which side they represent**.

### Forward proxy: represents clients

![A forward proxy makes the external request for the client](imgs/proxy-page-02.png)

```text
Client -> forward proxy -> destination server
```

The client knows the destination but is configured to reach it through the proxy.

At Layer 4, the destination server often sees a connection from the proxy’s IP. At Layer 7, a proxy may add headers that reveal information about the original client, depending on configuration.

Common uses:

- access policy and blocking;
- logging and debugging;
- caching;
- controlled outbound access;
- partial IP anonymity from the destination;
- service-to-service traffic management.

A forward proxy is not automatically a privacy guarantee. The proxy itself can observe traffic metadata and may reveal or log the original client.

### Reverse proxy: represents servers

![The client sees one public endpoint while the reverse proxy chooses a backend](imgs/proxy-page-04.png)

```text
Client -> reverse proxy -> private backend server(s)
```

The client treats the reverse proxy as the destination and usually does not know which backend actually handled the request.

A reverse proxy is the public front door of a backend system.

Common uses:

- load balancing;
- TLS termination;
- caching;
- hiding private backend addresses;
- routing paths to microservices;
- authentication and rate limiting;
- canary deployments.

![Common reverse-proxy use cases](imgs/proxy-page-05.png)

### Example Nginx reverse-proxy routing

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

The backend developer or infrastructure engineer usually configures a production proxy such as Nginx, HAProxy, or Envoy rather than implementing all proxy behavior from scratch.

### Can both exist at once?

Yes:

```text
Client
 -> company forward proxy
 -> public reverse proxy
 -> private backend
```

The client normally knows about its forward proxy. It may not know that the public destination is itself a reverse proxy.

---

## 12. Service mesh, sidecars, and retries

### Sidecar

A **sidecar** is a helper process deployed beside the main service.

```text
┌────────────────────────────┐
│ Order Service              │
│   business logic           │
│                            │
│ Sidecar proxy              │
│   networking concerns      │
└────────────────────────────┘
```

The main service handles business logic:

```text
create order
calculate total
save order
```

The sidecar can handle infrastructure concerns:

```text
encryption
logging and tracing
timeouts
retries
load balancing
service discovery
```

### Retry

A retry means attempting a failed operation again.

```text
Attempt 1 -> temporary failure
wait briefly
Attempt 2 -> success
```

Retries can help with temporary failures, but careless retries are dangerous:

- They can multiply load during an outage.
- Retrying a non-idempotent operation may repeat the effect.
- A payment request may have succeeded even if its response was lost.

A safe retry policy normally includes a maximum attempt count, timeout, exponential backoff, random jitter, and knowledge of whether the operation is idempotent.

### Service mesh

A **service mesh** is an infrastructure layer that manages communication among microservices, often by placing a proxy beside each service.

```text
Order Service
    -> Order sidecar
        -> network
            -> Payment sidecar
                -> Payment Service
```

Without a mesh, every service may need to implement retries, TLS, tracing, service discovery, and balancing itself. With a mesh, the proxies provide these behaviors consistently.

The collection of interconnected proxies forms the “mesh.”

A sidecar commonly behaves as:

- a forward proxy for outgoing calls from its service;
- a reverse proxy for incoming calls to its service.

A mesh adds power, but also adds complexity, latency, configuration, and another failure surface. It should solve a real operational need rather than being added only because microservices exist.

---

## 13. Load balancer from zero

A load balancer is a reverse proxy or packet-forwarding system that chooses among backend instances.

```text
Client -> Load Balancer -> Backend 1
                      └-> Backend 2
                      └-> Backend 3
```

Reasons to use one:

- spread traffic;
- avoid sending requests to unhealthy servers;
- scale horizontally;
- hide private instances;
- perform controlled deployments.

A load balancer is not automatically fault tolerant by itself. If only one load-balancer instance exists, it can become a single point of failure. Real systems often make the load-balancing layer redundant.

---

## 14. Layer 4 load balancing

A Layer 4 load balancer works mainly with:

```text
source IP
source port
destination IP
destination port
TCP/UDP state
```

It does not need to understand that the bytes represent:

```text
GET /users
PostgreSQL query
gRPC message
TLS-encrypted data
```

### Connection stickiness

A TCP connection is stateful. Once the load balancer assigns a connection to Backend 1, all bytes of that connection must keep going to Backend 1.

![An L4 load balancer chooses a backend for a TCP connection](imgs/network-performance-page-38.png)

```text
Connection A -> Backend 1 for its entire lifetime
Connection B -> Backend 2 for its entire lifetime
```

It cannot send segment 1 to Backend 1 and segment 2 of the same connection to Backend 2. The sequence numbers and socket state would not match.

### Two L4 implementation styles

#### L4 proxy mode: two TCP connections

```text
Client <== TCP connection 1 ==> L4 proxy <== TCP connection 2 ==> Backend
```

The load balancer terminates the client connection and copies bytes to a backend connection.

#### NAT/pass-through mode: one end-to-end TCP connection

```text
Client <================ TCP =================> Backend
                    L4 NAT device rewrites addresses
```

Example:

```text
Before destination NAT:
10.0.0.5:55000 -> 44.1.1.2:443

After destination NAT:
10.0.0.5:55000 -> 10.0.0.20:443
```

The backend owns the TCP state. Return traffic is rewritten so the client still sees the public load-balancer address.

This is what “one TCP connection in Layer 4 NAT mode” means.

### Strengths

- Efficient and simple.
- Works with many TCP/UDP application protocols.
- Can preserve end-to-end encrypted payloads without understanding them.
- Does not need to parse HTTP.

### Limitations

- Usually balances per connection, not per HTTP request.
- Cannot route `/images` and `/orders` differently without application knowledge.
- Cannot directly cache HTTP responses it does not understand.
- Long-lived connections can create uneven distribution.

---

## 15. Layer 7 load balancing

A Layer 7 load balancer understands a specific application protocol, commonly HTTP.

It may inspect:

```text
Host header
URL path
HTTP method
cookies
authorization headers
content type
```

### Request-level decisions

One HTTP request may span several TCP segments. The L7 load balancer reconstructs enough protocol data to identify the logical request and apply a rule.

![The L7 load balancer parses the request carried across TCP segments](imgs/network-performance-page-49.png)

A second request on the same client connection may be routed elsewhere:

![A later HTTP request on the same client connection can go to another backend](imgs/network-performance-page-50.png)

```text
GET /users  -> User Service
POST /orders -> Order Service
GET /images -> Image Service or cache
```

A production L7 proxy does not always need to buffer the entire request body before forwarding. It can often parse headers, choose a backend, and stream the body. But it must understand enough of the protocol to know request boundaries and apply policy.

### TLS termination

To inspect HTTPS application data, the L7 load balancer normally terminates TLS:

```text
Client -- encrypted TLS --> L7 load balancer
L7 load balancer -- new connection, often TLS --> Backend
```

The public certificate and private key are therefore installed on the TLS-terminating load balancer or securely supplied through a secrets system.

### Strengths

- Smart routing by host, path, headers, method, or user attributes.
- HTTP caching.
- API gateway behavior.
- Authentication, rate limiting, and canary deployments.
- Per-request balancing, even when a client reuses one connection.

### Limitations

- More CPU and memory work: parsing, TLS, policy, and sometimes buffering.
- It must explicitly support the application protocol.
- It can become a bottleneck if poorly sized.
- Protocol parsing disagreements between proxies and backends can create security bugs such as HTTP request smuggling.

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

## 16. Databases from zero

### A database is usually a server process

PostgreSQL is not merely a file that your code opens. PostgreSQL runs as a long-lived server process.

```text
Backend application
    -> database client library
    -> socket/connection
    -> PostgreSQL server process
    -> database files on storage
```

The backend sends SQL queries through the connection. PostgreSQL validates permissions, executes the query, and returns results.

### What is database configuration?

Database configuration is a collection of settings that control how the database server behaves.

Examples:

```text
Which local IP addresses should it listen on?
Which port should it use?
Which client IPs may connect?
Which database users may authenticate?
Where is data stored?
How much memory may PostgreSQL use?
```

These settings are separate from your backend source code, although deployment tools may generate or mount them.

### When are configuration files read?

```text
PostgreSQL starts
    -> reads configuration files
    -> opens listening sockets
    -> loads access rules
    -> waits for database clients
```

Some changes can be reloaded while PostgreSQL remains running. Others require a restart.

### The two files discussed in this lecture

#### `postgresql.conf`

Controls how the PostgreSQL server runs.

```conf
# Example: accept TCP connections only through loopback
listen_addresses = 'localhost'
port = 5432
```

Or on a private database interface:

```conf
listen_addresses = '10.0.0.30'
port = 5432
```

Think of it as:

```text
Which doors does PostgreSQL open?
```

#### `pg_hba.conf`

`HBA` means host-based authentication. This file controls which clients may attempt to connect, which database/user combinations are allowed, and which authentication method is required.

```conf
# TYPE  DATABASE  USER      ADDRESS          METHOD
host    appdb     app_user  127.0.0.1/32     scram-sha-256
```

Meaning:

```text
Connection type: TCP/IP
Database:        appdb
Database user:   app_user
Allowed source:  exactly 127.0.0.1
Authentication:  SCRAM password authentication
```

Think of it as:

```text
Who is permitted to walk through an opened door?
```

### `/32` means exactly one IPv4 address

IPv4 contains 32 bits.

```text
127.0.0.1/32 -> all 32 bits must match
10.0.0.20/32 -> exactly that one host
10.0.0.0/24  -> addresses in the 10.0.0.x subnet
0.0.0.0/0    -> every IPv4 address
```

Do not use `0.0.0.0/0` for a production database merely because it makes connection problems disappear.

### Safe two-machine example

```text
Backend:  10.0.0.20
Database: 10.0.0.30
```

`postgresql.conf` on the database server:

```conf
listen_addresses = '10.0.0.30'
port = 5432
```

`pg_hba.conf`:

```conf
# Allow only this backend host to connect as app_user to appdb
host    appdb    app_user    10.0.0.20/32    scram-sha-256
```

Now PostgreSQL checks multiple gates:

```text
1. Did the connection reach an address PostgreSQL listens on?
2. Does pg_hba.conf allow this source IP/database/user combination?
3. Are the supplied credentials correct?
4. Does this database user have permission for the requested SQL operation?
```

Network allow-listing does not replace passwords and database permissions. It adds another barrier.

### Local Unix-domain sockets are not loopback TCP

A PostgreSQL `local` rule usually refers to a Unix-domain socket on Unix-like systems.

```text
Backend process
    -> Unix-domain socket
    -> PostgreSQL process
```

Both are separate processes on the same machine, but the communication does not travel through TCP/IP or `127.0.0.1`.

Example rule:

```conf
local   appdb   app_user   scram-sha-256
```

### Find the real configuration paths

After connecting to PostgreSQL, ask it directly:

```sql
SHOW config_file;
SHOW hba_file;
```

Locations vary by OS, package manager, container image, and managed service.

### Reload configuration

Some settings can be re-read without a full restart:

```sql
SELECT pg_reload_conf();
```

Changes such as `listen_addresses` commonly require a restart because PostgreSQL must reopen listening sockets.

### Backend connection string

A backend may receive its database address through an environment variable:

```env
DATABASE_URL=postgresql://app_user:strong-password@10.0.0.30:5432/appdb
```

Parts:

```text
postgresql://        protocol/driver scheme
app_user             database username
strong-password      credential
10.0.0.30            database server IP or hostname
5432                 PostgreSQL port
appdb                target database
```

Do not commit real production passwords into Git. Use environment variables or a secrets-management system.

### Why “listen on everything” is dangerous

This combination is especially risky:

```conf
# postgresql.conf
listen_addresses = '*'
```

```conf
# pg_hba.conf
host    all    all    0.0.0.0/0    scram-sha-256
```

It invites every reachable IPv4 host to attempt authentication. Even with a password, attackers can scan the port, guess credentials, exploit mistakes, and consume resources.

A database should normally be reachable only from the exact private networks and backend identities that need it. Cloud firewalls/security groups should restrict the port as well; PostgreSQL’s own configuration is not the only defensive layer.

---

## 17. One complete backend request

Here is how the topics connect.

```text
1. A browser knows https://api.example.com/orders.
2. DNS resolves api.example.com to a public reverse-proxy IP.
3. The browser opens or reuses a connection.
4. TCP applies congestion control, ordering, ACK behavior, and retransmission.
5. The public server is listening on an IP:port, commonly 0.0.0.0:443 behind firewall rules.
6. An L7 reverse proxy terminates TLS and reads POST /orders.
7. It routes the request to an Order Service using a warm pooled connection.
8. The Order Service borrows a PostgreSQL connection from its database pool.
9. PostgreSQL accepts it only if listen_addresses, network controls, pg_hba.conf, credentials, and SQL permissions all allow it.
10. The response travels back through the same chain.
```

Possible performance problems now have clear locations:

```text
DNS delay
new TCP/TLS handshakes
slow start
Nagle + delayed ACK
packet loss and TCP head-of-line blocking
overloaded reverse proxy
empty connection pool
slow SQL query
database connection limit
```

---

## 18. Compact memory sheet

```text
MTU
Maximum IP packet size supported by a link/interface configuration.

MSS
Maximum TCP application payload in one segment.

Path MTU Discovery
Finds the smallest usable MTU on the route, often with ICMP feedback.

Nagle's algorithm
Holds small writes while older data is unacknowledged.

Delayed ACK
Briefly waits so one ACK may acknowledge more received data.

Slow start
A new TCP connection gradually learns how much in-flight data the path can handle.

Persistent connection
One open connection reused for multiple exchanges.

Connection pool
A managed set of reusable open connections.

Backend startup
The one-time initialization phase before the long-running server becomes ready.

Eager loading
Prepare during startup; slower startup, faster first use.

Lazy loading
Prepare on demand; faster startup, slower first use.

TCP Fast Open
Allows a validated returning client to send early data during a new handshake.

Listening
Registering a local IP:port so the OS delivers matching new connections to a server process.

Loopback
Network communication that stays inside the same machine.

Forward proxy
Represents clients when contacting destinations.

Reverse proxy
Represents backend servers behind one public endpoint.

Sidecar
A helper process deployed beside a service.

Service mesh
A network-management layer for service-to-service communication, often built from sidecar proxies.

Layer 4 load balancer
Balances TCP/UDP flows using connection and address information.

Layer 7 load balancer
Understands an application protocol and can balance logical requests.

pg_hba.conf
PostgreSQL rules controlling which clients/users/databases may authenticate and how.
```

---

## 19. Selected commands and snippets

### Test an HTTP endpoint

```bash
curl https://api.example.com/users
```

### Request TCP Fast Open when supported

```bash
curl --tcp-fastopen https://example.com/
```

### See local IP configuration

Windows:

```powershell
ipconfig
```

Linux:

```bash
ip address
```

macOS:

```bash
ifconfig
```

### Inspect the neighbor/ARP table on Linux

```bash
ip neigh show
```

### PostgreSQL configuration locations

```sql
SHOW config_file;
SHOW hba_file;
```

### Ask PostgreSQL to reload reloadable configuration

```sql
SELECT pg_reload_conf();
```

---

## Sources used in this chapter

- *Network Performance* lecture slides: selected visuals for MTU/MSS, PMTUD, Nagle, delayed ACK, listening sockets, `SO_REUSEPORT`, TCP head-of-line blocking, and Layer 4/Layer 7 load balancing.
- *Proxy vs Reverse Proxy* lecture slides: proxy/reverse-proxy diagrams and use cases.
- The lecture transcripts and the clarification questions developed throughout this study session.

