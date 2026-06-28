# Lecture 00 — Internet Fundamentals
### How computers actually talk to each other

---

> [!IMPORTANT]
> **This is an overview — not a deep dive.**
>
> Everything in this lecture will be covered in detail later in the course.
> For now, you do **not** need to fully understand every single word.
> You do **not** need to memorize commands, code, or definitions.
>
> Just read through it. Get the big picture. See how the pieces connect.
> That's the only goal of Lecture 00.

---

# Part 1 — Foundations

## 1. What Is a Network?

A network is any group of devices that can communicate with each other.

Devices on a network are usually called **hosts**, **end systems**, or just **machines**.

```
Laptop ──► Router ──► Internet ──► Server
```

The laptop wants something. The server has it. The network carries the data.

---

## 2. Client and Server

Almost all backend communication follows the **client-server model**.

```
Client ──── request ────► Server
Client ◄─── response ─── Server
```

**Client** — the side that initiates requests
- Browser, mobile app, desktop app, `curl`, Postman

**Server** — the side that waits and responds
- Web server, API server, database server, file server

> As a backend developer, you write the **server side**.

---

## 3. IP Address

An IP address is the address of a machine on a network.

```
192.168.1.10        ← private (inside your home/office network)
142.250.200.14      ← public (reachable from the Internet)
```

> **Analogy:** IP address = building address

Computers don't understand `google.com`. They communicate using IP addresses. DNS (covered next) bridges that gap.

**Two versions exist:**

| Version | Example | Notes |
|---------|---------|-------|
| IPv4 | `192.168.1.1` | 4 numbers, most common |
| IPv6 | `2001:0db8::1` | longer, newer, more addresses |

---

## 4. Port Number

One machine can run many programs at once. The port identifies *which program* should receive incoming data.

```
192.168.1.10:3000
      │        │
  machine    app inside the machine
```

> **Analogy:** IP = building address, Port = apartment number

**Common ports to memorize:**

| Port | Used For |
|------|----------|
| 80 | HTTP |
| 443 | HTTPS |
| 22 | SSH |
| 53 | DNS |
| 5432 | PostgreSQL |
| 3306 | MySQL |
| 3000 | Common local backend |
| 8080 | Common local backend (alt) |

When you run `npm start` or `python app.py` and see `Listening on port 3000` — that's your server waiting for connections on port 3000.

---

## 5. DNS — Domain Name System

DNS converts human-readable domain names into IP addresses.

```
google.com  ──►  DNS lookup  ──►  142.250.200.14
```

> **Analogy:** DNS = phonebook. Domain = person's name. IP = phone number.

**Without DNS**, you'd have to type IP addresses into your browser.

**What happens during a DNS lookup:**

```
Browser ──► "What is the IP of example.com?"
                        │
                   DNS Server
                        │
Browser ◄── "93.184.216.34"
                        │
Browser ──► Connects to 93.184.216.34
```

**Backend relevance:** Your API server has a domain (e.g. `api.yourapp.com`). DNS maps that domain to your server's IP. When you update your server, you update the DNS record.

---

## 6. Packet

Data doesn't travel as one giant blob. It's split into small pieces called **packets**.

```
Large file:
[  Packet 1  ] [  Packet 2  ] [  Packet 3  ] ...
       │               │               │
       └───────────────┴───────────────┴──► travel independently
                                            reassembled at destination
```

> **Analogy:** Shipping a large item in multiple boxes. Each box travels separately. The recipient assembles them.

Packets from the same message can take different routes and arrive out of order. TCP handles reassembly. UDP doesn't.

---

## 7. Router

A router moves packets between networks, one hop at a time.

```
Your Laptop ──► Home Router ──► ISP Router ──► Internet ──► Server
```

A router doesn't read your full message. It only asks:

> *"Where should this packet go next?"*

It makes that decision based on the packet's **destination IP address**.

---

## 8. ISP

Your **Internet Service Provider** (ISP) connects your home or office network to the wider Internet.

Examples: Vodafone, Orange, WE, Etisalat, Comcast, AT&T

```
Your device
     │
Home router
     │
ISP network
     │
Internet backbone
     │
Destination server
```

