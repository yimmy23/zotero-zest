const { config } = require("../package.json");
const PANEL_URL = `chrome://${config.addonRef}/content/panel.xhtml`;

function events(target) {
  const listeners = new Map();
  target.listeners = listeners;
  target.addEventListener = (type, callback, options = {}) => {
    const entries = listeners.get(type) || new Map();
    entries.set(callback, options);
    listeners.set(type, entries);
  };
  target.removeEventListener = (type, callback) => {
    listeners.get(type)?.delete(callback);
  };
  target.dispatch = (type, payload = {}) => {
    const event = {
      type,
      target,
      currentTarget: target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...payload,
    };
    for (const [callback, options] of [...(listeners.get(type) || [])]) {
      if (options.once) listeners.get(type).delete(callback);
      callback(event);
    }
    return event;
  };
}

/** Detached DOM: preserves text, attributes, focus and native event lifetimes. */
class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag;
    this.nodeType = tag === "#text" ? 3 : tag === "#fragment" ? 11 : 1;
    this.childNodes = [];
    this.parentElement = null;
    this.className = "";
    this.attributes = new Map();
    this.style = {
      setProperty(name, value) {
        this[name] = String(value);
      },
      getPropertyValue(name) {
        return this[name] || "";
      },
    };
    this.open = false;
    this.disabled = false;
    this.text = "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => {
        this.className = [
          ...new Set([...this.className.split(/\s+/), ...names]),
        ]
          .filter(Boolean)
          .join(" ");
      },
    };
    this.dataset = new Proxy(
      {},
      {
        set: (_target, key, value) => {
          this.setAttribute(
            `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
            value,
          );
          return true;
        },
      },
    );
    events(this);
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  get value() {
    if (this.tagName === "progress") return this._value ?? 0;
    if (this.tagName === "select") {
      const selected =
        this._selectedValue === undefined
          ? this.children.find((option) => option.selected) || this.children[0]
          : this.children.find(
              (option) => option.value === this._selectedValue,
            );
      return selected?.value || "";
    }
    return this._value || "";
  }
  set value(value) {
    if (this.tagName === "select") this._selectedValue = String(value);
    else if (this.tagName === "progress") this._value = Number(value);
    else this._value = String(value);
  }
  get textContent() {
    return this.text + this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value) {
    this.ownerDocument.writes++;
    for (const child of this.childNodes) child.parentElement = null;
    this.childNodes = [];
    this.text = String(value);
  }
  set innerHTML(_value) {
    throw new Error("Dialog content must not inject untrusted HTML");
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node) {
    this.ownerDocument.writes++;
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) this.appendChild(child);
      return node;
    }
    node.remove();
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }
  remove() {
    const siblings = this.parentElement?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  setAttribute(name, value) {
    this.ownerDocument.writes++;
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  matches(selector) {
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    if (
      attrs.some(([, name, value]) =>
        value === undefined
          ? !this.attributes.has(name)
          : this.getAttribute(name) !== value,
      )
    )
      return false;
    const base = selector.replace(/\[[^\]]+\]/g, "");
    const [tag, ...classes] = base.split(".");
    return (
      (!tag || this.tagName === tag) &&
      classes.every((name) => this.classList.contains(name))
    );
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const found = [];
    const matches = (node) => {
      if (!node.matches(parts.at(-1))) return false;
      let ancestor = node.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (ancestor && !ancestor.matches(parts[i]))
          ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  click() {
    if (!this.disabled) this.dispatch("click");
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  select() {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }
}

function windowFixture({
  readyState = "complete",
  body = true,
  url = PANEL_URL,
} = {}) {
  const doc = {
    readyState,
    documentURI: url,
    URL: url,
    location: { href: url },
    activeElement: null,
    writes: 0,
    createElement: (tag) => new Element(doc, tag),
    createElementNS: (_namespace, tag) => new Element(doc, tag),
    createDocumentFragment: () => new Element(doc, "#fragment"),
    createTextNode: (text) => {
      const node = new Element(doc, "#text");
      node.text = text;
      return node;
    },
    querySelector: (selector) => doc.documentElement.querySelector(selector),
    querySelectorAll: (selector) =>
      doc.documentElement.querySelectorAll(selector),
  };
  doc.documentElement = doc.createElement("html");
  const attachBody = () => {
    doc.body = doc.createElement("body");
    doc.documentElement.append(doc.body);
  };
  if (body) attachBody();
  const timers = new Map();
  let nextTimer = 0;
  const win = {
    document: doc,
    location: doc.location,
    closed: false,
    closeCount: 0,
    focusCount: 0,
    scrollY: 0,
    timers,
    setTimeout(fn, delay) {
      timers.set(++nextTimer, { fn, delay });
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    flushTimers() {
      for (const [id, { fn }] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    focus() {
      this.focusCount++;
    },
    scrollTo(_x, y) {
      this.scrollY = y;
    },
    close() {
      this.closeCount++;
      this.closed = true;
      this.dispatch("unload");
    },
    finishLoad() {
      if (doc.documentURI !== PANEL_URL) {
        doc.body?.remove();
        attachBody();
      }
      if (!doc.body) attachBody();
      doc.documentURI = PANEL_URL;
      doc.URL = PANEL_URL;
      doc.location.href = PANEL_URL;
      doc.readyState = "complete";
      this.dispatch("load");
    },
  };
  events(win);
  doc.defaultView = win;
  return win;
}

module.exports = { events, Element, windowFixture, PANEL_URL };
