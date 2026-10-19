/**
 * Broadcast a local WorkBuddy account as an OpenAI-compatible HTTP service on
 * the WSL vEthernet interface, so agent tools running inside WSL can reach it.
 *
 * This plugin is deliberately separate from `dsh-workbuddy-connect`: that
 * bundle's loopback shim treats "only 127.0.0.1 can connect" as its security
 * boundary (`hostIsLoopback`/`originIsLoopback`), so it can never be exposed
 * on another interface. Here we build our own listener and reuse only the
 * transport-independent pieces from `dsh-workbuddy-connect`: the credential
 * store, the upstream client, the wire-quirk body preparation, and the
 * catalog.
 *
 * The binding target is the Hyper-V "vEthernet (WSL ...)" adapter address,
 * resolved at startup and re-resolved on listen failure. That address is not
 * stable (Windows may rebuild the virtual network), so the plugin never
 * caches it in a file; when resolution or binding fails the user restarts
 * the plugin.
 *
 * @module dsh-workbuddy-broadcast
 */

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";

import z from "@deepseek-ai/schemastery";

import { createAtRestKeyProvider } from "./at-rest-key.js";

/**
 * Name of the plugin this bundle borrows its transport-independent parts from.
 *
 * It is a *peer*, not a dependency: it is a Harness plugin the user installs
 * or does not, and this bundle works without it up to the point where it needs
 * a credential. Declaring it as a hard dependency would make `npm install`
 * refuse, or make the Harness reject activation, exactly when the user's own
 * profile already provides the only copy that can work.
 */
const CONNECT_PACKAGE = "dsh-workbuddy-connect";

/**
 * The parts of `dsh-workbuddy-connect` this bundle uses.
 *
 * Loaded at runtime rather than imported at the top of the module: a static
 * `import` is resolved when this module is linked, so a profile without the
 * peer would fail to activate this bundle instead of reporting that the peer
 * is missing. `import()` is resolved on demand and its failure is catchable.
 */
let connectModule;

/** Why the peer could not be loaded, remembered so repeats are cheap. */
let connectFailure;

/**
 * Directories to try resolving the peer from, best candidate first.
 *
 * Walking up from this module is the case that matters for a normal install:
 * a profile install puts this package inside `<profile>/node_modules`, so an
 * ancestor `node_modules` holding the peer is precisely the profile that
 * provides it. That path is verified to work.
 *
 * The environment is *not* part of this: `DSH_PROFILE`, `DSH_HOME` and
 * `DSH_PROFILE_DIR` reach shell calls but are all `undefined` inside a plugin
 * loaded by the Loader (measured).
 *
 * The conventional Harness home is appended as a last resort, for the
 * development case where this package is linked from somewhere outside a
 * profile and the walk above never crosses a profile's `node_modules`.
 *
 * @returns {string[]} absolute directories to resolve from
 */
function resolutionBases() {
  const bases = [];

  // 1. The working directory. A profile-launched Harness sets it to the
  //    profile directory itself, so `<cwd>/node_modules` is exactly where a
  //    user-installed plugin lives. This is the case that normally answers.
  try {
    bases.push(process.cwd());
  } catch {
    // A Host that hides cwd: skip straight to the walk.
  }

  // 2. Ancestors of this module, for an npm install where this package sits
  //    inside `<profile>/node_modules` (verified to resolve).
  let directory;
  try {
    directory = fileURLToPath(new URL(".", import.meta.url));
  } catch {
    directory = undefined;
  }
  for (let depth = 0; directory !== undefined && depth < 6; depth += 1) {
    bases.push(directory);
    const parent = join(directory, "..");
    if (parent === directory) break;
    directory = parent;
  }

  // 3. The conventional Harness home.
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (typeof home === "string" && home !== "") {
    const profiles = join(home, ".dsh", "profiles");
    const named = process.env.DSH_PROFILE;
    if (typeof named === "string" && named !== "") bases.push(join(profiles, named));
    bases.push(join(profiles, "desktop"));
    bases.push(profiles);
  }

  return [...new Set(bases)];
}

