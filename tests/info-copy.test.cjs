const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

function setup({ tabindex = null } = {}) {
  const copied = [];
  const logs = [];
  let selection = null;
  const doc = {
    activeElement: null,
    defaultView: { getSelection: () => selection },
    createElement: (tag) => element(tag),
    createXULElement: (tag) => element(tag),
  };

  function element(tag, parent, className = "") {
    const attrs = new Map();
    const listeners = new Map();
    let content = "";
    const node = {
      nodeType: tag === "#text" ? 3 : 1,
      localName: tag,
      ownerDocument: doc,
      parentNode: null,
      children: [],
      className,
      get parentElement() {
        return this.parentNode;
      },
      get isConnected() {
        return this === doc.documentElement || !!this.parentNode?.isConnected;
      },
      get textContent() {
        return (
          content + this.children.map((child) => child.textContent).join("")
        );
      },
      set textContent(value) {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        content = String(value);
      },
      contains(other) {
        for (
          let candidate = other;
          candidate;
          candidate = candidate.parentNode
        ) {
          if (candidate === this) return true;
        }
        return false;
      },
      closest(selector) {
        const matches = (candidate, part) => {
          const classes = candidate.className.split(/\s+/);
          if (part.startsWith(".")) return classes.includes(part.slice(1));
          if (part === "button:not(.zest-info-author)") {
            return (
              candidate.localName === "button" &&
              !classes.includes("zest-info-author")
            );
          }
          if (part.startsWith("[contenteditable]")) {
            const value = candidate.getAttribute("contenteditable");
            return value !== null && value !== "false";
          }
          return candidate.localName === part;
        };
        for (
          let candidate = this;
          candidate;
          candidate = candidate.parentElement
        ) {
          if (
            selector.split(",").some((part) => matches(candidate, part.trim()))
          ) {
            return candidate;
          }
        }
        return null;
      },
      appendChild(child) {
        child.remove();
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (!this.parentNode) return;
        const siblings = this.parentNode.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentNode = null;
      },
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, String(value)),
      removeAttribute: (name) => attrs.delete(name),
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(callback);
      },
      removeEventListener(type, callback) {
        listeners.get(type)?.delete(callback);
      },
      listenerCount() {
        return [...listeners.values()].reduce(
          (sum, entries) => sum + entries.size,
          0,
        );
      },
      emit(type, options = {}) {
        const event = {
          target: this,
          key: "c",
          button: 0,
          screenX: 125,
          screenY: 250,
          defaultPrevented: false,
          stopped: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
          stopPropagation() {
            this.stopped = true;
          },
          ...options,
        };
        for (const callback of [...(listeners.get(type) || [])])
          callback(event);
        return event;
      },
      focus() {
        doc.activeElement = this;
      },
      openPopupAtScreen(...args) {
        this.openArgs = args;
      },
      hidePopup() {
        this.emit("popuphidden");
      },
    };
    node.classList = {
      add(name) {
        node.className = `${node.className} ${name}`.trim();
      },
    };
    parent?.appendChild(node);
    return node;
  }

  doc.documentElement = element("window");
  const root = element("div", doc.documentElement);
  if (tabindex !== null) root.setAttribute("tabindex", tabindex);
  const field = element("div", root, "zest-info-copyable");
  field.textContent = "field value";
  const internal = { copyTextToClipboard: (text) => copied.push(text) };
  const harness = createHarness({
    globals: {
      Zotero: { Utilities: { Internal: internal }, logError() {} },
      ztoolkit: { log: (...args) => logs.push(args) },
    },
    mocks: { "src/utils/locale.ts": { getString: (key) => key } },
  });
  const api = harness.load("src/panes/infoCopy.ts");

  function select({
    text = "selected text",
    start = field,
    end = start,
    collapsed = false,
    ranges = [{ startContainer: start, endContainer: end }],
  } = {}) {
    selection = {
      isCollapsed: collapsed,
      rangeCount: ranges.length,
      anchorNode: start,
      focusNode: end,
      getRangeAt: (index) => ranges[index],
      toString: () => text,
    };
  }
  function popup() {
    return doc.documentElement.children.find(
      (child) => child.localName === "popupset",
    )?.children[0];
  }
  return {
    ...api,
    doc,
    root,
    field,
    copied,
    logs,
    internal,
    element,
    select,
    popup,
  };
}

