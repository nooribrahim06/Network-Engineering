![Fundamentals of Network Engineering for Effective Backends](./lec%201/imgs/Main.png)

# Network Engineering Fundamentals

A zero-to-backend roadmap for understanding how computers actually communicate — from IP, DNS, and TCP/UDP all the way to TLS, proxies, load balancers, Docker networking, and reading real Wireshark packet captures.

**One question drives the whole repo:** what really happens when one computer talks to another?

Every lecture builds on the last, going from bare networking concepts to real backend behavior: sockets, connection pooling, TLS handshakes, database traffic, and Docker network internals. Each folder has its own `README.md` with diagrams, commands, and hands-on labs.

## Credit

The concepts in this repository were learned from Hussein Nasser's Udemy course, [Fundamentals of Networking for Effective Backend Design](https://www.udemy.com/course/fundamentals-of-networking-for-effective-backend-design/).

Certificate of completion:

![Certificate of Completion](./lec%201/imgs/certificate.jpg)

## Lectures

| # | Lecture | Covers |
|---|---|---|
| [00](./lec%200%20-%20intro/README.md) | Internet Fundamentals | Client/server, IP, ports, DNS, packets, routers, NAT — the big picture before the details |
| [01](./lec%201/README.md) | Fundamentals of Networking | OSI/TCP-IP layers, encapsulation, switches, routers, proxies, load balancers |
| [02](./lec%202%20-%20IP/README.md) | IP, Packets, ICMP, ARP & Routing | Subnetting, gateways, packet headers, TTL, ARP, routing decisions |
| [03](./lec%203%20-%20UDP/README.md) | UDP | Ports, datagrams, multiplexing, UDP servers in Node.js and C |
| [04](./lec%204%20-%20TCP/README.md) | TCP | Handshake, sequence/ACK, retransmission, sockets, TCP server states and queues |
| [05](./lec%205%20-%20protocols/README.md) | DNS, TLS & HTTPS | DNS hierarchy, certificates, TLS 1.2/1.3, HTTPS labs with OpenSSL |
| [06](./lec%206%20-%20Network%20Performance/README.md) | Backend Network Performance | Latency sources, connection pooling, Nagle/delayed ACK, service mesh, load balancing |
| [07](./lec%207%20-%20Routing%26Docker/README.md) | Routing & Docker Networking | Routing tables, longest-prefix match, Docker bridges and internal DNS |
| [08](./lec%208%20-%20WireSharking/README.md) | Wireshark for Backend Engineers | Capture/display filters, TLS decryption, HTTP/2, MongoDB wire traffic |