/**
 * Load `dsh-workbuddy-connect` on first use.
 *
 * Resolution and loading are separate steps on purpose. The peer is an ES
 * module with an `exports` map, so it needs a resolver that understands both;
 * `createRequire` anchored at a candidate directory is that resolver, while
 * the actual load still goes through `import()` so an ESM-only entry works
 * regardless of whether this Node build supports `require(esm)`.
 *
 * @returns {Promise<object>} the peer's module namespace
 * @throws {Error} when the peer is absent, with a message fit for the UI
 */
export async function loadConnect() {
  if (connectModule !== undefined) return connectModule;
  if (connectFailure !== undefined) throw connectFailure;

  const attempts = [];

  // 1. Walk up from this module. Covers both a profile install (this package
  //    under `<profile>/node_modules`) and a flat layout where the peer sits
  //    beside it. `createRequire` needs a file path, not a directory.
  for (const base of resolutionBases()) {
    try {
      const resolveFrom = createRequire(join(base, "noop.js"));
      const resolved = resolveFrom.resolve(CONNECT_PACKAGE);
      connectModule = await import(pathToFileURL(resolved).href);
      return connectModule;
    } catch (error) {
      attempts.push(`${base}: ${error instanceof Error ? error.code ?? error.message : String(error)}`);
    }
  }

  // 2. A plain dynamic import, for any loader that patches the resolution of
  //    this very module (the Harness serves some packages from its own store).
  try {
    connectModule = await import(CONNECT_PACKAGE);
    return connectModule;
  } catch (error) {
    attempts.push(`import: ${error instanceof Error ? error.code ?? error.message : String(error)}`);
  }

  connectFailure = new Error(
    `缺少依赖插件 ${CONNECT_PACKAGE}：本插件复用它读取 WorkBuddy 凭据、调用上游并规整请求体。` +
      `请先在同一个 DSH profile 中安装 ${CONNECT_PACKAGE}（版本需与 DSH 内核匹配）再启用本插件。` +
      `解析失败详情：${attempts.join("；")}`,
  );
  throw connectFailure;
}

/** Route prefix this plugin owns on the Harness Web server. */
const ROUTE_PREFIX = "/plugins/dsh-workbuddy-broadcast";

/** Loader entry id this bundle's patch row uses, and its settings namespace. */
const SETTINGS_PATCH_ID = "llm-workbuddy-broadcast";

/** Default listening port. Chosen away from common service ports. */
const DEFAULT_PORT = 18731;

/** Request body cap, matching the loopback shim. */
const REQUEST_BODY_LIMIT = 67108864;

/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS = {
  hard_credit: 402,
  soft_rate: 429,
  session_dead: 401,
  not_found: 502,
  server: 502,
  client: 400,
};

/**
 * Candidate adapter aliases for the WSL virtual switch, most specific first.
 * Windows names the adapter `vEthernet (WSL)` on older builds and
 * `vEthernet (WSL (Hyper-V firewall))` on newer ones; both start with the
 * same prefix, so a prefix match covers either spelling.
 */
const WSL_ADAPTER_PREFIXES = ["vethernet (wsl", "vethernet(wsl"];

/**
 * Resolve the IPv4 address of the WSL vEthernet adapter.
 *
 * Read live from the OS on every call rather than cached: the address is
 * managed by Windows' virtual networking stack and changes when that network
 * is rebuilt. Returns every match so a caller can report what it found.
 *
 * The adapter is a Windows/Hyper-V construct. On macOS and Linux this always
 * returns an empty array, which the caller treats as "no WSL surface" and
 * serves loopback instead — the same shape as a Windows host without WSL.
 *
 * @returns {{ address: string, iface: string }[]} matches, empty when absent
 */
