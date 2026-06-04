import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { once } from "node:events";
import { EgressProxy } from "./egress.js";

let proxy: EgressProxy | null = null;
let upstream: Server | null = null;
afterEach(() => {
  proxy?.stop();
  upstream?.close();
  proxy = null;
  upstream = null;
});

/** Make a plain-HTTP request *through* the proxy (absolute-URI form). */
function viaProxy(proxyPort: number, targetUrl: string): Promise<{ status: number; body: string }> {
  const u = new URL(targetUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: proxyPort, method: "GET", path: targetUrl, headers: { host: u.host } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("EgressProxy", () => {
  it("forwards to an allow-listed host and blocks others", async () => {
    upstream = createServer((_req, res) => res.writeHead(200).end("upstream-ok"));
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upPort = (upstream.address() as { port: number }).port;
    const upHost = `127.0.0.1:${upPort}`;

    proxy = new EgressProxy((host) => host === "127.0.0.1");
    const port = await proxy.start();

    const allowed = await viaProxy(port, `http://${upHost}/`);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toBe("upstream-ok");
  });

  it("denies a non-allow-listed host with 403 (HTTP)", async () => {
    proxy = new EgressProxy(() => false);
    const port = await proxy.start();
    const denied = await viaProxy(port, "http://evil.example.com/");
    expect(denied.status).toBe(403);
    expect(denied.body).toMatch(/egress denied/);
  });

  it("denies a non-allow-listed host on CONNECT (HTTPS tunnel)", async () => {
    proxy = new EgressProxy(() => false);
    const port = await proxy.start();
    const response = await new Promise<string>((resolve, reject) => {
      const sock = netConnect(port, "127.0.0.1", () => {
        sock.write("CONNECT evil.example.com:443 HTTP/1.1\r\nHost: evil.example.com:443\r\n\r\n");
      });
      let data = "";
      sock.on("data", (c) => {
        data += c.toString();
        if (data.includes("\r\n\r\n")) {
          sock.destroy();
          resolve(data);
        }
      });
      sock.on("error", reject);
    });
    expect(response).toMatch(/403 Forbidden/);
  });

  it("strips the port before checking the host", async () => {
    const seen: string[] = [];
    proxy = new EgressProxy((host) => {
      seen.push(host);
      return false;
    });
    const port = await proxy.start();
    await viaProxy(port, "http://example.com:8080/");
    expect(seen).toContain("example.com");
  });
});
