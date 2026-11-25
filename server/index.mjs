import http from "node:http";
import {
  createReadStream,
  existsSync,
  statSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { createWorld, addPlayer, stepWorld, snapshot } from "./world.mjs";
import { publicLevel, stages } from "../shared/level.mjs";
import {
  INPUT_PROTOCOL,
  acceptInputFrames,
  consumeInputFrame,
} from "../shared/prediction.mjs";
import { normalizeAssetBase, assetCsp } from "../shared/asset-config.mjs";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ttf": "font/ttf",
  ".xml": "application/xml",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () =>
  [...randomBytes(6)].map((v) => alphabet[v % alphabet.length]).join("");
const neutral = () => ({
  axis: 0,
  jump: false,
  run: false,
  fire: false,
  down: false,
});
const cleanName = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}<>]/gu, "")
    .trim()
    .slice(0, 16) || "玩家";
const validCode = (code) =>
  typeof code === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(code);

export function createGameServer(options = {}) {
  const manifestPath = path.join(root, "asset-manifest.json");
  const assetManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : {};
  const assetBaseURL = normalizeAssetBase(
    options.assetBaseURL ?? assetManifest.baseURL ?? "",
  );
  const contentSecurityPolicy = assetCsp(assetBaseURL);
  const rooms = new Map();
  const maxRooms = Number(options.maxRooms ?? process.env.MAX_ROOMS ?? 8);
  const maxPlayers = Number(
    options.maxPlayers ?? process.env.MAX_PLAYERS ?? 16,
  );
  const reconnectMs = Number(options.reconnectMs ?? 45000);
  const connections = new Set();
  const origins = new Set(
    String(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  const server = http.createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", contentSecurityPolicy);
    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (url.pathname === "/api/health") {
      response.setHeader("Cache-Control", "no-store");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          service: "mario-coop",
          assetBaseURL,
          rooms: rooms.size,
          players: [...rooms.values()].reduce(
            (n, r) =>
              n + [...r.players.values()].filter((p) => p.connected).length,
            0,
          ),
          capacity: { maxRooms, maxPlayers },
        }),
      );
      return;
    }
    if (
      url.pathname === "/api/lobby" &&
      ["GET", "HEAD"].includes(request.method)
    ) {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      const list = [...rooms.values()]
        .filter(
          (r) =>
            r.visibility === "public" &&
            [...r.players.values()].some((p) => p.connected),
        )
        .map((r) => ({
          code: r.code,
          title: r.title,
          host: r.players.get(r.hostId)?.name || "玩家",
          players: [...r.players.values()].filter((p) => p.connected).length,
          seats: r.players.size,
          maxPlayers: r.maxPlayers,
          phase: r.world?.phase || "lobby",
          stage: r.world?.level.stage || r.stage,
          joinable: !r.world && r.players.size < r.maxPlayers,
        }));
      response.end(
        JSON.stringify({
          rooms: list,
          online: [...rooms.values()].reduce(
            (n, r) =>
              n + [...r.players.values()].filter((p) => p.connected).length,
            0,
          ),
          capacity: { maxRooms, maxPlayers },
        }),
      );
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      decoded.includes("\0") ||
      decoded.split("/").some((segment) => segment.startsWith("."))
    ) {
      response.writeHead(404).end();
      return;
    }
    const filename = path.resolve(
      root,
      `.${decoded === "/" ? "/index.html" : decoded}`,
    );
    if (
      !filename.startsWith(root) ||
      !existsSync(filename) ||
      !statSync(filename).isFile()
    ) {
      response.writeHead(404).end("Not found");
      return;
    }
    const info = statSync(filename);
    const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
    response.setHeader("ETag", etag);
    response.setHeader(
      "Cache-Control",
      filename.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    );
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304).end();
      return;
    }
    response.setHeader(
      "Content-Type",
      MIME[path.extname(filename)] || "application/octet-stream",
    );
    response.setHeader("Accept-Ranges", "bytes");
    let start = 0,
      end = info.size - 1;
    if (request.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
      if (!range) {
        response
          .writeHead(416, { "Content-Range": `bytes */${info.size}` })
          .end();
        return;
      }
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end || start >= info.size) {
        response
          .writeHead(416, { "Content-Range": `bytes */${info.size}` })
          .end();
        return;
      }
      response.statusCode = 206;
      response.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    }
    response.setHeader("Content-Length", end - start + 1);
    if (request.method === "HEAD") response.end();
    else
      createReadStream(filename, { start, end })
        .on("error", () => response.destroy())
        .pipe(response);
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    let allowed = false;
    try {
      const origin = new URL(request.headers.origin || "");
      const host = request.headers["x-forwarded-host"] || request.headers.host;
      allowed = origins.size
        ? origins.has(origin.origin)
        : origin.host === host;
    } catch {}
    if (
      request.url !== "/ws" ||
      !allowed ||
      connections.size >= maxPlayers + 16
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  });

  const send = (ws, message) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.terminate();
      return;
    }
    if (message.type === "state" && ws.bufferedAmount > 32768) return;
    ws.send(JSON.stringify(message));
  };
  const sendState = (room, player, message) => {
    const body = room.world?.players.get(player.id);
    send(
      player.socket,
      body && player.protocol === INPUT_PROTOCOL
        ? {
            ...message,
            prediction: {
              protocol: INPUT_PROTOCOL,
              ack: player.appliedSeq,
              player: body,
              movers: room.world.movers,
            },
          }
        : message,
    );
  };
  const notify = (room, message) => {
    for (const player of room.players.values())
      if (player.connected) {
        if (message.type === "state") sendState(room, player, message);
        else send(player.socket, message);
      }
  };
  const roomView = (room) => ({
    type: "room",
    code: room.code,
    phase: room.world ? room.world.phase : "lobby",
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
      ready: p.ready,
      connected: p.connected,
    })),
    maxPlayers: room.maxPlayers,
    visibility: room.visibility,
    title: room.title,
    stage: room.stage,
    mode: room.mode,
    reconnectSeconds: Math.ceil(reconnectMs / 1000),
  });
  const broadcastRoom = (room) => notify(room, roomView(room));
  const chooseHost = (room) => {
    if (!room.players.get(room.hostId)?.connected)
      room.hostId =
        [...room.players.values()].find((p) => p.connected)?.id ||
        room.players.keys().next().value;
  };
  const fail = (ws, message, fatal = false) => {
    send(ws, { type: "error", message });
    if (fatal) ws.close(1008, "Join rejected");
  };
  const connectedCount = () =>
    [...rooms.values()].reduce(
      (count, room) =>
        count + [...room.players.values()].filter((p) => p.connected).length,
      0,
    );

  wss.on("connection", (ws) => {
    connections.add(ws);
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    let room = null,
      player = null;
    let messages = 0,
      windowAt = Date.now();
    const helloTimeout = setTimeout(() => {
      if (!player) ws.close(1008, "Join timeout");
    }, 10000);
    helloTimeout.unref();
    ws.on("message", (raw) => {
      if (Date.now() - windowAt >= 1000) {
        messages = 0;
        windowAt = Date.now();
      }
      if (++messages > 90) {
        fail(ws, "操作过于频繁，请重新连接。", true);
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        fail(ws, "消息格式不正确。", true);
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        fail(ws, "消息格式不正确。", true);
        return;
      }
      if (!player) {
        if (message.type !== "hello") {
          fail(ws, "请先加入房间。", true);
          return;
        }
        const code = String(message.code || "").toUpperCase();
        const resume = validCode(code) ? rooms.get(code) : null;
        const previous =
          resume &&
          [...resume.players.values()].find((p) =>
            safeEqual(p.token, message.token),
          );
        if (previous) {
          room = resume;
          player = previous;
          const old = player.socket;
          player.socket = ws;
          player.connected = true;
          player.leftAt = 0;
          player.input = neutral();
          player.inputAt = Date.now();
          player.lastSeq = -1;
          player.appliedSeq = -1;
          player.inputQueue = [];
          player.protocol =
            message.protocol === INPUT_PROTOCOL ? INPUT_PROTOCOL : 1;
          if (old && old !== ws) old.close(1000, "Reconnected elsewhere");
          if (room.world?.players.has(player.id))
            room.world.players.get(player.id).connected = true;
          chooseHost(room);
        } else {
          if (message.token) {
            fail(ws, "重连席位已过期，请重新加入房间。", true);
            return;
          }
          if (connectedCount() >= maxPlayers) {
            fail(ws, "当前联机人数已满，请稍后再试。", true);
            return;
          }
          const quick =
            message.mode === "quick"
              ? [...rooms.values()].find(
                  (r) =>
                    r.visibility === "public" &&
                    !r.world &&
                    r.players.size < r.maxPlayers &&
                    [...r.players.values()].some((p) => p.connected),
                )
              : null;
          if (
            message.mode === "create" ||
            (message.mode === "quick" && !quick)
          ) {
            if (rooms.size >= maxRooms) {
              fail(ws, "当前房间已满，请稍后再试。", true);
              return;
            }
            let freshCode;
            do {
              freshCode = makeCode();
            } while (rooms.has(freshCode));
            room = {
              code: freshCode,
              visibility: message.solo
                ? "private"
                : message.visibility === "private"
                  ? "private"
                  : "public",
              mode: message.solo ? "solo" : "coop",
              maxPlayers: message.solo ? 1 : 4,
              title: cleanName(
                message.title || `${cleanName(message.name)}的房间`,
              ),
              stage: stages.includes(message.stage) ? message.stage : "1-1",
              players: new Map(),
              hostId: null,
              world: null,
              round: 0,
              seed: randomBytes(4).readUInt32LE(),
              updatedAt: Date.now(),
              pausedAt: 0,
            };
            rooms.set(room.code, room);
          } else {
            if (!resume && !quick) {
              fail(ws, "没有找到这个房间，请检查房间码。", true);
              return;
            }
            room = quick || resume;
            if (room.world) {
              fail(ws, "这个房间正在闯关，请等待本局结束。", true);
              return;
            }
            if (room.players.size >= room.maxPlayers) {
              fail(
                ws,
                `房间已有${room.maxPlayers}名玩家，请换一个房间。`,
                true,
              );
              return;
            }
          }
          const slots = new Set([...room.players.values()].map((p) => p.slot));
          let slot = 0;
          while (slots.has(slot)) slot++;
          player = {
            id: randomBytes(4).toString("hex"),
            token: randomBytes(24).toString("hex"),
            socket: ws,
            connected: true,
            name: cleanName(message.name),
            slot,
            ready: false,
            leftAt: 0,
            input: neutral(),
            inputAt: Date.now(),
            lastSeq: -1,
            appliedSeq: -1,
            inputQueue: [],
            protocol: message.protocol === INPUT_PROTOCOL ? INPUT_PROTOCOL : 1,
          };
          room.players.set(player.id, player);
          if (!room.hostId) room.hostId = player.id;
        }
        clearTimeout(helloTimeout);
        room.updatedAt = Date.now();
        send(ws, {
          type: "welcome",
          id: player.id,
          token: player.token,
          code: room.code,
          resumed: !!previous,
          protocol: player.protocol,
        });
        if (room.world) {
          send(ws, {
            type: "start",
            level: publicLevel(room.world.level),
            round: room.round,
            revision: room.world.revision,
          });
          sendState(room, player, snapshot(room.world));
        }
        broadcastRoom(room);
        return;
      }
      room.updatedAt = Date.now();
      if (
        message.type === "input-frames" &&
        player.protocol === INPUT_PROTOCOL
      ) {
        if (acceptInputFrames(player, message.frames))
          player.inputAt = Date.now();
      } else if (
        message.type === "input" &&
        player.protocol !== INPUT_PROTOCOL
      ) {
        if (!Number.isSafeInteger(message.seq) || message.seq <= player.lastSeq)
          return;
        if (
          ![-1, 0, 1].includes(message.axis) ||
          !["jump", "fire", "run"].every(
            (key) => typeof message[key] === "boolean",
          )
        )
          return;
        player.lastSeq = message.seq;
        player.inputAt = Date.now();
        player.input = {
          axis: message.axis,
          jump: message.jump,
          fire: message.fire,
          run: message.run,
          down: message.down === true,
        };
      } else if (message.type === "ready" && !room.world) {
        player.ready = message.ready === true;
        broadcastRoom(room);
      } else if (
        message.type === "start" &&
        room.hostId === player.id &&
        !room.world
      ) {
        const members = [...room.players.values()].filter((p) => p.connected);
        if (members.length < (room.mode === "solo" ? 1 : 2)) {
          fail(ws, "需要至少2名玩家才能合作开局。");
          return;
        }
        if (members.some((p) => !p.ready)) {
          fail(ws, "请等待所有在线玩家准备。");
          return;
        }
        room.world = createWorld(room.seed + room.round++, {
          stage: room.stage,
        });
        for (const p of members) {
          p.input = neutral();
          p.inputQueue = [];
          p.appliedSeq = p.lastSeq;
          addPlayer(room.world, p.id, p.slot);
        }
        notify(room, {
          type: "start",
          level: publicLevel(room.world.level),
          round: room.round,
          revision: room.world.revision,
        });
        broadcastRoom(room);
        notify(room, snapshot(room.world));
      } else if (
        message.type === "again" &&
        room.hostId === player.id &&
        room.world &&
        ["won", "lost"].includes(room.world.phase)
      ) {
        room.world = null;
        for (const p of room.players.values()) p.ready = false;
        broadcastRoom(room);
      } else if (message.type === "leave") {
        room.players.delete(player.id);
        room.world?.players.delete(player.id);
        chooseHost(room);
        broadcastRoom(room);
        ws.close(1000, "Left room");
      } else if (message.type === "ping")
        send(ws, { type: "pong", at: message.at });
    });
    ws.on("close", () => {
      clearTimeout(helloTimeout);
      connections.delete(ws);
      if (!player || player.socket !== ws || !room.players.has(player.id))
        return;
      player.connected = false;
      player.leftAt = Date.now();
      player.input = neutral();
      player.inputQueue = [];
      if (room.world?.players.has(player.id))
        room.world.players.get(player.id).connected = false;
      chooseHost(room);
      broadcastRoom(room);
    });
    ws.on("error", () => {});
  });

  let last = performance.now(),
    accumulator = 0,
    broadcastTick = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    accumulator = Math.min(accumulator + (now - last) / 1000, 0.1);
    last = now;
    while (accumulator >= 1 / 60) {
      accumulator -= 1 / 60;
      for (const room of rooms.values()) {
        if (!room.world || ![...room.players.values()].some((p) => p.connected))
          continue;
        const inputs = new Map(
          [...room.players.values()].map((p) => [
            p.id,
            p.protocol === INPUT_PROTOCOL
              ? consumeInputFrame(p, Date.now())
              : Date.now() - p.inputAt < 400
                ? p.input
                : neutral(),
          ]),
        );
        for (const player of room.players.values()) {
          const body = room.world.players.get(player.id);
          if (body)
            body.commandSeq =
              player.protocol === INPUT_PROTOCOL
                ? player.appliedSeq
                : player.lastSeq;
        }
        const revision = room.world.revision;
        stepWorld(room.world, inputs);
        if (room.world.revision !== revision) {
          for (const p of room.players.values()) {
            p.input = neutral();
            p.inputQueue = [];
            p.appliedSeq = p.lastSeq;
          }
          notify(room, {
            type: "start",
            level: publicLevel(room.world.level),
            round: room.round,
            revision: room.world.revision,
          });
        }
      }
      if (++broadcastTick % 3 === 0) {
        for (const room of rooms.values())
          if (room.world) notify(room, snapshot(room.world));
      }
    }
  }, 1000 / 60);
  tick.unref();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      let changed = false;
      for (const [id, p] of room.players)
        if (!p.connected && now - p.leftAt > reconnectMs) {
          room.players.delete(id);
          room.world?.players.delete(id);
          changed = true;
        }
      if (changed) {
        chooseHost(room);
        broadcastRoom(room);
      }
      if (!room.players.size || now - room.updatedAt > 30 * 60 * 1000) {
        for (const p of room.players.values())
          p.socket.close(1000, "Room expired");
        rooms.delete(code);
      }
    }
  }, 1000);
  cleanup.unref();
  const heartbeat = setInterval(() => {
    for (const ws of connections) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 15000);
  heartbeat.unref();
  return {
    server,
    rooms,
    async listen(
      port = Number(process.env.PORT || 2678),
      host = process.env.HOST || "127.0.0.1",
    ) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      clearInterval(tick);
      clearInterval(cleanup);
      clearInterval(heartbeat);
      for (const ws of connections) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createGameServer();
  const address = await app.listen();
  console.log(
    `Mario co-op listening on http://${address.address}:${address.port}`,
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
