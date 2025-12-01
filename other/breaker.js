import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export default class BasicUnicodeTransform extends Transform {
  constructor() {
    super({ decodeStrings: false });
    this.decoder = new StringDecoder("utf8");

    this.accumulator = "";   // pending output chunk
    this.stack = [];         // open delimiters
    this.nobreak = false;    // true when inside any pair
    this.pendingBreak = false;      // sentence end marker seen
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
    if (pairAction === "close" || this.nobreak)
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
      this.pendingBreak = false;
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
    this.pendingBreak = false;
  }

  insertBreak() {
    if (this.accumulator.length > 0) {
      this.accumulator += "\n";
      this.push(this.accumulator);
      this.accumulator = "";
    }

    this.pendingWhitespace = "";
    this.pendingBreak = false;

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