function resolveVethAddresses() {
  if (process.platform !== "win32") return [];
  const found = [];
  for (const [iface, addresses] of Object.entries(networkInterfaces())) {
    const name = iface.toLowerCase();
    if (!WSL_ADAPTER_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    for (const info of addresses ?? []) {
      // `family` is the string 'IPv4' on modern Node, the number 4 on old ones.
      const isV4 = info.family === "IPv4" || info.family === 4;
      // Skip APIPA: an address in 169.254.0.0/16 means DHCP never answered,
      // which is not an address anything can dial.
      if (!isV4 || info.address.startsWith("169.254.")) continue;
      found.push({ address: info.address, iface });
    }
  }
  return found;
}

/** Write one JSON response with an explicit length. */
function writeJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

/** Write an OpenAI-shaped error body. */
function writeOpenAIError(res, status, kind, message) {
  writeJson(res, status, { error: { message, type: kind, code: kind } });
}

/** Read a request body with a size cap. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > REQUEST_BODY_LIMIT) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Chat POSTs must carry a JSON body type. */
function isJsonContentType(req) {
  const type = req.headers["content-type"];
  return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}

/**
 * Constant-time bearer check against the configured API key.
 *
 * Length is compared first (which leaks only length, not content) because
 * `timingSafeEqual` throws on mismatched buffer lengths.
 */
function bearerOk(req, expected) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Generate a key used when the user has not chosen one. */
function generateApiKey() {
  return `sk-wb-${randomBytes(24).toString("base64url")}`;
}

/** Whether a value looks like a usable API key. */
function isUsableKey(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Pull a human-readable message out of an upstream error body.
 *
 * `dsh-workbuddy-connect` has an `extractDisplayErrorMessage` helper for this,
 * but it is not part of that package's public export surface, and this plugin
 * deliberately depends only on exported symbols. The upstream wraps its
 * message in a few known envelopes, so we unwrap those and fall back to the
 * raw text.
 */
function extractDisplayErrorMessage(body) {
  if (typeof body !== "string" || body === "") return undefined;
  try {
    const parsed = JSON.parse(body);
    const candidate =
      parsed?.error?.message ?? parsed?.message ?? parsed?.msg ?? parsed?.error_msg ?? undefined;
    if (typeof candidate === "string" && candidate !== "") return candidate;
  } catch {
    // Not JSON: the upstream sometimes answers with plain text.
  }
  return undefined;
}

/**
 * Start the broadcast listener.
 *
 * @param {object} options
 * @param {object} options.store     WorkBuddyCredentialStore
 * @param {object} options.client    WorkBuddyUpstreamClient
 * @param {object} options.catalog   WorkBuddyCatalog
 * @param {(source: string) => string} options.prepareBody
 *   The peer's wire-normalisation function (forced streaming, `developer`
 *   role rewritten, `tool_choice` flattened). Passed in rather than imported
 *   because the peer is loaded at runtime.
 * @param {string} options.apiKey    bearer clients must present
 * @param {number} options.port      TCP port to bind
 * @param {boolean} [options.allowLocal]
 *   Also listen on 127.0.0.1 so Windows-side tools can use `localhost`. Off
 *   by default: the loopback listener is for this machine only, but it is a
 *   second surface to reason about, so it is opt-in.
 * @param {object} [options.logger]  Cordis logger
 * @returns {{ready: Promise<{address: string, port: number, local: boolean}>, close: () => Promise<void>, describe: () => object}}
 */
export function createBroadcastServer(options) {
  const { store, client, catalog, prepareBody, apiKey, port, logger, allowLocal = false } = options;
  let bound = null;
  let closing = false;

  /** Every listening server; the vEthernet one first, the loopback one second. */
  const servers = [];

  const onRequest = (req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) writeOpenAIError(res, 500, "internal", String(error));
      else res.end();
    });
  };

  async function handle(req, res) {
    if (!bearerOk(req, apiKey)) {
      writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
      return;
    }
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
      writeJson(res, 200, { ok: true, service: "dsh-workbuddy-broadcast", bound });
      return;
    }
    if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
      writeJson(res, 200, {
        object: "list",
        data: catalog.current().map((model) => ({
          id: model.id,
          object: "model",
          created: 0,
          owned_by: "workbuddy",
        })),
      });
      return;
    }
    if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
      await chatCompletions(req, res);
      return;
    }
    writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
  }

  async function chatCompletions(req, res) {
    if (!isJsonContentType(req)) {
      writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
      return;
    }
    let credential;
    try {
      credential = await store.resolve();
    } catch (error) {
      writeOpenAIError(res, 401, "not_signed_in", String(error));
      return;
    }
    const raw = (await readBody(req)).toString("utf8");
    const prepared = prepareBody(raw);
    const controller = new AbortController();
    req.on("close", () => controller.abort());
    const result = await client.chatStream(credential, prepared, controller.signal);
    if (!result.ok) {
      const detail = extractDisplayErrorMessage(result.message) ?? result.message.slice(0, 400);
      const statusNote =
        (result.status === 401 || result.status === 403) && result.kind !== "session_dead"
          ? ""
          : ` (http ${result.status})`;
      writeOpenAIError(
        res,
        KIND_STATUS[result.kind] ?? 502,
        result.kind,
        `workbuddy upstream ${result.kind}${statusNote}: ${detail}`,
      );
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let sawDone = false;
    const body = Readable.fromWeb(result.response.body);
    body.on("data", (chunk) => {
      if (chunk.includes("[DONE]")) sawDone = true;
    });
    body.on("error", (error) => {
      logger?.warn("dsh-workbuddy-broadcast: upstream stream failed mid-flight", error);
      if (!sawDone && res.writable) res.end("data: [DONE]\n\n");
    });
    body.pipe(res);
  }

  /** Bind one address and resolve when it is listening. */
  function listenOn(address) {
    return new Promise((resolve, reject) => {
      const server = createServer(onRequest);
      const fail = (error) => reject(error);
      server.once("error", fail);
      server.listen(port, address, () => {
        server.removeListener("error", fail);
        servers.push(server);
        resolve();
      });
    });
  }

  const ready = (async () => {
    // Two listeners with independent lifetimes.
    //
    // The vEthernet listener exists to serve WSL, and it is *optional*: a host
    // without WSL installed has no such adapter, and refusing to start would
    // make the plugin useless for the Windows-only case it also serves. When
    // the adapter is absent the plugin degrades to loopback-only and reports
    // why, instead of failing activation.
    //
    // The loopback listener is what `allowLocal` controls, except that a
    // missing vEthernet adapter forces it on: it is the only surface left, and
    // a plugin that starts while listening on nothing is worse than one that
    // reports a clear error.
    const candidates = resolveVethAddresses();
    let wsl = null;
    let wslError;

    if (candidates.length > 0) {
      const target = candidates[0];
      try {
        await listenOn(target.address);
        wsl = { address: target.address, port, iface: target.iface };
      } catch (error) {
        // A bind failure is not the same as an absent adapter: it means
        // something else holds this port on that interface. Keep going so the
        // loopback surface can still serve, and say what happened.
        wslError = String(error?.message ?? error);
        logger?.warn(`dsh-workbuddy-broadcast: could not bind the WSL interface (${wslError})`);
      }
    } else {
      // The WSL virtual adapter is a Windows/Hyper-V construct. On another
      // platform its absence is expected, not a fault, and the message says
      // which case this is so the settings page can stay calm about it.
      wslError =
        process.platform === "win32"
          ? "no WSL vEthernet adapter found; WSL is probably not installed or has never been started"
          : `the WSL vEthernet adapter only exists on Windows; this host is ${process.platform}`;
    }

    const wantLocal = allowLocal || wsl === null;
    let local = false;
    let localError;
    if (wantLocal) {
      try {
        await listenOn("127.0.0.1");
        local = true;
      } catch (error) {
        localError = String(error?.message ?? error);
        logger?.warn(`dsh-workbuddy-broadcast: loopback listener skipped (${localError})`);
      }
    }

    if (wsl === null && !local) {
      throw new Error(
        `nothing could be listened on: WSL interface unavailable (${wslError}) and loopback failed (${localError}).`,
      );
    }

    bound = wsl;
    return { wsl, local, wslError, localError };
  })();

  return {
    ready,
    close: () =>
      new Promise((resolve) => {
        if (closing) return resolve();
        closing = true;
        if (servers.length === 0) return resolve();
        let remaining = servers.length;
        for (const server of servers) {
          server.close(() => {
            remaining -= 1;
            if (remaining === 0) resolve();
          });
          server.closeAllConnections?.();
        }
      }),
    describe: () => ({ bound, candidates: resolveVethAddresses() }),
  };
}

