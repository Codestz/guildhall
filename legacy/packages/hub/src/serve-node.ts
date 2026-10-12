import { createHash } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"

/**
 * The part of `Bun.serve` the hub uses, on Node's `node:http`, so the hub runs where only Node is
 * installed (a Claude Code user without Bun). On Bun the hub calls `Bun.serve` itself; this is never
 * loaded there. WebSocket (RFC 6455) is the server side only, enough for a hall: text out, close and
 * ping answered, messages in passed on whole (at most MAX_MESSAGE bytes).
 */

/** What the hub's handlers see of a hall's connection; Bun's `ServerWebSocket` is one too. */
export interface HubSocket {
  readonly readyState: number
  /** Bun's meaning: bytes sent, -1 when queued behind unread bytes, 0 when dropped. */
  send(text: string): number
  getBufferedAmount(): number
  terminate(): void
}

/** What a request handler sees of the server; Bun's `Server` is one too. */
export interface HubServerRef {
  readonly port?: number
  upgrade(request: Request, options: { data: undefined }): boolean
}

/** What `startHub` gives back; Bun's `Server` is one too. */
export interface HubServer {
  readonly port?: number
  stop(closeActiveConnections?: boolean): unknown
}

export interface ServeOptions {
  hostname: string
  port: number
  maxRequestBodySize: number
  fetch(request: Request, server: HubServerRef): Response | undefined | Promise<Response | undefined>
  websocket: {
    open(socket: HubSocket): void
    close(socket: HubSocket): void
    message(socket: HubSocket, message: string | Buffer): void
  }
}

/** A message from a hall larger than this closes its connection (1009). */
const MAX_MESSAGE = 1024 * 1024
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const OPEN = 1
const CLOSED = 3

export function serveNode(options: ServeOptions): HubServer {
  const sockets = new Set<Duplex>()
  const server = createServer(async (req, res) => {
    try {
      const body = await readBody(req, options.maxRequestBodySize)
      if (body === null) {
        res.writeHead(413).end("payload too large")
        req.destroy()
        return
      }
      const response = await options.fetch(
        toRequest(req, body),
        ref(() => false),
      )
      if (!response) return void res.end()
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })
      res.writeHead(response.status, headers)
      res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined)
    } catch {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => socket.destroy())
    let upgraded = false
    try {
      const response = await options.fetch(
        toRequest(req, undefined),
        ref((request) => {
          const key = request.headers.get("sec-websocket-key")
          if (!key || request.headers.get("sec-websocket-version") !== "13") return false
          const accept = createHash("sha1")
            .update(key + GUID)
            .digest("base64")
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n" +
              `sec-websocket-accept: ${accept}\r\n\r\n`,
          )
          upgraded = true
          return true
        }),
      )
      if (upgraded) return void accept(socket, head, options.websocket)
      const status = response?.status ?? 400
      const text = response ? await response.text() : ""
      socket.end(
        `HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Request"}\r\n` +
          `content-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`,
      )
    } catch {
      socket.destroy()
    }
  })

  function ref(upgrade: (request: Request) => boolean): HubServerRef {
    return {
      get port() {
        return handle.port
      },
      upgrade: (request) => upgrade(request),
    }
  }

  // Listening fails (the port is taken) as an `error` event: unhandled, it ends the process, as
  // Bun.serve's throw does.
  server.listen(options.port, options.hostname)
  const handle: HubServer = {
    get port() {
      const address = server.address()
      return address && typeof address === "object" ? address.port : options.port || undefined
    },
    stop(closeActiveConnections) {
      server.close()
      if (closeActiveConnections) for (const socket of sockets) socket.destroy()
    },
  }
  return handle
}

/** The request body, or null once it passes `max` bytes. */
async function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  if (Number(req.headers["content-length"] ?? 0) > max) return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > max) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function toRequest(req: IncomingMessage, body: Buffer | undefined): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(key, one)
  }
  const method = req.method ?? "GET"
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  return new Request(url.href, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" || !body?.length ? undefined : body,
  })
}

/** One frame, server to client: final, unmasked. */
function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length
  const head =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : length < 65536
        ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), u64(length)])
  return Buffer.concat([head, payload])
}

function u64(n: number): Buffer {
  const out = Buffer.alloc(8)
  out.writeBigUInt64BE(BigInt(n))
  return out
}

/** Runs an upgraded connection: frames in, `HubSocket` out to the handlers. */
function accept(socket: Duplex, head: Buffer, handlers: ServeOptions["websocket"]): void {
  let state = OPEN
  const hall: HubSocket = {
    get readyState() {
      return state
    },
    send(text) {
      if (state !== OPEN || socket.destroyed) return 0
      const data = frame(0x1, Buffer.from(text))
      return socket.write(data) ? data.length : -1
    },
    getBufferedAmount: () => (socket as Duplex & { writableLength: number }).writableLength,
    terminate: () => socket.destroy(),
  }
  const closeWith = (code: number) => {
    if (state !== OPEN) return
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(code)
    socket.end(frame(0x8, payload))
    state = CLOSED
  }
  socket.on("close", () => {
    state = CLOSED
    handlers.close(hall)
  })

  let pending: Buffer = head ?? Buffer.alloc(0)
  let message: Buffer[] = []
  let messageSize = 0
  let messageText = true
  const read = () => {
    while (pending.length >= 2) {
      const first = pending[0] as number
      const second = pending[1] as number
      const fin = (first & 0x80) !== 0
      const opcode = first & 0x0f
      if ((second & 0x80) === 0) return closeWith(1002) // A client's frames are always masked.
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (pending.length < 4) return
        length = pending.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (pending.length < 10) return
        const big = pending.readBigUInt64BE(2)
        if (big > BigInt(MAX_MESSAGE)) return closeWith(1009)
        length = Number(big)
        offset = 10
      }
      if (length > MAX_MESSAGE) return closeWith(1009)
      if (pending.length < offset + 4 + length) return
      const mask = pending.subarray(offset, offset + 4)
      const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length))
      for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] as number) ^ (mask[i & 3] as number)
      pending = pending.subarray(offset + 4 + length)

      if (opcode === 0x8) return closeWith(payload.length >= 2 ? payload.readUInt16BE(0) : 1000)
      if (opcode === 0x9) {
        if (state === OPEN) socket.write(frame(0xa, payload))
        continue
      }
      if (opcode === 0xa) continue
      if (opcode === 0x1 || opcode === 0x2) {
        message = []
        messageSize = 0
        messageText = opcode === 0x1
      } else if (opcode !== 0x0) return closeWith(1002)
      messageSize += payload.length
      if (messageSize > MAX_MESSAGE) return closeWith(1009)
      message.push(payload)
      if (fin) {
        const whole = Buffer.concat(message)
        message = []
        messageSize = 0
        handlers.message(hall, messageText ? whole.toString("utf8") : whole)
      }
    }
  }
  socket.on("data", (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    read()
  })
  handlers.open(hall)
  if (pending.length) read()
}
