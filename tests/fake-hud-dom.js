// A stand-in DOM for tests that build the glass HUD (src/ui/hud.js createHud)
// under Node: elements that keep their class names, text, attributes, children
// and listeners, and a window and document with just what the HUD reads. Not a
// test (no .test.js): tests/skill-popup-dom.test.js uses it.

export function fakeElement(tag = 'div') {
  const listeners = {};
  const attrs = {};
  const node = {
    tag,
    children: [],
    parent: null,
    hidden: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    id: '',
    className: '',
    attrs,
    listeners,
    offsetWidth: 280,
    offsetHeight: 300,
    style: { props: {}, setProperty(name, value) { this.props[name] = value; }, getPropertyValue(name) { return this.props[name] ?? ''; } },
    append(...kids) {
      for (const kid of kids) {
        kid.parent = node;
        node.children.push(kid);
      }
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return name in attrs ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    contains(other) {
      for (let n = other; n; n = n.parent) if (n === node) return true;
      return false;
    },
    matches: () => true,
    focus() {},
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 100, height: 40, right: 200, bottom: 140, x: 100, y: 100 }),
    // Only used for the markup set through innerHTML, which the fake does not parse.
    querySelector: () => fakeElement('span'),
  };
  const names = () => node.className.split(/\s+/).filter(Boolean);
  node.classList = {
    contains: (name) => names().includes(name),
    add: (...list) => { node.className = [...new Set([...names(), ...list])].join(' '); },
    remove: (...list) => { node.className = names().filter((name) => !list.includes(name)).join(' '); },
    toggle: (name, force) => {
      const on = force ?? !names().includes(name);
      if (on) node.classList.add(name);
      else node.classList.remove(name);
      return on;
    },
  };
  return node;
}

// Every element under (and including) node, depth first.
export function allNodes(node) {
  return [node, ...node.children.flatMap(allNodes)];
}

export function byClass(node, className) {
  return allNodes(node).filter((n) => n.classList.contains(className));
}

// Runs the listeners of `type` on the element (and returns nothing).
export function fire(node, type, event = {}) {
  for (const fn of node.listeners[type] ?? []) fn({ target: node, pointerType: 'mouse', ...event });
}

// Installs window and document for the HUD; returns { window, restore }.
// The listeners the HUD adds to window are kept by type.
export function installFakeWindow({ width = 1920, height = 1080 } = {}) {
  const listeners = {};
  const fakeWindow = {
    innerWidth: width,
    innerHeight: height,
    listeners,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    matchMedia: () => ({ matches: false }),
  };
  const fakeDocument = {
    activeElement: null,
    createElement: fakeElement,
    createElementNS: (_ns, tag) => fakeElement(tag),
  };
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  return {
    window: fakeWindow,
    // Runs a window listener (the HUD's keydown and capturing pointerdown).
    fireWindow(type, event = {}) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
    restore() {
      globalThis.window = saved.window;
      globalThis.document = saved.document;
      if (saved.window === undefined) delete globalThis.window;
      if (saved.document === undefined) delete globalThis.document;
    },
  };
}