test("selection is returned verbatim only when nonempty and wholly inside the pane", () => {
  const s = setup();
  assert.equal(s.selectedInfoText(s.root), "");
  const textNode = s.element("#text", s.field);
  s.select({ start: textNode, text: " part one\npart two " });
  assert.equal(s.selectedInfoText(s.root), " part one\npart two ");
  for (const options of [
    { collapsed: true },
    { ranges: [] },
    { text: " \n " },
  ]) {
    s.select(options);
    assert.equal(s.selectedInfoText(s.root), "");
  }
  const otherPane = s.element("div", s.doc.documentElement);
  for (const options of [
    { start: otherPane },
    { end: otherPane },
    {
      ranges: [
        { startContainer: s.field, endContainer: s.field },
        { startContainer: otherPane, endContainer: otherPane },
      ],
    },
  ]) {
    s.select(options);
    assert.equal(s.selectedInfoText(s.root), "");
  }
});

test("installing handlers never copies, and Cmd/Ctrl+C copies a scoped selection", () => {
  const s = setup();
  s.select();
  const dispose = s.installInfoCopy(s.root);
  assert.deepEqual(s.copied, []);
  for (const modifier of [{ metaKey: true }, { ctrlKey: true, key: "C" }]) {
    const event = s.root.emit("keydown", { target: s.field, ...modifier });
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
  }
  assert.deepEqual(s.copied, ["selected text", "selected text"]);
  dispose();
});

test("unrelated shortcuts, absent selection, and foreign selections stay native", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  s.select();
  for (const options of [
    {},
    { ctrlKey: true, altKey: true },
    { metaKey: true, shiftKey: true },
    { ctrlKey: true, key: "v" },
  ]) {
    const event = s.root.emit("keydown", options);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
  }
  const alreadyHandled = s.root.emit("keydown", {
    metaKey: true,
    defaultPrevented: true,
  });
  assert.equal(alreadyHandled.stopped, false);
  for (const options of [
    { collapsed: true },
    { text: "" },
    { end: s.element("div", s.doc.documentElement) },
  ]) {
    s.select(options);
    assert.equal(
      s.root.emit("keydown", { metaKey: true }).defaultPrevented,
      false,
    );
  }
  assert.deepEqual(s.copied, []);
});

test("editors and ordinary controls keep native copy and context menus", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  const controls = [
    "input",
    "textarea",
    "select",
    "button",
    "a",
    "summary",
  ].map((tag) => s.element(tag, s.field));
  const editable = s.element("div", s.field);
  editable.setAttribute("contenteditable", "true");
  controls.push(editable);
  for (const control of controls) {
    const child = s.element("span", control);
    s.select({ start: child });
    assert.equal(s.selectedInfoText(s.root), "");
    s.select();
    for (const type of ["keydown", "contextmenu"]) {
      const event = s.root.emit(type, { target: child, metaKey: true });
      assert.equal(event.defaultPrevented, false, control.localName);
      assert.equal(event.stopped, false, control.localName);
    }
    assert.equal(s.popup(), undefined);
  }
  assert.deepEqual(s.copied, []);
});

test("context menu prefers selected text and copies only when its command runs", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  s.select({ text: "part of field" });
  const event = s.root.emit("contextmenu", { target: s.field });
  const popup = s.popup();
  const command = popup.children[0];
  assert.equal(command.getAttribute("label"), "info-copy-selected");
  assert.deepEqual(popup.openArgs, [125, 250, true]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.deepEqual(s.copied, []);
  s.select({ text: "later selection" });
  command.emit("command");
  assert.deepEqual(s.copied, ["part of field"]);
  assert.equal(s.popup(), undefined);
  assert.equal(command.listenerCount(), 0);
  assert.equal(popup.listenerCount(), 0);
});

test("native popuphidden before command still copies the captured text once", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  s.select({ text: "native selected text" });
  s.root.emit("contextmenu", { target: s.field });
  const popup = s.popup();
  const command = popup.children[0];
  popup.emit("popuphidden");
  assert.deepEqual(s.copied, []);
  s.select({ text: "selection after menu closed" });
  command.emit("command");
  command.emit("command");
  assert.deepEqual(s.copied, ["native selected text"]);
  assert.equal(s.popup(), undefined);
  assert.equal(command.listenerCount(), 0);
});