---

## 9. Protocol

A protocol is a set of rules that two machines agree on before communicating.

> **Analogy:** A phone call has rules — one person talks, the other listens, you say "hello" first. Protocols do the same thing for computers.

**Key protocols you'll encounter:**

| Protocol | Handles |
|----------|---------|
| HTTP/HTTPS | Web requests and responses |
| TCP | Reliable data delivery |
| UDP | Fast delivery, no guarantee |
| IP | Addressing and routing |
| DNS | Name-to-IP resolution |
| TLS | Encryption |
| SSH | Secure remote access |

---

# Part 2 — The Network Layers

The Internet is built in layers. Each layer has one job, and depends on the layer below it.

```
┌─────────────────────────────────────┐
│  Application Layer  (HTTP, DNS)     │  ← You work here
├─────────────────────────────────────┤
│  Transport Layer    (TCP, UDP)      │  ← Reliable/fast delivery
├─────────────────────────────────────┤
│  Network Layer      (IP, routing)   │  ← Addressing + routing
├─────────────────────────────────────┤
│  Link Layer         (Ethernet, WiFi)│  ← Local network
├─────────────────────────────────────┤
│  Physical Layer     (cables, radio) │  ← Actual bits on wire
└─────────────────────────────────────┘
```

### Layer 5 — Application
Where your backend code lives. HTTP, DNS, APIs, WebSockets.

### Layer 4 — Transport
**TCP** — reliable, ordered, error-checked. Used by HTTP, APIs, SSH, databases.
**UDP** — fast, connectionless, no delivery guarantee. Used by DNS, video calls, games.

### Layer 3 — Network
The **IP** protocol lives here. Handles addressing (who is this going to?) and routing (how do we get it there?). Routers operate at this layer.

### Layer 2 — Link
Handles data transfer on the **local network** — between your laptop and your router, for example. Ethernet and Wi-Fi live here.

### Layer 1 — Physical
Actual physical transmission: electrical signals on copper cables, light pulses on fiber, radio waves for Wi-Fi.

---

## 10. Encapsulation

As data travels down the layers, each layer **wraps it with its own header**.

```
Your data:    "GET /users HTTP/1.1"
                        │
         + TCP header (port, sequence number)
                        │
              + IP header (source IP, dest IP)
                        │
                + Ethernet frame (MAC addresses)
                        │
              Sent as physical bits ──────────────►
```

At the receiver, the process reverses — each layer strips off its header until the original data is exposed.

> **Analogy:** A letter inside an envelope inside a shipping box inside a truck. Each layer of packaging serves a different part of the journey.

---

# Part 3 — Important Concepts

## 11. TCP — How Reliable Delivery Works

Before two machines exchange data over TCP, they perform a **3-way handshake**:

```
Client ──── SYN ──────────────────────► Server
Client ◄─── SYN-ACK ─────────────────  Server
Client ──── ACK ──────────────────────► Server
         [connection established]
```

**SYN** = "I want to connect"
**SYN-ACK** = "OK, I'm ready"
**ACK** = "Great, let's go"

After this, data flows reliably. TCP tracks every packet, requests retransmission of anything lost, and delivers data in the correct order.

**Use TCP when:** accuracy matters more than speed (APIs, web pages, file transfers, databases).

---

## 12. UDP — How Fast Delivery Works

UDP skips the handshake. It just sends.

```
Client ──── data ──────────────────────► Server  (maybe arrives)
Client ──── data ──────────────────────► Server  (maybe arrives)
Client ──── data ──────────────────────► Server  (maybe arrives)
```

No confirmation. No retransmission. No ordering guarantee.

**Use UDP when:** speed matters more than perfection (video calls, live streaming, gaming, DNS).

> A dropped video frame is fine. A dropped bank transaction is not.

---

## 13. HTTP — The Language of the Web

HTTP is the protocol your browser and backend use to communicate.

**A request has:**
```
GET /users HTTP/1.1
Host: api.example.com
Authorization: Bearer <token>
```

**A response has:**
```
HTTP/1.1 200 OK
Content-Type: application/json

{"users": [...]}
```

