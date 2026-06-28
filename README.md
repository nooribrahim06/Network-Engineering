# Network Engineering Fundamentals
### A Backend Developer's Guide to How the Internet Actually Works

> **One question drives everything in this repo:**
> *What really happens when one computer talks to another computer?*

---

## Who this is for

You're learning backend development. You can write an API. But when something breaks — a timeout, a connection refused, a slow response — you don't know where to look. This repo fixes that.

Networking is not optional for backend devs. Your code runs inside a network. Understanding that network is what separates a developer who guesses from one who debugs.

---

## The Big Picture

Everything in this repo explains this one scenario:

```
You type: https://google.com
```

What actually happens?

```
1. Your browser asks DNS: "What's the IP for google.com?"
2. DNS replies: "142.250.200.14"
3. Your browser opens a TCP connection to 142.250.200.14:443
4. Your browser sends an HTTPS (HTTP over TLS) request
5. Google's server sends back an HTTP response
6. Your browser renders the page
```

That's DNS → IP → TCP → HTTP → response. These are the layers. This repo teaches all of them.

---

## Why Backend Developers Need This

```
User (Browser / Mobile App)
         │
         ▼
     Internet
         │
         ▼
  Your Backend App   ◄── You live here
         │
         ▼
  Database / Services
```

Your backend app doesn't live in isolation. Every request that reaches it, and every response you send back, travels through a network. To debug production issues, you need to understand what's happening at each step.

---

## Concept Map

```
DNS          → converts domain names to IP addresses
IP Address   → identifies a machine on the network
Port         → identifies a specific app inside a machine
Packet       → small chunk of data sent across the network
Router       → forwards packets toward their destination
Protocol     → agreed rules for how machines communicate
TCP          → reliable, ordered delivery
UDP          → fast delivery, no guarantees
HTTP         → the language of web requests and responses
TLS/HTTPS    → encrypted HTTP
NAT          → many private devices sharing one public IP
```

---

## Repo Structure

```
network-engineering-fundamentals/
│
├── README.md                        ← You are here
│
├── lec-00/
│   └── README.md                    ← Start here: Internet fundamentals
│
├── lec-01/
│   └── README.md                    ← Coming soon
│
├── labs/
│   ├── 01-basic-commands.md
│   ├── 02-wireshark-walkthrough.md
│   └── 03-build-tcp-echo-server.md
│
└── assets/
    └── diagrams/
```

---

## How to Use This Repo

Study in order. Each lecture builds on the previous one.

Start with **lec-00** — it gives you the mental model everything else depends on.

> Networking is a system, not a list of definitions.
> Keep one picture in your head:
>
> ```
> Client sends data → Network carries it → Server receives and responds
> ```
>
> Everything else explains *how* that happens reliably, at scale, across the planet.