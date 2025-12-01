class MiniEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, listener) {
    if (!this.listeners.has(event))
      this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return this;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  off(event, listener) {
    if (!this.listeners.has(event))
      return this;
    if (!listener)
      this.listeners.get(event).clear();
    else
      this.listeners.get(event).delete(listener);
    return this;
  }

  removeListener(event, listener) {
    return this.off(event, listener);
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  removeAllListeners(event) {
    if (event == null)
      this.listeners.clear();
    else
      this.listeners.delete(event);
    return this;
  }

  emit(event, ...args) {
    if (!this.listeners.has(event)) {
      if (event === "error") {
        const err = args[0] instanceof Error ? args[0] : new Error(args[0]);
        throw err;
      }
      return false;
    }
    for (const listener of [...this.listeners.get(event)])
      listener(...args);
    return true;
  }
}

class BrowserTransform extends MiniEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...options };
    this.readable = true;
    this.writable = true;
    this.destroyed = false;
    this._readEnded = false;
    this._writeEnded = false;
  }

  push(chunk) {
    if (chunk === null) {
      if (this._readEnded)
        return false;
      this._readEnded = true;
      this.emit("end");
      return false;
    }

    this.emit("data", chunk);
    return true;
  }

  write(chunk, encoding, callback) {
    if (this.destroyed)
      throw new Error("Stream is destroyed");

    if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }

    const cb = typeof callback === "function" ? callback : () => {};
    if (typeof this._transform !== "function") {
      throw new Error("_transform is not implemented");
    }

    try {
      this._transform(chunk, encoding, err => {
        if (err) {
          this.emit("error", err);
          cb(err);
          return;
        }
        cb();
      });
    } catch (err) {
      this.emit("error", err);
      cb(err);
    }

    return true;
  }

  end(chunk, encoding, callback) {
    if (typeof chunk === "function") {
      callback = chunk;
      chunk = undefined;
      encoding = undefined;
    } else if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }

    if (chunk != null)
      this.write(chunk, encoding);

    const finish = err => {
      if (err)
        this.emit("error", err);
      if (this._writeEnded)
        return;
      this._writeEnded = true;
      this.emit("finish");
      this.push(null);
      callback?.(err);
    };

    if (typeof this._flush === "function") {
      try {
        this._flush(finish);
      } catch (err) {
        finish(err);
      }
    } else {
      finish();
    }

    return this;
  }

  pipe(dest) {
    this.on("data", chunk => {
      if (typeof dest.write === "function")
        dest.write(chunk);
      else
        dest.push?.(chunk);
    });
    this.once("end", () => dest.end?.());
    this.on("error", err => dest.emit?.("error", err));
    dest.emit?.("pipe", this);
    return dest;
  }

  destroy(err) {
    if (this.destroyed)
      return;
    this.destroyed = true;
    if (err)
      this.emit("error", err);
    this.emit("close");
  }
}

class BrowserStringDecoder {
  constructor(encoding = "utf8") {
    let normalized = encoding?.toLowerCase?.() || "utf8";
    if (normalized === "utf8")
      normalized = "utf-8";
    if (normalized !== "utf-8")
      throw new Error(`Unsupported encoding: ${encoding}`);
    if (typeof TextDecoder === "undefined")
      throw new Error("TextDecoder is not available in this environment");
    this.decoder = new TextDecoder("utf-8");
  }

  write(chunk) {
    if (chunk == null)
      return "";
    if (typeof chunk === "string")
      return chunk;
    return this.decoder.decode(this.asUint8Array(chunk), { stream: true });
  }

  end(chunk) {
    let text = "";
    if (chunk != null)
      text += this.write(chunk);
    text += this.decoder.decode();
    return text;
  }

  asUint8Array(value) {
    if (value instanceof Uint8Array)
      return value;
    if (value instanceof ArrayBuffer)
      return new Uint8Array(value);
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === "number")
      return new Uint8Array([value & 0xff]);
    return new Uint8Array();
  }
}

let TransformBase = BrowserTransform;
let StringDecoderBase = BrowserStringDecoder;
const IS_NODE = typeof process !== "undefined" && !!(process.versions?.node);
if (IS_NODE) {
  try {
    ({ Transform: TransformBase } = await import("node:stream"));
    ({ StringDecoder: StringDecoderBase } = await import("node:string_decoder"));
  } catch (err) {
    console.warn("Falling back to browser Transform implementation", err);
    TransformBase = BrowserTransform;
    StringDecoderBase = BrowserStringDecoder;
  }
}

export default class BasicUnicodeTransform extends TransformBase {
  constructor() {
    super({ decodeStrings: false });
    this.decoder = new StringDecoderBase("utf8");

    this.accumulator = "";   // pending output chunk
    this.stack = [];         // open delimiters
    this.nobreak = false;    // true when inside any pair
    this.pendingBreak = false;      // sentence end marker seen
    this.pendingBreakDepth = null;  // stack depth when a break was scheduled
    this.pendingWhitespace = "";   // whitespace to replace with newline
    this.leadingBuffer = "";       // characters buffered before we decide to break
    this.prevChar = "";            // last processed character

    this.PAIRS = {
      "(": ")", "[": "]", "{": "}", "<": ">",
      "“": "”", "‘": "’",
      "「": "」", "『": "』",
      "《": "》", "〉": "〉",
    };

    this.SYMMETRIC = new Set(['"', "'"]);
    this.SENTENCE_ENDERS = new Set([".", "!", "?", "。", "！", "？"]);
  }