test("a hidden menu cannot copy after disposal and a subsequent render", () => {
  const s = setup();
  const dispose = s.installInfoCopy(s.root);
  s.root.emit("contextmenu", { target: s.field });
  const popup = s.popup();
  const command = popup.children[0];
  popup.emit("popuphidden");
  dispose();
  const nextDispose = s.installInfoCopy(s.root);
  command.emit("command");
  assert.deepEqual(s.copied, []);
  assert.equal(command.listenerCount(), 0);
  assert.equal(s.popup(), undefined);
  nextDispose();
});

test("opening another menu invalidates the hidden menu's pending command", () => {
  const s = setup();
  const dispose = s.installInfoCopy(s.root);
  s.root.emit("contextmenu", { target: s.field });
  const first = s.popup();
  const staleCommand = first.children[0];
  first.emit("popuphidden");
  s.field.innerText = "next field text";
  s.root.emit("contextmenu", { target: s.field });
  const current = s.popup();
  staleCommand.emit("command");
  assert.deepEqual(s.copied, []);
  assert.equal(staleCommand.listenerCount(), 0);
  assert.equal(s.popup(), current);
  current.children[0].emit("command");
  assert.deepEqual(s.copied, ["next field text"]);
  dispose();
});

test("canceling a native menu without a command never copies", () => {
  const s = setup();
  const dispose = s.installInfoCopy(s.root);
  s.root.emit("contextmenu", { target: s.field });
  const popup = s.popup();
  const command = popup.children[0];
  popup.emit("popuphidden");
  popup.emit("popuphidden");
  assert.equal(s.popup(), undefined);
  assert.deepEqual(s.copied, []);
  dispose();
  assert.equal(command.listenerCount(), 0);
  assert.equal(popup.listenerCount(), 0);
  assert.deepEqual(s.copied, []);
});

test("field copy uses the closest visible field and preserves line breaks", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  const inner = s.element("div", s.field, "zest-info-copyable");
  inner.textContent = "visible line one hidden text visible line two";
  inner.innerText = "visible line one\nvisible line two";
  const target = s.element("span", inner);
  s.root.emit("contextmenu", { target });
  assert.equal(s.popup().children[0].getAttribute("label"), "info-copy-field");
  s.popup().children[0].emit("command");
  assert.deepEqual(s.copied, ["visible line one\nvisible line two"]);
});

test("textContent is a fallback only when visible text is unavailable", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  s.root.emit("contextmenu", { target: s.field });
  s.popup().children[0].emit("command");
  assert.deepEqual(s.copied, ["field value"]);
  s.field.innerText = "";
  const hidden = s.root.emit("contextmenu", { target: s.field });
  assert.equal(hidden.defaultPrevented, false);
  assert.equal(s.popup(), undefined);
  const background = s.root.emit("contextmenu");
  assert.equal(background.defaultPrevented, false);
  assert.deepEqual(s.copied, ["field value"]);
});

test("author buttons and explicitly noneditable fields support text copy", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  const author = s.element(
    "button",
    s.root,
    "zest-info-author zest-info-copyable",
  );
  author.innerText = "Ada Author";
  s.root.emit("contextmenu", { target: author });
  s.popup().children[0].emit("command");
  s.select({ start: author, text: "Ada" });
  assert.equal(
    s.root.emit("keydown", { target: author, ctrlKey: true }).defaultPrevented,
    true,
  );
  s.field.setAttribute("contenteditable", "false");
  s.select({ start: s.field, text: "read only" });
  assert.equal(
    s.root.emit("keydown", { target: s.field, metaKey: true }).defaultPrevented,
    true,
  );
  assert.deepEqual(s.copied, ["Ada Author", "Ada", "read only"]);
});

test("prose mousedown focuses the pane without consuming selection or author focus", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  const event = s.root.emit("mousedown", { target: s.field });
  assert.equal(s.doc.activeElement, s.root);
  assert.equal(event.defaultPrevented, false);
  const author = s.element(
    "button",
    s.root,
    "zest-info-author zest-info-copyable",
  );
  const editor = s.element("input", s.field);
  for (const options of [
    { target: author },
    { target: editor },
    { target: s.field, button: 2 },
    { target: s.field, shiftKey: true },
    { target: s.field, metaKey: true },
  ]) {
    s.doc.activeElement = author;
    s.root.emit("mousedown", options);
    assert.equal(s.doc.activeElement, author);
  }
  assert.deepEqual(s.copied, []);
});