/** Plugin name, matching the package. */
export const name = "dsh-workbuddy-broadcast";

/**
 * Optional services.
 *
 * `configEditor` persists a plugin's config through the normal Loader path,
 * which is how the settings section saves its two fields. `webServer` carries
 * the plugin's loopback routes.
 */
export const inject = ["webServer", "configEditor"];

/**
 * Config schema for the two knobs.
 *
 * Exported as `Config` so the Harness can project it into the bundle's
 * configuration form and persist edits through the normal patch path. Both
 * fields are optional: an omitted port uses {@link DEFAULT_PORT}, and an
 * omitted key is generated per activation.
 *
 * Only `z.string()` / `z.natural()` primitives are used, matching how
 * `dsh-workbuddy-connect` declares its own fields, so a schemastery minor
 * bump cannot change what this means.
 */
export const Config = z.object({
  port: z
    .natural()
    .description(
      `TCP port the broadcast endpoint listens on, bound to the WSL vEthernet address (default ${DEFAULT_PORT}).`,
    )
    .default(DEFAULT_PORT),
  apiKey: z
    .string()
    .description(
      "Bearer token WSL clients must present. Leave empty to generate one per activation.",
    )
    .default(""),
  allowLocal: z
    .boolean()
    .description(
      "Also listen on 127.0.0.1, so tools on Windows itself can use http://localhost:<port>/v1.",
    )
    .default(true),
});

