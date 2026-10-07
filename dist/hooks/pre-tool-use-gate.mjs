#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@typesafe-ai/sdk/dist/index.mjs
var requestIdFrom, APIPromise, ENV, readEnv, fromCodeOrEnv, range, DEFAULT_RETRY_POLICY, isRetryableStatus, parseRetryAfter, retryDelayMs, sleep, TypeSafeError, isRecord, extractMessage, describeValidationErrors, MAX_RAW_BODY_IN_MESSAGE, APIError, BadRequestError, AuthenticationError, PermissionDeniedError, NotFoundError, UnprocessableEntityError, RateLimitError, InternalServerError, APIConnectionError, APITimeoutError, APIUserAbortError, LOG_LEVELS, DEFAULT_LOG_LEVEL, isLogLevel, parseLogLevel, PREFIX, consoleLogger, RANK, drop, withLevel, KEY_HEADERS, OPAQUE_HEADERS, redactKey, redact, redactHeaders, noul, validateQuestions, Models, unwrapModels, g, isBrowser, describeRuntime, VERSION, missingApiKey, missingFetch, refuseBrowser, defaultFetch, assertNonNegativeInteger, assertPositiveMs, assertNonNegativeMs, assertFraction, assertStatusSet, resolveRetryPolicy, isRetryableError, resolveLogLevel, stripTrailingSlashes, mergeHeaders, bufferResponse, RUNTIME, TypeSafeClient, parseBody;
var init_dist = __esm({
  "node_modules/@typesafe-ai/sdk/dist/index.mjs"() {
    requestIdFrom = (headers) => headers.get("x-typesafe-request-id") ?? void 0;
    APIPromise = class APIPromise2 extends Promise {
      #responsePromise;
      #parseResponse;
      #parsed;
      constructor(responsePromise, parseResponse) {
        super((resolve2) => resolve2(void 0));
        this.#responsePromise = responsePromise;
        this.#parseResponse = parseResponse;
      }
      /**
      * Resolves to the raw `Response` without parsing the body. SDK requests buffer the full
      * body under the request timeout before handoff; reading it afterwards is caller-owned.
      * The caller owns the body; don't also `await` the parsed result on the same promise.
      */
      asResponse() {
        return this.#responsePromise;
      }
      /** Return the parsed result, HTTP response, and request ID. */
      async withResponse() {
        const [data, response] = await Promise.all([this.#parse(), this.#responsePromise]);
        return {
          data,
          response,
          requestId: requestIdFrom(response.headers)
        };
      }
      /** Transform the parsed result, sharing the HTTP response and a single body parse. */
      map(fn) {
        return new APIPromise2(this.#responsePromise, () => this.#parse().then(fn));
      }
      #parse() {
        this.#parsed ??= this.#responsePromise.then(this.#parseResponse);
        return this.#parsed;
      }
      then(onfulfilled, onrejected) {
        return this.#parse().then(onfulfilled, onrejected);
      }
      catch(onrejected) {
        return this.#parse().catch(onrejected);
      }
      finally(onfinally) {
        return this.#parse().finally(onfinally);
      }
    };
    ENV = {
      /** Required API key; used when `apiKey` is omitted. */
      apiKey: "TYPESAFE_API_KEY",
      /** API root; defaults to `https://api.typesafe.ai`. */
      baseURL: "TYPESAFE_BASE_URL",
      /** Default model name; defaults to `jev-latest`. */
      defaultModel: "TYPESAFE_DEFAULT_MODEL",
      /** Log level; defaults to `warn`. */
      logLevel: "TYPESAFE_LOG_LEVEL"
    };
    readEnv = (name) => {
      if (typeof process === "undefined" || !process.env) return void 0;
      return process.env[name]?.trim() || void 0;
    };
    fromCodeOrEnv = (fromCode, envVar) => fromCode ?? readEnv(envVar);
    range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
    DEFAULT_RETRY_POLICY = {
      maxRetries: 2,
      backoffInitialMs: 500,
      backoffMaxMs: 5e3,
      backoffJitter: 0.25,
      /** HTTP 408, 429, and 5xx responses. */
      httpStatuses: /* @__PURE__ */ new Set([
        408,
        429,
        ...range(500, 600)
      ]),
      respectRetryAfter: true,
      /** Maximum server retry delay before falling back to backoff. */
      maxRetryAfterMs: 6e4,
      apiConnectionError: true,
      apiTimeoutError: true
    };
    DEFAULT_RETRY_POLICY.maxRetries;
    isRetryableStatus = (status, policy = DEFAULT_RETRY_POLICY) => policy.httpStatuses.has(status);
    parseRetryAfter = (headers, now = Date.now()) => {
      const ms = Number(headers.get("retry-after-ms"));
      if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
      const raw = headers.get("retry-after");
      if (raw === null) return void 0;
      const seconds = Number(raw);
      if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1e3 : void 0;
      const date = Date.parse(raw);
      if (!Number.isNaN(date)) return Math.max(0, date - now);
    };
    retryDelayMs = (attempt, headers, policy = DEFAULT_RETRY_POLICY, random = Math.random) => {
      if (policy.respectRetryAfter && headers !== void 0) {
        const retryAfter = parseRetryAfter(headers);
        if (retryAfter !== void 0 && retryAfter <= policy.maxRetryAfterMs) return retryAfter;
      }
      const exponential = Math.min(policy.backoffInitialMs * 2 ** attempt, policy.backoffMaxMs);
      return Math.round(exponential * (1 - random() * policy.backoffJitter));
    };
    sleep = (ms, signal) => new Promise((resolve2, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve2();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    TypeSafeError = class extends Error {
      constructor(message, options) {
        super(message, options);
        this.name = new.target.name;
      }
    };
    isRecord = (value) => typeof value === "object" && value !== null;
    extractMessage = (body) => {
      if (typeof body === "string") return body || void 0;
      if (!isRecord(body)) return void 0;
      const { error, message, detail } = body;
      if (typeof error === "string") return error;
      if (isRecord(error) && typeof error.message === "string") return error.message;
      if (typeof message === "string") return message;
      if (typeof detail === "string") return detail;
      if (isRecord(detail) && typeof detail.message === "string") return detail.message;
      if (Array.isArray(detail)) return describeValidationErrors(detail);
    };
    describeValidationErrors = (errors) => {
      const parts = errors.flatMap((e) => {
        if (!isRecord(e) || typeof e.msg !== "string") return [];
        const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== "body").join(".") : "";
        return [loc ? `${loc}: ${e.msg}` : e.msg];
      });
      return parts.length > 0 ? parts.join("; ") : void 0;
    };
    MAX_RAW_BODY_IN_MESSAGE = 200;
    APIError = class APIError2 extends TypeSafeError {
      /** HTTP response status code. */
      status;
      /** HTTP response headers. */
      headers;
      /** Parsed JSON, response text, or `undefined` for an empty body. */
      body;
      /** Request ID from `x-typesafe-request-id`, or `undefined` when absent. */
      requestId;
      constructor(status, body, headers, message) {
        super(message ?? APIError2.describe(status, body));
        this.status = status;
        this.body = body;
        this.headers = headers;
        this.requestId = requestIdFrom(headers);
      }
      static describe(status, body) {
        const detail = extractMessage(body);
        if (detail) return `${status} ${detail}`;
        if (body === void 0) return `${status} status code (no body)`;
        const raw = typeof body === "string" ? body : JSON.stringify(body);
        return `${status} ${raw.length > MAX_RAW_BODY_IN_MESSAGE ? `${raw.slice(0, MAX_RAW_BODY_IN_MESSAGE)}\u2026` : raw}`;
      }
      /** Create the error subclass for an HTTP status code. */
      static fromResponse(status, body, headers) {
        if (status === 400) return new BadRequestError(status, body, headers);
        if (status === 401) return new AuthenticationError(status, body, headers);
        if (status === 403) return new PermissionDeniedError(status, body, headers);
        if (status === 404) return new NotFoundError(status, body, headers);
        if (status === 422) return new UnprocessableEntityError(status, body, headers);
        if (status === 429) return new RateLimitError(status, body, headers);
        if (status >= 500) return new InternalServerError(status, body, headers);
        return new APIError2(status, body, headers);
      }
    };
    BadRequestError = class extends APIError {
    };
    AuthenticationError = class extends APIError {
    };
    PermissionDeniedError = class extends APIError {
    };
    NotFoundError = class extends APIError {
    };
    UnprocessableEntityError = class extends APIError {
    };
    RateLimitError = class extends APIError {
      /** Server retry delay in milliseconds, or `undefined` when absent or invalid. */
      retryAfterMs = parseRetryAfter(this.headers);
    };
    InternalServerError = class extends APIError {
    };
    APIConnectionError = class extends TypeSafeError {
      constructor(message = "Connection error.", options) {
        super(message, options);
      }
    };
    APITimeoutError = class extends APIConnectionError {
      /** Configured timeout in milliseconds. */
      timeoutMs;
      constructor(timeoutMs, options) {
        super(`Request timed out after ${timeoutMs}ms.`, options);
        this.timeoutMs = timeoutMs;
      }
    };
    APIUserAbortError = class extends TypeSafeError {
      constructor(message = "Request was aborted.", options) {
        super(message, options);
      }
    };
    LOG_LEVELS = [
      "debug",
      "info",
      "warn",
      "error",
      "off"
    ];
    DEFAULT_LOG_LEVEL = "warn";
    isLogLevel = (value) => LOG_LEVELS.includes(value);
    parseLogLevel = (value, source) => {
      if (isLogLevel(value)) return value;
      throw new TypeSafeError(`Invalid log level "${value}" from ${source}. Expected one of: ${LOG_LEVELS.join(", ")}.`);
    };
    PREFIX = "[typesafe-sdk]";
    consoleLogger = {
      debug: (message, ...args) => console.debug(`${PREFIX} ${message}`, ...args),
      info: (message, ...args) => console.info(`${PREFIX} ${message}`, ...args),
      warn: (message, ...args) => console.warn(`${PREFIX} ${message}`, ...args),
      error: (message, ...args) => console.error(`${PREFIX} ${message}`, ...args)
    };
    RANK = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      off: 4
    };
    drop = () => {
    };
    withLevel = (sink, level) => {
      const enabled = (at) => RANK[at] >= RANK[level];
      return {
        debug: enabled("debug") ? (message, ...args) => sink.debug(message, ...args) : drop,
        info: enabled("info") ? (message, ...args) => sink.info(message, ...args) : drop,
        warn: enabled("warn") ? (message, ...args) => sink.warn(message, ...args) : drop,
        error: enabled("error") ? (message, ...args) => sink.error(message, ...args) : drop
      };
    };
    KEY_HEADERS = /* @__PURE__ */ new Set([
      "authorization",
      "proxy-authorization",
      "x-api-key"
    ]);
    OPAQUE_HEADERS = /* @__PURE__ */ new Set(["cookie", "set-cookie"]);
    redactKey = (value) => {
      const [scheme, secret] = value.includes(" ") ? value.split(/\s+/, 2) : [void 0, value];
      const tail = secret && secret.length > 8 ? secret.slice(-4) : "";
      return `${scheme ? `${scheme} ` : ""}***${tail}`;
    };
    redact = (name, value) => {
      const lower = name.toLowerCase();
      if (KEY_HEADERS.has(lower)) return redactKey(value);
      if (OPAQUE_HEADERS.has(lower)) return "***";
      return value;
    };
    redactHeaders = (headers) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, redact(name, value)]));
    noul = (instructions = null, criteria) => ({
      type: "noul",
      instructions,
      criteria
    });
    validateQuestions = (questions) => {
      if (Object.keys(questions).length === 0) throw new TypeSafeError("At least one question is required.");
      for (const [name, question] of Object.entries(questions)) {
        if (question.type !== "score") continue;
        if (!Array.isArray(question.criteria)) throw new TypeSafeError(`Score question "${name}" has criteria that are not a list; score criteria must be a list of descriptions indexed by score from zero.`);
        if (question.criteria.length < 2) throw new TypeSafeError(`Score question "${name}" has ${question.criteria.length} criteria; at least two scores are required.`);
      }
    };
    Models = class {
      #transport;
      constructor(transport) {
        this.#transport = transport;
      }
      /** List the models available to the account. */
      list(options = {}) {
        return this.#transport.request("GET", "/v1/models", options).map(unwrapModels);
      }
    };
    unwrapModels = (wire) => {
      if (Array.isArray(wire?.models)) return wire.models;
      throw new TypeSafeError("Unexpected response shape from GET /v1/models; expected { models: [...] }.");
    };
    g = globalThis;
    isBrowser = () => typeof g.window !== "undefined" && typeof g.window.document !== "undefined" && typeof g.navigator !== "undefined";
    describeRuntime = () => {
      const platform = g.process?.platform && g.process?.arch ? ` (${g.process.platform}; ${g.process.arch})` : "";
      if (g.Bun?.version) return `bun/${g.Bun.version}${platform}`;
      if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}${platform}`;
      if (g.EdgeRuntime !== void 0) return "vercel-edge";
      if (g.navigator?.userAgent === "Cloudflare-Workers") return "cloudflare-workers";
      if (g.process?.versions?.node) return `node/${g.process.versions.node}${platform}`;
      if (isBrowser()) return "browser";
      return "unknown";
    };
    VERSION = "0.6.0";
    missingApiKey = () => {
      throw new TypeSafeError(`No API key was provided. Pass \`apiKey\` to the TypeSafeClient constructor or set the ${ENV.apiKey} environment variable.`);
    };
    missingFetch = () => {
      throw new TypeSafeError("No global `fetch` is available in this runtime. Pass a `fetch` implementation to the TypeSafeClient constructor.");
    };
    refuseBrowser = () => {
      throw new TypeSafeError("TypeSafeClient is running in a browser, which would expose your API key to anyone using the page. Call the API from a server instead, or pass `dangerouslyAllowBrowser: true` if you understand the risk.");
    };
    defaultFetch = (input, init) => globalThis.fetch(input, init);
    assertNonNegativeInteger = (name, value) => {
      if (!Number.isInteger(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative integer, got ${String(value)}.`);
      return value;
    };
    assertPositiveMs = (name, value) => {
      if (!Number.isFinite(value) || value <= 0) throw new TypeSafeError(`\`${name}\` must be a positive number of milliseconds, got ${String(value)}.`);
      return value;
    };
    assertNonNegativeMs = (name, value) => {
      if (!Number.isFinite(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative number of milliseconds, got ${String(value)}.`);
      return value;
    };
    assertFraction = (name, value) => {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeSafeError(`\`${name}\` must be between 0 and 1, got ${String(value)}.`);
      return value;
    };
    assertStatusSet = (name, statuses) => {
      for (const status of statuses) if (!Number.isInteger(status) || status < 100 || status > 999) throw new TypeSafeError(`\`${name}\` must contain HTTP status codes, got ${String(status)}.`);
      return statuses;
    };
    resolveRetryPolicy = (base, overrides) => {
      const o = overrides ?? {};
      return {
        maxRetries: o.maxRetries === void 0 ? base.maxRetries : assertNonNegativeInteger("retry.maxRetries", o.maxRetries),
        backoffInitialMs: o.backoffInitialMs === void 0 ? base.backoffInitialMs : assertNonNegativeMs("retry.backoffInitialMs", o.backoffInitialMs),
        backoffMaxMs: o.backoffMaxMs === void 0 ? base.backoffMaxMs : assertNonNegativeMs("retry.backoffMaxMs", o.backoffMaxMs),
        backoffJitter: o.backoffJitter === void 0 ? base.backoffJitter : assertFraction("retry.backoffJitter", o.backoffJitter),
        httpStatuses: new Set(o.httpStatuses === void 0 ? base.httpStatuses : assertStatusSet("retry.httpStatuses", o.httpStatuses)),
        respectRetryAfter: o.respectRetryAfter ?? base.respectRetryAfter,
        maxRetryAfterMs: o.maxRetryAfterMs === void 0 ? base.maxRetryAfterMs : assertNonNegativeMs("retry.maxRetryAfterMs", o.maxRetryAfterMs),
        apiConnectionError: o.apiConnectionError ?? base.apiConnectionError,
        apiTimeoutError: o.apiTimeoutError ?? base.apiTimeoutError
      };
    };
    isRetryableError = (err, policy) => {
      if (err instanceof APITimeoutError) return policy.apiTimeoutError;
      if (err instanceof APIConnectionError) return policy.apiConnectionError;
      return false;
    };
    resolveLogLevel = (fromCode) => {
      if (fromCode !== void 0) return parseLogLevel(fromCode, "the `logLevel` option");
      const fromEnv = readEnv(ENV.logLevel);
      if (fromEnv !== void 0) return parseLogLevel(fromEnv, ENV.logLevel);
      return DEFAULT_LOG_LEVEL;
    };
    stripTrailingSlashes = (url) => url.replace(/\/+$/, "");
    mergeHeaders = (...sources) => {
      const entries = /* @__PURE__ */ new Map();
      for (const source of sources) for (const [name, value] of Object.entries(source)) if (value === void 0) entries.delete(name.toLowerCase());
      else entries.set(name.toLowerCase(), [name, value]);
      return Object.fromEntries(entries.values());
    };
    bufferResponse = async (response, signal) => {
      const reader = response.clone().body?.getReader();
      if (!reader) return;
      const cancel = () => {
        reader.cancel(signal.reason).catch(() => {
        });
        response.body?.cancel(signal.reason).catch(() => {
        });
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        if (signal.aborted) cancel();
        signal.throwIfAborted();
        while (!(await reader.read()).done) signal.throwIfAborted();
        signal.throwIfAborted();
      } finally {
        signal.removeEventListener("abort", cancel);
        reader.releaseLock();
      }
    };
    RUNTIME = describeRuntime();
    TypeSafeClient = class {
      /** API key excluded from serialization and public properties. */
      #apiKey;
      /** API root with trailing slashes removed. */
      baseURL;
      /** Model used when a request omits `model`. */
      defaultModel;
      /** Configured log verbosity. */
      logLevel;
      /** The configured logger, filtered to `logLevel`. */
      logger;
      /** Retry settings with constructor overrides applied. */
      retry;
      /** Timeout per attempt in milliseconds. */
      timeout;
      /** Additional headers sent with each request. */
      defaultHeaders;
      /** HTTP fetch implementation. */
      fetch;
      /** The models available to the account. */
      models;
      #requestCount = 0;
      /**
      * Create a client for the TypeSafe AI API.
      *
      * Explicit options take precedence over environment variables, then SDK defaults.
      * Empty or whitespace-only environment values are ignored.
      *
      * @throws {TypeSafeError} The API key is missing, configuration is invalid, or the runtime is unsupported.
      */
      constructor(config = {}) {
        if (isBrowser() && !config.dangerouslyAllowBrowser) refuseBrowser();
        this.#apiKey = fromCodeOrEnv(config.apiKey, ENV.apiKey) ?? missingApiKey();
        this.baseURL = stripTrailingSlashes(fromCodeOrEnv(config.baseURL, ENV.baseURL) ?? "https://api.typesafe.ai");
        this.defaultModel = fromCodeOrEnv(config.defaultModel, ENV.defaultModel) ?? "jev-latest";
        this.logLevel = resolveLogLevel(config.logLevel);
        this.logger = withLevel(config.logger ?? consoleLogger, this.logLevel);
        this.retry = resolveRetryPolicy(DEFAULT_RETRY_POLICY, config.retry);
        this.timeout = assertPositiveMs("timeout", config.timeout ?? 1e4);
        this.defaultHeaders = { ...config.defaultHeaders };
        if (config.fetch === void 0 && typeof globalThis.fetch !== "function") missingFetch();
        this.fetch = config.fetch ?? defaultFetch;
        const transport = {
          request: (method, path, options) => this.#request(method, path, options),
          defaultModel: this.defaultModel
        };
        this.models = new Models(transport);
      }
      /**
      * Answer named questions about text or structured state.
      *
      * @param request - State, questions, and an optional model override.
      * @param options - Per-call timeout, retry, headers, and cancellation settings.
      * @returns Answers typed by question name and criteria, with model and token usage.
      * @throws {TypeSafeError} Questions are empty, or score criteria are not a list of at least two entries.
      * @throws {APIError} The server returns a non-2xx response after retries.
      * @throws {APIConnectionError} The request cannot connect or times out after retries.
      * @throws {APIUserAbortError} The caller aborts the request.
      *
      * @example
      * ```ts
      * const { answers } = await client.systemOne({
      *   state: "I was charged twice. Please help.",
      *   questions: { billing: noul("Is this about billing?") },
      * });
      * console.log(answers.billing.noul);
      * ```
      */
      systemOne(request, options = {}) {
        validateQuestions(request.questions);
        const body = {
          ...request,
          model: request.model ?? this.defaultModel
        };
        return this.#request("POST", "/v1/systemone", {
          ...options,
          body
        });
      }
      /** Send a request and parse its response body. */
      #request(method, path, options = {}) {
        const resolved = {
          method,
          path,
          body: options.body,
          headers: mergeHeaders(this.defaultHeaders, options.headers ?? {}),
          signal: options.signal,
          timeout: options.timeout === void 0 ? this.timeout : assertPositiveMs("timeout", options.timeout),
          retry: resolveRetryPolicy(this.retry, options.retry)
        };
        const tag = `#${++this.#requestCount} ${method} ${path}`;
        return new APIPromise(this.fetchWithRetries(tag, resolved), async (res) => {
          const parsed = await parseBody(res);
          this.logger.debug(`${tag} <- body`, parsed);
          return parsed;
        });
      }
      /** Retry eligible failures, logging attempt summaries at `info` and headers and bodies at `debug`. */
      async fetchWithRetries(tag, req) {
        const url = `${this.baseURL}${req.path}`;
        const headers = mergeHeaders(req.headers, {
          Authorization: `Bearer ${this.#apiKey}`,
          Accept: "application/json",
          "User-Agent": `typesafe-sdk/${VERSION}`,
          "X-TypeSafe-SDK": `typesafe-sdk/${VERSION}`,
          "X-TypeSafe-Runtime": RUNTIME,
          "Content-Type": req.body === void 0 ? void 0 : "application/json",
          "X-TypeSafe-Retry-Count": void 0
        });
        const body = req.body === void 0 ? void 0 : JSON.stringify(req.body);
        for (let attempt = 0; ; attempt++) {
          const retriesLeft = req.retry.maxRetries - attempt;
          const attemptHeaders = attempt === 0 ? headers : {
            ...headers,
            "X-TypeSafe-Retry-Count": String(attempt)
          };
          this.logger.debug(`${tag} -> ${url}`, {
            headers: redactHeaders(attemptHeaders),
            body: req.body
          });
          const started = Date.now();
          let res;
          try {
            res = await this.attempt(tag, url, {
              method: req.method,
              headers: attemptHeaders,
              body
            }, req);
          } catch (err) {
            if (err instanceof APIUserAbortError || retriesLeft <= 0) throw err;
            if (!isRetryableError(err, req.retry)) throw err;
            await this.backOff(tag, attempt, retriesLeft, err.message, void 0, req);
            continue;
          }
          const requestId = requestIdFrom(res.headers);
          this.logger.info(`${tag} <- ${res.status} in ${Date.now() - started}ms${requestId ? ` (request ${requestId})` : ""}`);
          if (res.ok) return res;
          const errorBody = await parseBody(res);
          this.logger.debug(`${tag} <- error body`, errorBody);
          const error = APIError.fromResponse(res.status, errorBody, res.headers);
          if (retriesLeft <= 0 || !isRetryableStatus(res.status, req.retry)) throw error;
          await this.backOff(tag, attempt, retriesLeft, `${res.status}`, res.headers, req);
        }
      }
      /**
      * One HTTP round trip, including body delivery, with a timeout. The caller's signal and our
      * timer both abort the same controller; we check which fired to choose the error class.
      */
      async attempt(tag, url, init, { signal, timeout }) {
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(signal?.reason);
        if (signal?.aborted) abortFromCaller();
        signal?.addEventListener("abort", abortFromCaller, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeout);
        const started = Date.now();
        const elapsed = () => `${Date.now() - started}ms`;
        try {
          const response = await this.fetch(url, {
            ...init,
            signal: controller.signal
          });
          await bufferResponse(response, controller.signal);
          return response;
        } catch (err) {
          if (signal?.aborted) {
            this.logger.info(`${tag} aborted by caller after ${elapsed()}`);
            throw new APIUserAbortError(void 0, { cause: err });
          }
          if (timedOut) {
            this.logger.info(`${tag} timed out after ${elapsed()}`);
            throw new APITimeoutError(timeout, { cause: err });
          }
          this.logger.info(`${tag} connection error after ${elapsed()}`, err);
          throw new APIConnectionError(err instanceof Error ? `Connection error: ${err.message}` : void 0, { cause: err });
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abortFromCaller);
        }
      }
      /** Wait before retrying; caller cancellation throws `APIUserAbortError`. */
      async backOff(tag, attempt, retriesLeft, reason, headers, { retry, signal }) {
        const delay = retryDelayMs(attempt, headers, retry);
        const nth = attempt + 1;
        const total = attempt + retriesLeft;
        this.logger.info(`${tag} retrying in ${delay}ms (retry ${nth}/${total}) after ${reason}`);
        try {
          await sleep(delay, signal);
        } catch (err) {
          this.logger.info(`${tag} aborted by caller while waiting to retry`);
          throw new APIUserAbortError(void 0, { cause: err });
        }
      }
    };
    parseBody = async (res) => {
      const text = await res.text();
      if (text.length === 0) return void 0;
      if ((res.headers.get("content-type") ?? "").includes("application/json")) try {
        return JSON.parse(text);
      } catch {
        return text;
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    };
  }
});