**Common HTTP methods:**

| Method | Meaning |
|--------|---------|
| GET | Retrieve data |
| POST | Create something |
| PUT | Replace something |
| PATCH | Update part of something |
| DELETE | Remove something |

**Status codes you must know:**

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 301/302 | Redirect |
| 400 | Bad request (client error) |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 500 | Server error |
| 503 | Service unavailable |

---

## 14. localhost and 127.0.0.1

`localhost` points to your own machine. It always resolves to `127.0.0.1`.

```
http://localhost:3000
       │         │
  your own     port where your
  computer     app is running
```

When you develop locally, you're the client and the server at the same time, on the same machine.

---

## 15. Public IP vs. Private IP

**Private IPs** — used inside local networks, not routable on the Internet

```
192.168.x.x       ← home/office networks
10.x.x.x          ← larger private networks
172.16.x.x–172.31.x.x
```

**Public IP** — your router's address, visible to the Internet

```
Your devices (private IPs)
        │
   Home Router  ◄── has the public IP
        │
    Internet
```

---

## 16. NAT — Network Address Translation

NAT lets many devices with private IPs share one public IP.

```
Phone   192.168.1.5  ─┐
Laptop  192.168.1.8  ─┼──► Router (public IP: 1.2.3.4) ──► Internet
Tablet  192.168.1.12 ─┘
```

The router remembers which internal device made each request and routes responses back correctly.

> **Analogy:** A company's receptionist. Outside callers dial one number. The receptionist routes to the right person.

---

# Part 4 — Debugging Commands

These are the tools you'll use to diagnose networking problems in the real world.

### Linux / Mac

```bash
# What's my IP address?
ip addr
ifconfig

# Can I reach this machine?
ping google.com

# What path do packets take?
traceroute google.com

# What IP does this domain resolve to?
nslookup google.com
dig google.com

# Make an HTTP request
curl https://example.com
curl -v https://example.com    # verbose — shows headers

# What ports are open / active connections?
ss -tulnp
netstat -tulnp
```

### Windows

```cmd
ipconfig
ping google.com
tracert google.com
nslookup google.com
curl https://example.com
netstat -ano
```

### Quick Reference

| Command | Answers |
|---------|---------|
| `ip addr` / `ipconfig` | What is my IP? |
| `ping` | Can I reach this host? |
| `traceroute` / `tracert` | What path do packets take? |
| `nslookup` / `dig` | What IP does this domain resolve to? |
| `curl -v` | What does the full HTTP exchange look like? |
| `ss` / `netstat` | What ports are open? What's connected? |

---

# Part 5 — Full Flow: What Happens When You Open a Website

Let's trace `https://google.com` through everything you've learned:

```
1. DNS Lookup
   Browser asks DNS server: "What is the IP for google.com?"
   DNS replies: 142.250.200.14

2. TCP Handshake
   Browser → Server: SYN
   Server → Browser: SYN-ACK
   Browser → Server: ACK

3. TLS Handshake (because HTTPS)
   Browser and server negotiate encryption keys

4. HTTP Request
   Browser sends: GET / HTTP/1.1
                  Host: google.com

5. HTTP Response
   Server sends: 200 OK + HTML

6. Browser renders the page
```

Every step is a concept from this lecture. Now it's one connected story.

---

# Checklist — What You Should Know After This

- [ ] What is an IP address, and why do computers need it?
- [ ] What is a port, and why does one machine need thousands of them?
- [ ] What is DNS and what problem does it solve?
- [ ] What is a packet? Why is data split into packets?
- [ ] What does a router actually do?
- [ ] What is a protocol?
- [ ] What is the difference between TCP and UDP? When do you use each?
- [ ] What is the 3-way handshake?
- [ ] What are the 5 network layers? What lives in each?
- [ ] What is encapsulation?
- [ ] What is localhost / 127.0.0.1?
- [ ] What is the difference between a public and private IP?
- [ ] What is NAT?
- [ ] How does HTTPS work at a high level?
- [ ] What do `ping`, `traceroute`, `nslookup`, and `curl -v` tell you?

---

← [Back to main README](../README.md)