/** Normalize one config value into a usable TCP port. */
function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return DEFAULT_PORT;
  return port;
}

/**
 * Resolve the API key: the configured value wins, otherwise generate one.
 *
 * A generated key is never written anywhere — the settings page shows it so
 * the user can copy it, and pinning it means editing `apiKey` in the bundle's
 * configuration form (which persists through the normal profile patch).
 *
 * @returns {{ key: string, source: 'config' | 'generated' }}
 */
function resolveApiKey(config) {
  if (isUsableKey(config.apiKey)) return { key: config.apiKey.trim(), source: "config" };
  return { key: generateApiKey(), source: "generated" };
}

/**
 * Mount the broadcast service and its settings routes.
 *
 * The plugin deliberately exports no `Config` schema: doing so would add a
 * runtime dependency on the Harness-provided `@deepseek-ai/schemastery`
 * peer, and the two knobs here need no more validation than `normalizePort`
 * and a non-empty-string check.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ port?: number, apiKey?: string }} config
 */
export function apply(ctx, config = {}) {
  const port = normalizePort(config.port);
  const { key: apiKey, source: keySource } = resolveApiKey(config);
  // Default true: a Windows-side tool is the common case once the endpoint
  // exists, and the loopback listener is still bearer-protected.
  const allowLocal = config.allowLocal !== false;

  let broadcast = null;
  /** Last state reported to the settings page. */
  let state = { status: "starting" };
  /** Peer module namespace once loaded; `undefined` until then. */
  let peer;
  /** Catalog once the peer is loaded; `undefined` while unavailable. */
  let catalog;

  const start = async () => {
    // The peer is loaded before anything else: every part of the broadcast
    // path needs it, and its absence is a configuration fact worth reporting
    // as a state rather than throwing out of `apply`.
    try {
      peer = await loadConnect();
    } catch (error) {
      state = {
        status: "missing-peer",
        message: error instanceof Error ? error.message : String(error),
        peer: CONNECT_PACKAGE,
      };
      ctx.logger?.error(
        `dsh-workbuddy-broadcast: ${CONNECT_PACKAGE} is not available; the endpoint stays off`,
        error,
      );
      return;
    }

    try {
      const { CN_VARIANT, FALLBACK_WORKBUDDY_MODELS, WorkBuddyCatalog, WorkBuddyCredentialStore, WorkBuddyUpstreamClient } =
        peer;
      const client = new WorkBuddyUpstreamClient();
      const store = new WorkBuddyCredentialStore({
        variant: CN_VARIANT,
        refresh: (credential) => client.refreshToken(credential),
        // The store's default key provider is built without electron
        // discovery, which leaves it unable to find WorkBuddy at all; this
        // one looks the binary up itself. See `at-rest-key.js`.
        keyProvider: createAtRestKeyProvider(),
      });
      // Assigned to the outer binding so the settings route can read it.
      catalog = new WorkBuddyCatalog(FALLBACK_WORKBUDDY_MODELS);

      const credential = await store.current();
      if (credential === undefined) {
        state = { status: "no-credential", message: "WorkBuddy is not signed in" };
        ctx.logger?.warn("dsh-workbuddy-broadcast: no WorkBuddy credential; not listening");
        return;
      }

      // Read the account's real model roster. The baked-in fallback is a
      // snapshot of whatever upstream offered when this version shipped, and
      // it drifts: ids appear (`glm-5.3-flashx`) and disappear (`hy3`) between
      // releases. Serving it as if it were live would advertise models the
      // account may not have. A failed fetch keeps the fallback, which is the
      // same degradation `dsh-workbuddy-connect` uses.
      let catalogSource = "fallback";
      try {
        const models = await client.fetchModels(credential);
        if (Array.isArray(models) && models.length > 0) {
          catalog.set(models);
          catalogSource = "live";
        }
      } catch (error) {
        ctx.logger?.warn(
          `dsh-workbuddy-broadcast: model roster fetch failed, serving the fallback list (${String(
            error?.message ?? error,
          )})`,
        );
      }

      broadcast = createBroadcastServer({
        store,
        client,
        catalog,
        prepareBody: peer.prepareChatBody,
        apiKey,
        port,
        allowLocal,
        logger: ctx.logger,
      });
      const bound = await broadcast.ready;
      state = {
        status: "listening",
        port,
        allowLocal,
        catalogSource,
        // The WSL surface is absent on a host without WSL; that is a normal
        // state, not a failure, so it is reported rather than thrown.
        wsl: bound.wsl,
        local: bound.local,
        ...(bound.wslError === undefined ? {} : { wslError: bound.wslError }),
        ...(bound.localError === undefined ? {} : { localError: bound.localError }),
      };
      if (bound.wsl !== null) {
        ctx.logger?.info(
          `dsh-workbuddy-broadcast: listening on http://${bound.wsl.address}:${bound.wsl.port}/v1 (WSL)`,
        );
      } else {
        ctx.logger?.warn(
          `dsh-workbuddy-broadcast: WSL surface unavailable (${bound.wslError}); serving loopback only`,
        );
      }
      if (bound.local) {
        ctx.logger?.info(
          `dsh-workbuddy-broadcast: listening on http://127.0.0.1:${bound.port}/v1 (local)`,
        );
      }
    } catch (error) {
      state = { status: "error", message: String(error?.message ?? error) };
      ctx.logger?.error("dsh-workbuddy-broadcast: failed to listen", error);
    }
  };

  ctx.effect(() => {
    void start();
    return () => {
      void broadcast?.close();
      broadcast = null;
    };
  }, "dsh-workbuddy-broadcast: listener");

  // Settings page routes, served by the Harness Web server on loopback only.
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: "prefix",
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const sub = url.pathname.slice(ROUTE_PREFIX.length) || "/";
        try {
          if (req.method === "GET" && sub === "/status") {
            const models = catalog?.current() ?? [];
            writeJson(res, 200, {
              ...state,
              veth: resolveVethAddresses(),
              models: models.length,
              // What each model declares about reasoning effort, so the page
              // can say which levels are real rather than listing a guess.
              // Everything the settings page's prompt template needs to
              // describe a model truthfully. All of it comes from the live
              // catalog row, so the prompt never claims a capability the
              // upstream did not declare.
              modelEfforts: models.map((model) => ({
                id: model.id,
                name: typeof model.name === "string" ? model.name : model.id,
                efforts: Array.isArray(model.reasoning?.supportedEfforts)
                  ? model.reasoning.supportedEfforts
                  : [],
                // The default matters even when no effort set is declared: it
                // tells the reader which level the upstream picks on its own.
                defaultEffort:
                  typeof model.reasoning?.defaultEffort === "string"
                    ? model.reasoning.defaultEffort
                    : undefined,
                canDisableThinking: model.reasoning?.canDisableThinking === true,
                contextWindow:
                  typeof model.contextWindow === "number" ? model.contextWindow : undefined,
                maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : undefined,
                supportsImages: model.supportsImages === true,
                supportsReasoning: model.reasoning?.supports === true,
              })),
              // The settings page shows the key so it can be copied into a WSL
              // tool's config. This route is loopback-only, behind the same
              // same-origin gate as every other plugin status page.
              apiKey,
              apiKeySource: keySource,
            });
            return;
          }
          if (req.method === "POST" && sub === "/config") {
            await saveConfig(req, res);
            return;
          }
          writeJson(res, 404, { error: "not_found" });
        } catch (error) {
          writeJson(res, 500, { error: String(error?.message ?? error) });
        }
      },
    });
    return () => dispose();
  }, "dsh-workbuddy-broadcast: settings routes");

  /**
   * Persist one config edit through the Harness settings service.
   *
   * The write lands in the profile patch, exactly where the Plugins page's
   * own form writes, so the two entry points cannot drift apart. The running
   * listener keeps its current values until the plugin is reloaded, which the
   * page states in its own copy.
   */
  async function saveConfig(req, res) {
    let patch;
    try {
      patch = JSON.parse((await readBody(req)).toString("utf8"));
    } catch {
      writeJson(res, 400, { error: "body must be JSON" });
      return;
    }
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      writeJson(res, 400, { error: "body must be a JSON object" });
      return;
    }
    const next = {};
    if (patch.port !== undefined) {
      const port = Number(patch.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        writeJson(res, 400, { error: "port must be an integer from 1 to 65535" });
        return;
      }
      next.port = port;
    }
    if (patch.apiKey !== undefined) {
      if (typeof patch.apiKey !== "string" || patch.apiKey.trim() === "") {
        writeJson(res, 400, { error: "apiKey must be a non-empty string" });
        return;
      }
      next.apiKey = patch.apiKey.trim();
    }
    if (Object.keys(next).length === 0) {
      writeJson(res, 400, { error: "nothing to update" });
      return;
    }
    const entry = resolveEntry();
    if (entry === undefined) {
      writeJson(res, 500, { error: "could not locate this bundle's configuration entry" });
      return;
    }
    try {
      await ctx.configEditor.edit(entry, (current, inherited) => ({
        ...current,
        ...inherited,
        ...next,
      }));
    } catch (error) {
      writeJson(res, 500, { error: String(error?.message ?? error), applied: next });
      return;
    }
    writeJson(res, 200, { ok: true, entry: String(entry.id ?? ""), applied: next, restartRequired: true });
  }

  /**
   * Find this bundle's addressable Loader entry.
   *
   * `configEditor.entries()` reports active rows with their profile patch
   * ids; the patch id is stable regardless of how the bundle composed the
   * row, so match on it.
   */
  function resolveEntry() {
    try {
      const entries = ctx.configEditor.entries();
      return entries.find((candidate) => String(candidate.id).includes(SETTINGS_PATCH_ID));
    } catch {
      return undefined;
    }
  }
}