// lib/router/jevJudge.ts
var jevJudge_exports = {};
__export(jevJudge_exports, {
  createJevJudge: () => createJevJudge,
  judgeLoad: () => judgeLoad
});
function toState(session) {
  const state = { currentRequest: session.latestQuery };
  if (session.transcript) state.earlierConversationBackground = session.transcript;
  return state;
}
function skillNoul(skill) {
  return noul(
    `A coding agent has this skill available:
Name: ${skill.name}
What it does: ${skill.description}

Should the agent invoke this skill for the user's current request (currentRequest)? Judge against the current request; earlierConversationBackground is context from preceding turns and often describes prior tasks already finished. One exception: when currentRequest is only a brief go-ahead or continuation (such as "go", "proceed", "yes, do that") and states no task of its own, the user is approving the latest plan or proposal in earlierConversationBackground, so judge against that plan instead.`,
    {
      true: "The current request, or the plan it approves, clearly calls for this skill.",
      // No "a different skill fits better" clause: this Noul sees only its own skill,
      // so it cannot judge that comparison.
      false: "This skill is unrelated to the current request \u2014 even if earlier conversation touched its domain."
    }
  );
}
function createJevJudge(config = {}) {
  const client = config.client ?? new TypeSafeClient();
  return {
    name: "jev",
    async judge({ session, candidates }) {
      const state = toState(session);
      const questions = {};
      for (const skill of candidates) questions[skill.id] = skillNoul(skill);
      const started = performance.now();
      const response = await client.systemOne({ state, questions });
      const latencyMs = Math.round(performance.now() - started);
      const answers = response.answers;
      const probabilities = /* @__PURE__ */ new Map();
      const missing = [];
      for (const skill of candidates) {
        const p = answers[skill.id]?.noul;
        if (typeof p === "number") probabilities.set(skill.id, p);
        else missing.push(skill.id);
      }
      if (missing.length) {
        throw new Error(`Jev returned no Noul for ${missing.length} skill(s): ${missing.join(", ")}`);
      }
      return { probabilities, latencyMs };
    }
  };
}
async function judgeLoad(session, skill, args, client = new TypeSafeClient()) {
  const state = toState(session);
  if (args) state.skillCallArguments = args;
  const response = await client.systemOne({
    state,
    questions: {
      load: noul(
        `A coding agent is working on the user's current request (currentRequest; earlierConversationBackground is the conversation before it). Part-way through the work it has chosen to load this skill:
Name: ${skill.name}
What it does: ${skill.description}
` + (args ? `It passed these arguments (skillCallArguments).
` : "") + `
Does loading this skill serve the request \u2014 directly, or for a step the work has turned out to need?`,
        {
          true: "This skill serves the current request or a step of it.",
          false: "This skill has nothing to do with the current request; loading it would only spend context."
        }
      )
    }
  });
  const p = response.answers.load?.noul;
  if (typeof p !== "number") throw new Error("judgeLoad: Jev returned no probability");
  return p;
}
var init_jevJudge = __esm({
  "lib/router/jevJudge.ts"() {
    "use strict";
    init_dist();
  }
});

