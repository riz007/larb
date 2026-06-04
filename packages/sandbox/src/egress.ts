import { createServer, type Server, type IncomingMessage, request as httpRequest } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { once } from "node:events";

/** Decides whether egress to a host is permitted. May be async (e.g. a prompt). */
export type HostCheck = (host: string) => boolean | Promise<boolean>;

/**
 * Host-side forward proxy that enforces a per-host egress allow-list. The
 * container backend points a confined container's HTTP(S)_PROXY at this server,
 * so all proxy-respecting egress is default-denied and only allow-listed hosts
 * get through — the SPEC's "network egress allow-listed per run" (§7.3/§9),
 * enforced at the boundary rather than trusted to the command.
 *
 * It handles plain HTTP (absolute-URI requests) and HTTPS via the CONNECT
 * method. A denied host gets `403`; it never opens the upstream socket. (Raw
 * sockets that ignore proxy settings are out of scope for this backend — that
 * needs the microVM/internal-network backend; this covers package managers,
 * curl, fetch, and the like, which honor the proxy env.)
 */
export class EgressProxy {
  private server: Server | null = null;
  private port = 0;

  constructor(private readonly allow: HostCheck) {}

  /** Start listening on an ephemeral loopback port; returns the port. */
  async start(): Promise<number> {
    const server = createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    server.on("connect", (req, socket) => {
      void this.handleConnect(req, socket as Socket);
    });
    this.server = server;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const addr = server.address();
    this.port = typeof addr === "object" && addr ? addr.port : 0;
    return this.port;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  getPort(): number {
    return this.port;
  }

  private async permitted(host: string): Promise<boolean> {
    try {
      return await this.allow(stripPort(host));
    } catch {
      return false;
    }
  }

  /** Plain-HTTP proxying: the request line carries an absolute URI. */
  private async handleHttp(
    req: IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    if (!(await this.permitted(target.host))) {
      res.writeHead(403).end(`egress denied: ${target.host}`);
      return;
    }
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port || 80,
        method: req.method,
        path: target.pathname + target.search,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end("upstream error"));
    req.pipe(upstream);
  }

  /** HTTPS via CONNECT host:port — we tunnel bytes only to allow-listed hosts. */
  private async handleConnect(req: IncomingMessage, client: Socket): Promise<void> {
    const host = req.url ?? "";
    if (!(await this.permitted(host))) {
      client.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      client.destroy();
      return;
    }
    const [hostname, portStr] = host.split(":");
    const upstream = netConnect(Number(portStr) || 443, hostname, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
  }
}

function stripPort(host: string): string {
  const i = host.lastIndexOf(":");
  return i > 0 ? host.slice(0, i) : host;
}