test("opening or dismissing another menu removes the previous command", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  s.root.emit("contextmenu", { target: s.field });
  const first = s.popup();
  const firstCommand = first.children[0];
  s.root.emit("contextmenu", { target: s.field });
  assert.notEqual(s.popup(), first);
  assert.equal(first.isConnected, false);
  assert.equal(firstCommand.listenerCount(), 0);
  firstCommand.emit("command");
  const second = s.popup();
  second.emit("popuphidden");
  assert.equal(s.popup(), undefined);
  assert.equal(second.listenerCount(), 0);
  s.root.emit("contextmenu", { target: s.field });
  s.root.emit("contextmenu", { target: s.element("input", s.field) });
  assert.equal(s.popup(), undefined);
  assert.deepEqual(s.copied, []);
});

test("dispose and rerender clear popups and listeners, then attach exactly one handler", () => {
  const s = setup();
  const dispose = s.installInfoCopy(s.root);
  assert.equal(s.root.getAttribute("tabindex"), "0");
  s.root.emit("contextmenu", { target: s.field });
  const command = s.popup().children[0];
  dispose();
  dispose();
  assert.equal(s.root.getAttribute("tabindex"), null);
  assert.equal(s.root.listenerCount(), 0);
  assert.equal(s.popup(), undefined);
  command.emit("command");
  s.select();
  s.root.emit("keydown", { metaKey: true });
  assert.deepEqual(s.copied, []);
  const nextDispose = s.installInfoCopy(s.root);
  s.root.emit("keydown", { ctrlKey: true });
  assert.deepEqual(s.copied, ["selected text"]);
  nextDispose();
});

test("dispose preserves existing tabindex and subsequent host changes", () => {
  for (const tabindex of ["-1", "2"]) {
    const s = setup({ tabindex });
    const dispose = s.installInfoCopy(s.root);
    assert.equal(s.root.getAttribute("tabindex"), tabindex);
    dispose();
    assert.equal(s.root.getAttribute("tabindex"), tabindex);
  }
  const s = setup();
  const dispose = s.installInfoCopy(s.root);
  s.root.setAttribute("tabindex", "5");
  dispose();
  assert.equal(s.root.getAttribute("tabindex"), "5");
});

test("unavailable or failing clipboard leaves shortcuts native and permits retry", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  s.select();
  const working = s.internal.copyTextToClipboard;
  for (const unavailable of [
    undefined,
    () => {
      throw new Error("clipboard busy");
    },
  ]) {
    s.internal.copyTextToClipboard = unavailable;
    const event = s.root.emit("keydown", { metaKey: true });
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
    s.root.emit("contextmenu", { target: s.field });
    s.popup().children[0].emit("command");
    assert.equal(s.popup(), undefined);
  }
  assert.deepEqual(s.copied, []);
  s.internal.copyTextToClipboard = working;
  assert.equal(
    s.root.emit("keydown", { metaKey: true }).defaultPrevented,
    true,
  );
  assert.deepEqual(s.copied, ["selected text"]);
});

test("detached panes and popup failures cannot execute stale copy commands", () => {
  const s = setup();
  s.installInfoCopy(s.root);
  s.root.emit("contextmenu", { target: s.field });
  const command = s.popup().children[0];
  s.root.remove();
  command.emit("command");
  assert.deepEqual(s.copied, []);
  assert.equal(s.popup(), undefined);
  s.doc.documentElement.appendChild(s.root);
  const createXULElement = s.doc.createXULElement;
  s.doc.createXULElement = (tag) => {
    const node = createXULElement(tag);
    if (tag === "menupopup")
      node.openPopupAtScreen = () => {
        throw new Error("window closed");
      };
    return node;
  };
  const event = s.root.emit("contextmenu", { target: s.field });
  assert.equal(event.defaultPrevented, false);
  assert.equal(s.popup(), undefined);
  assert.deepEqual(s.copied, []);
});