// hooks/pre-tool-use-gate.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join as join2 } from "node:path";

// lib/slash.ts
function typedSlash(prompt, name) {
  const text = prompt.toLowerCase();
  const needle = `/${name.toLowerCase()}`;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1];
    const after = text[at + needle.length];
    const opens = before === void 0 || /[\s(["'`]/.test(before);
    const ends = after === void 0 || !/[a-z0-9:_-]/.test(after);
    if (opens && ends) return true;
  }
  return false;
}

// lib/router/jevKey.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function loadJevKey() {
  if (process.env.TYPESAFE_API_KEY) return;
  const pluginKey = process.env.CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY;
  if (pluginKey) {
    process.env.TYPESAFE_API_KEY = pluginKey;
    return;
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(".env.local"),
    join(moduleDir, "..", "..", ".env.local"),
    join(moduleDir, "..", ".env.local")
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    process.loadEnvFile(p);
    if (process.env.TYPESAFE_API_KEY) return;
  }
}
function jevKeyAvailable() {
  loadJevKey();
  return Boolean(process.env.TYPESAFE_API_KEY);
}

// hooks/pre-tool-use-gate.ts
var STATE_DIR = join2(tmpdir(), "jev-skill-router");
var STATE_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var REJUDGE_FLOOR = 0.5;
function allow() {
  process.exit(0);
}
async function rejudge(state, id, args, logPath) {
  const skill = state.skills?.[id];
  if (!skill || state.judge !== "jev" || !jevKeyAvailable()) return null;
  try {
    const { judgeLoad: judgeLoad2 } = await Promise.resolve().then(() => (init_jevJudge(), jevJudge_exports));
    const p = await judgeLoad2({ latestQuery: state.prompt, transcript: state.transcript ?? "" }, skill, args);
    try {
      appendFileSync(logPath, JSON.stringify({ ts: Date.now(), skill: id, p, allowed: p >= REJUDGE_FLOOR }) + "\n");
    } catch {
    }
    return p;
  } catch {
    return null;
  }
}
function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    })
  );
  process.exit(0);
}
function recordLoaded(loadedDir, id) {
  try {
    mkdirSync(loadedDir, { recursive: true });
    writeFileSync(join2(loadedDir, encodeURIComponent(id)), "");
  } catch {
  }
}
function namedByLoadedSkill(loadedDir, sources, names) {
  if (!existsSync2(loadedDir)) return false;
  const n = names.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const mention = new RegExp(`\`/?(${n})\`|(^|[\\s(])/(${n})(?![\\w-])|(^|[^\\w-])(${n})\\s+skill\\b`, "i");
  for (const file of readdirSync(loadedDir)) {
    const source = sources[decodeURIComponent(file)];
    if (!source) continue;
    try {
      if (mention.test(readFileSync(source, "utf8"))) return true;
    } catch {
    }
  }
  return false;
}
function alwaysAllowList(projectCwd) {
  for (const p of [join2(projectCwd, ".skillrouter.json"), join2(homedir(), ".skillrouter.json")]) {
    if (!existsSync2(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(cfg.alwaysAllow)) return cfg.alwaysAllow.filter((x) => typeof x === "string");
    } catch {
    }
    break;
  }
  return [];
}
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (input.tool_name !== "Skill") allow();
  const skill = input.tool_input?.skill ?? "";
  if (!skill) allow();
  const statePath = join2(STATE_DIR, `turn-${input.session_id ?? "unknown"}.json`);
  if (!existsSync2(statePath)) allow();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (Date.now() - state.ts > STATE_MAX_AGE_MS) allow();
  const governed = /* @__PURE__ */ new Set([...state.catalog ?? [], ...state.excluded ?? []]);
  const synced = `anthropic-skills:${skill}`;
  const judgedId = governed.has(skill) ? skill : governed.has(synced) ? synced : null;
  if (!judgedId) allow();
  const approved = /* @__PURE__ */ new Set([...state.invoke, ...state.suggest, ...alwaysAllowList(input.cwd ?? process.cwd())]);
  const baseName = skill.split(":").pop() ?? skill;
  const loadedDir = join2(STATE_DIR, `loaded-${input.session_id ?? "unknown"}`);
  if (typedSlash(state.prompt, skill) || typedSlash(state.prompt, baseName) || approved.has(skill) || approved.has(judgedId) || !(state.excluded ?? []).includes(judgedId) && namedByLoadedSkill(loadedDir, state.sources ?? {}, [.../* @__PURE__ */ new Set([skill, judgedId])])) {
    recordLoaded(loadedDir, judgedId);
    allow();
  }
  const excluded = (state.excluded ?? []).includes(judgedId);
  const p = excluded ? null : await rejudge(state, judgedId, input.tool_input?.args, join2(STATE_DIR, `gate-${input.session_id ?? "unknown"}.jsonl`));
  if (p !== null && p >= REJUDGE_FLOOR) {
    recordLoaded(loadedDir, judgedId);
    allow();
  }
  deny(
    `Skill routing gate: "${skill}" is not on this turn's approved list` + (p === null ? ". " : ` and was judged unrelated to this request (${p.toFixed(2)}). `) + `Invoke: [${state.invoke.join(", ") || "none"}]. Suggested: [${state.suggest.join(", ") || "none"}]. Use an approved skill, or ask the user if you believe this skill is needed.`
  );
} catch {
  allow();
}