  cancelPendingBreak() {
    this.pendingBreak = false;
    this.pendingBreakDepth = null;
  }

  // --------------------------
  // Character-level processing
  // --------------------------

  processPairs(ch) {
    let action = "none";

    // Symmetric -> toggle
    if (this.SYMMETRIC.has(ch)) {
      if (this.stack.length && this.stack.at(-1) === ch) {
        this.stack.pop();
        action = "close";
      } else if (ch === "'" && this.isWordChar(this.prevChar)) {
        action = "none";
      } else {
        this.stack.push(ch);
        action = "open";
      }
      this.nobreak = this.stack.length > 0;
      return action;
    }

    // Opening delimiters
    if (this.PAIRS[ch]) {
      this.stack.push(ch);
      this.nobreak = true;
      return "open";
    }

    // Closing delimiters
    for (const open in this.PAIRS) {
      if (this.PAIRS[open] === ch) {
        if (this.stack.at(-1) === open) {
          this.stack.pop();
          action = "close";
        }
        break;
      }
    }

    this.nobreak = this.stack.length > 0;
    return action;
  }

  pushChar(ch) {
    const pairAction = this.processPairs(ch);
    this.routeChar(ch, pairAction);
    this.prevChar = ch;
  }

  routeChar(ch, pairAction) {
    if (this.isWhitespace(ch)) {
      this.handleWhitespace(ch);
      return;
    }

    if (this.pendingBreak) {
      const status = this.resolvePendingBreak(ch, pairAction);
      if (status === "buffered")
        return;
    }

    this.appendToAccumulator(ch);

    if (this.isSentenceEnder(ch)) {
      this.pendingBreak = true;
      this.pendingBreakDepth = this.stack.length;
    }
  }

  handleWhitespace(ch) {
    if (this.pendingBreak && !this.nobreak) {
      if (this.leadingBuffer.length > 0)
        this.leadingBuffer += ch;
      else
        this.pendingWhitespace += ch;
      return;
    }

    if (this.leadingBuffer.length > 0) {
      this.leadingBuffer += ch;
      return;
    }

    this.appendToAccumulator(ch);
  }

  resolvePendingBreak(ch, pairAction) {
    if (pairAction === "close")
      return "continue";

    const deeperThanBreak = this.pendingBreak &&
      this.pendingBreakDepth !== null &&
      this.stack.length > this.pendingBreakDepth;

    if (this.nobreak && !deeperThanBreak)
      return "continue";

    if (this.isSentenceStarterNeutral(ch, pairAction)) {
      this.leadingBuffer += ch;
      return "buffered";
    }

    if (this.pendingWhitespace.length > 0) {
      if (this.isLowercase(ch)) {
        this.flushPendingWhitespace();
        return "continue";
      }

      this.insertBreak();
      return "continue";
    }

    if (this.isLowercase(ch)) {
      this.cancelPendingBreak();
      return "continue";
    }

    if (this.shouldBreakOn(ch))
      this.insertBreak();

    return "continue";
  }

  appendToAccumulator(text) {
    if (text.length === 0)
      return;

    this.accumulator += text;
  }

  flushPendingWhitespace() {
    this.appendToAccumulator(this.pendingWhitespace);
    this.appendToAccumulator(this.leadingBuffer);
    this.pendingWhitespace = "";
    this.leadingBuffer = "";
    this.cancelPendingBreak();
  }

  insertBreak() {
    if (this.accumulator.length > 0) {
      this.accumulator += "\n";
      this.push(this.accumulator);
      this.accumulator = "";
    }

    this.pendingWhitespace = "";
    this.cancelPendingBreak();

    if (this.leadingBuffer.length > 0) {
      this.accumulator = this.leadingBuffer;
      this.leadingBuffer = "";
    }
  }

  isWhitespace(ch) {
    return /\s/.test(ch);
  }

  isSentenceEnder(ch) {
    return this.SENTENCE_ENDERS.has(ch);
  }

  isLowercase(ch) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower === upper)
      return false;
    return ch === lower;
  }

  isSentenceStarterNeutral(ch, pairAction) {
    return pairAction === "open";
  }

  shouldBreakOn(ch) {
    return !this.isLowercase(ch);
  }

  isWordChar(ch) {
    if (!ch)
      return false;

    return /[\p{L}\p{N}]/u.test(ch);
  }

  cleanBreaks(text) {
    if (!text)
      return "";

    return text.replace(/(?:\r\n|\r|\n)+/g, " ");
  }

  // --------------------------
  // Transform stream plumbing
  // --------------------------

  _transform(chunk, enc, cb) {
    const text = this.decoder.write(chunk);

    if (text.length > 0) {
      const cleaned = this.cleanBreaks(text);

      for (const ch of cleaned) {
        this.pushChar(ch);
      }
    }

    cb();
  }

  _flush(cb) {
    // finish decoding UTF-8 edge cases
    const tail = this.decoder.end();
    if (tail) {
      const cleaned = this.cleanBreaks(tail);
      for (const ch of cleaned) {
        this.pushChar(ch);
      }
    }

    if (this.pendingBreak)
      this.insertBreak();

    if (this.pendingWhitespace.length > 0 || this.leadingBuffer.length > 0) {
      this.appendToAccumulator(this.pendingWhitespace);
      this.appendToAccumulator(this.leadingBuffer);
      this.pendingWhitespace = "";
      this.leadingBuffer = "";
    }

    // Emit anything left
    if (this.accumulator.length > 0) {
      this.push(this.accumulator);
    }

    this.accumulator = "";
    cb();
  }
}
