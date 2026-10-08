import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const source = await readFile(path.join(root, "src/components/home/Gallery.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function descendants(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...descendants(node.props?.children, predicate)];
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return textContent(node.props?.children);
}

// Mount the actual component's hooks and handlers with deterministic browser time.
// No network, image decoding, external UI library or production-only export is used.
function createGallery({ reducedMotion = false, hidden = false, observerAvailable = true, serverRender = false } = {}) {
  const hooks = [];
  const domByRef = new Map();
  const timers = new Map();
  const documentListeners = new Map();
  const motionListeners = new Set();
  const observers = [];
  const resizeObservers = [];
  const scrolls = [];
  let nodeElements = new Map();
  let tree;
  let Component;
  let cursor = 0;
  let dirty = true;
  let pendingEffects = [];
  let clock = 0;
  let timerId = 0;
  let mounted = true;

  const media = {
    matches: reducedMotion,
    addEventListener(name, callback) {
      assert.equal(name, "change");
      motionListeners.add(callback);
    },
    removeEventListener(name, callback) {
      assert.equal(name, "change");
      motionListeners.delete(callback);
    },
  };
  const document = {
    hidden,
    visibilityState: hidden ? "hidden" : "visible",
    addEventListener(name, callback) {
      if (!documentListeners.has(name)) documentListeners.set(name, new Set());
      documentListeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { documentListeners.get(name)?.delete(callback); },
  };
  const sameDeps = (before, after) => before && after && before.length === after.length
    && before.every((value, index) => Object.is(value, after[index]));
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, (next) => {
        const value = typeof next === "function" ? next(hooks[index].value) : next;
        if (!Object.is(value, hooks[index].value)) {
          hooks[index].value = value;
          dirty = true;
        }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: { current: initial } };
      return hooks[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (serverRender) return;
      const previous = hooks[index];
      if (!sameDeps(previous?.deps, deps)) {
        hooks[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => {
          hooks[index].cleanup?.();
          hooks[index].cleanup = effect();
        });
      }
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps)) hooks[index] = { deps, value: factory() };
      return hooks[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps)) hooks[index] = { deps, value: callback };
      return hooks[index].value;
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      const index = cursor++;
      if (serverRender) return getServerSnapshot();
      if (!hooks[index]) {
        hooks[index] = { value: getSnapshot() };
        hooks[index].cleanup = subscribe(() => {
          const value = getSnapshot();
          if (!Object.is(hooks[index].value, value)) {
            hooks[index].value = value;
            dirty = true;
          }
        });
      }
      return hooks[index].value;
    },
  };
  class Element {
    constructor(node, index = 0) {
      this.node = node;
      this.index = index;
      this.clientWidth = 800;
      this.offsetWidth = 800;
      this.offsetLeft = index * 800;
      this.scrollLeft = 0;
      this.children = [];
    }
    contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
    scrollTo(options) {
      this.scrollLeft = options.left ?? this.scrollLeft;
      scrolls.push({ ...options });
    }
    getBoundingClientRect() { return { left: this.offsetLeft, width: 800 }; }
    querySelectorAll() { return this.children; }
    getAttribute(name) { return this.node.props?.[name] ?? null; }
  }
  function attachRefs(node, parent, index = 0) {
    if (Array.isArray(node)) return node.forEach((child, childIndex) => attachRefs(child, parent, childIndex));
    if (!node || typeof node !== "object") return;
    const ref = node.props?.ref;
    let element;
    if (ref && typeof ref === "object") {
      if (!domByRef.has(ref)) domByRef.set(ref, new Element(node, index));
      element = domByRef.get(ref);
      element.node = node;
      ref.current = element;
    } else {
      element = new Element(node, index);
      if (typeof ref === "function") ref(element);
    }
    element.children = [];
    nodeElements.set(node, element);
    if (parent) parent.children.push(element);
    attachRefs(node.props?.children, element);
  }
  function flush() {
    for (let passes = 0; dirty; passes += 1) {
      assert.ok(passes < 30, "component state must settle");
      dirty = false;
      cursor = 0;
      pendingEffects = [];
      tree = Component();
      nodeElements = new Map();
      attachRefs(tree);
      for (const effect of pendingEffects) effect();
    }
  }
  function schedule(callback, delay, interval = false) {
    const id = ++timerId;
    timers.set(id, { callback, delay, at: clock + delay, interval });
    return id;
  }
  const setTimeout = (callback, delay = 0) => schedule(callback, delay);
  const setInterval = (callback, delay) => schedule(callback, delay, true);
  const clearTimer = (id) => timers.delete(id);
  class IntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) { this.targets.add(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  }
  class ResizeObserver extends IntersectionObserver {
    constructor(callback) {
      super(callback);
      observers.pop();
      resizeObservers.push(this);
    }
  }
  const window = {
    matchMedia(query) {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return media;
    },
    setTimeout,
    clearTimeout: clearTimer,
    setInterval,
    clearInterval: clearTimer,
    requestAnimationFrame: (callback) => schedule(callback, 16),
    cancelAnimationFrame: clearTimer,
    ResizeObserver,
    ...(observerAvailable ? { IntersectionObserver } : {}),
  };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "next/image") return { default: "Image" };
      if (name === "lucide-react") return new Proxy({}, { get: (_target, icon) => `icon:${String(icon)}` });
      throw new Error(`Gallery must not add a runtime dependency: ${name}`);
    },
    window,
    document,
    HTMLElement: Element,
    ResizeObserver,
    ...(observerAvailable ? { IntersectionObserver } : {}),
    setTimeout,
    clearTimeout: clearTimer,
    setInterval,
    clearInterval: clearTimer,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: clearTimer,
  });
  Component = exports.default;
  flush();

  return {
    get tree() { return tree; },
    scrolls,
    active() {
      const buttons = descendants(tree, (node) => node.type === "button" && /^Show photo /u.test(node.props["aria-label"]));
      assert.equal(buttons.length, 4);
      assert.equal(buttons.filter((button) => button.props["aria-current"] === "true").length, 1);
      return buttons.findIndex((button) => button.props["aria-current"] === "true");
    },
    element(predicate) {
      const node = descendants(tree, predicate)[0];
      assert.ok(node, "requested gallery element must exist");
      return nodeElements.get(node);
    },
    get rotationTimers() { return [...timers.values()].filter(({ delay }) => delay === 6000); },
    button(label) {
      const button = descendants(tree, (node) => node.type === "button")
        .find((node) => label.test(node.props["aria-label"] ?? textContent(node)));
      assert.ok(button, `gallery needs a ${label} button`);
      return button;
    },
    click(label) { this.button(label).props.onClick(); flush(); },
    event(name, event = {}) {
      const target = descendants(tree, (node) => typeof node.props?.[name] === "function")[0];
      assert.ok(target, `gallery needs ${name}`);
      const currentTarget = nodeElements.get(target);
      target.props[name]({ currentTarget, ...event });
      flush();
    },
    advance(milliseconds) {
      const finish = clock + milliseconds;
      for (let steps = 0; steps < 100; steps += 1) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= finish)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { clock = finish; return; }
        const [id, timer] = next;
        clock = timer.at;
        if (timer.interval) timer.at += timer.delay;
        else timers.delete(id);
        timer.callback(clock);
        flush();
      }
      assert.fail("gallery scheduled too many callbacks");
    },
    intersect(inView, intersectionRatio = inView ? 1 : 0) {
      for (const observer of observers) {
        if (observer.disconnected) continue;
        observer.callback([...observer.targets].map((target) => ({ target, isIntersecting: inView, intersectionRatio })));
      }
      flush();
    },
    visibility(isHidden) {
      document.hidden = isHidden;
      document.visibilityState = isHidden ? "hidden" : "visible";
      for (const callback of documentListeners.get("visibilitychange") ?? []) callback();
      flush();
    },
    motion(matches) {
      media.matches = matches;
      for (const callback of motionListeners) callback({ matches });
      flush();
    },
    swipe(index) {
      this.event("onPointerDown");
      this.element((node) => node.props?.id === "patient-gallery-track").scrollLeft = index * 800;
      this.event("onScroll");
    },
    resize(width) {
      const track = this.element((node) => node.props?.id === "patient-gallery-track");
      track.clientWidth = width;
      for (const observer of resizeObservers) {
        if (!observer.disconnected) observer.callback([...observer.targets].map((target) => ({ target })));
      }
      flush();
    },
    liveText() {
      return descendants(tree, (node) => node.props?.["aria-live"] === "polite").map(textContent).join(" ");
    },
    unmount() {
      assert.equal(mounted, true);
      mounted = false;
      for (const hook of hooks) hook?.cleanup?.();
      assert.equal(timers.size, 0, "all timers and frames must be cancelled");
      assert.equal(motionListeners.size, 0, "reduced-motion listener must be removed");
      for (const callbacks of documentListeners.values()) assert.equal(callbacks.size, 0, "document listeners must be removed");
      assert.ok(observers.every((observer) => observer.disconnected), "visibility observers must disconnect");
      assert.ok(resizeObservers.every((observer) => observer.disconnected), "resize observers must disconnect");
    },
  };
}

test("gallery is a native four-photo carousel with lazy, privacy-safe imagery", () => {
  const gallery = createGallery();
  const sections = descendants(gallery.tree, (node) => node.type === "section");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].props.id, "moments-of-care");
  const carousels = descendants(gallery.tree, (node) => node.props?.["aria-roledescription"] === "carousel");
  assert.equal(carousels.length, 1);
  assert.equal(carousels[0].props.role, "region");
  assert.equal(carousels[0].props["aria-label"], "Moments of care photo gallery");
  const images = descendants(gallery.tree, (node) => node.type === "Image");
  assert.deepEqual(images.map((image) => image.props.src).sort(), [
    "/images/gallery-newborn-care-v1.webp",
    "/images/gallery-family-care-private-v1.webp",
    "/images/dr-shafi-ahamad.jpg",
    "/images/dr-shaik-reshma.jpg",
  ].sort());
  for (const image of images) {
    assert.equal(image.props.loading, "lazy");
    assert.ok(image.props.sizes);
    assert.ok(image.props.alt?.trim());
    assert.equal(image.props.preload, undefined);
    assert.equal(image.props.priority, undefined);
  }
  const slides = descendants(gallery.tree, (node) => node.props?.["aria-roledescription"] === "slide");
  assert.equal(slides.length, 4);
  for (const [index, slide] of slides.entries()) {
    assert.equal(slide.props.role, "group");
    assert.match(slide.props["aria-label"], new RegExp(`^${index + 1} of 4: `, "u"));
  }
  const track = gallery.element((node) => node.props?.id === "patient-gallery-track");
  assert.equal(track.node.props.tabIndex, 0, "native scrolling needs a keyboard focus target");
  assert.doesNotMatch(source, /framer-motion|embla|swiper|localStorage|sessionStorage|fetch\(|sendBeacon|gtag|dataLayer|autoPlay/u);
  for (const button of descendants(gallery.tree, (node) => node.type === "button")) {
    assert.equal(button.props.type, "button");
    assert.ok(button.props["aria-label"] || textContent(button).trim());
    assert.equal(button.props["aria-controls"], "patient-gallery-track");
  }
  gallery.unmount();
});

test("server-rendered gallery exposes all photos with rotation safely paused", () => {
  const gallery = createGallery({ serverRender: true });
  assert.equal(descendants(gallery.tree, (node) => node.type === "Image").length, 4);
  assert.equal(gallery.active(), 0);
  assert.equal(gallery.button(/^Slideshow paused for reduced motion$/u).props.disabled, true);
  assert.equal(gallery.rotationTimers.length, 0);
  assert.equal(gallery.liveText(), "");
  gallery.unmount();
});

test("automatic rotation waits for visibility, advances every six seconds and wraps silently", () => {
  const gallery = createGallery();
  assert.equal(gallery.rotationTimers.length, 0, "below-fold photos must not rotate before being seen");
  gallery.advance(12_000);
  assert.equal(gallery.active(), 0);
  assert.equal(gallery.scrolls.length, 0);
  gallery.intersect(true);
  assert.equal(gallery.rotationTimers.length, 1);
  gallery.advance(5_999);
  assert.equal(gallery.active(), 0);
  gallery.advance(1);
  assert.equal(gallery.active(), 1);
  assert.equal(gallery.scrolls.at(-1).left, 800);
  assert.equal(gallery.scrolls.at(-1).behavior, "smooth");
  assert.equal(gallery.liveText(), "", "automatic movement must not interrupt a screen reader");
  for (const expected of [2, 3, 0]) {
    gallery.advance(6_000);
    assert.equal(gallery.active(), expected);
    assert.equal(gallery.scrolls.at(-1).left, expected * 800);
    assert.equal(gallery.liveText(), "");
    assert.equal(gallery.rotationTimers.length, 1, "rerenders must not accumulate rotation timers");
  }
  gallery.unmount();
});

test("rotation starts only when at least one fifth of the gallery is visible", () => {
  const gallery = createGallery();
  gallery.intersect(true, 0.19);
  assert.equal(gallery.rotationTimers.length, 0, "a barely visible gallery must remain still");
  gallery.advance(12_000);
  assert.equal(gallery.active(), 0);
  gallery.intersect(true, 0.2);
  assert.equal(gallery.rotationTimers.length, 1);
  gallery.advance(6_000);
  assert.equal(gallery.active(), 1);
  gallery.intersect(true, 0.19);
  assert.equal(gallery.rotationTimers.length, 0, "partially scrolling away must pause again");
  gallery.advance(12_000);
  assert.equal(gallery.active(), 1);
  gallery.unmount();
});

test("arrows and photo selectors wrap, announce manual choices and retain the user's pause", () => {
  const gallery = createGallery();
  gallery.intersect(true);
  gallery.click(/^Previous photo$/u);
  assert.equal(gallery.active(), 3);
  assert.match(gallery.liveText(), /^Photo 4 of 4: Dr\. Shaik Reshma$/u);
  assert.equal(gallery.rotationTimers.length, 0);
  gallery.event("onMouseEnter");
  gallery.event("onMouseLeave");
  gallery.event("onFocusCapture");
  gallery.event("onBlurCapture", { relatedTarget: null });
  gallery.intersect(false);
  gallery.intersect(true);
  gallery.visibility(true);
  gallery.visibility(false);
  gallery.advance(18_000);
  assert.equal(gallery.active(), 3, "temporary pause reasons must never clear the user's choice");
  gallery.click(/^Next photo$/u);
  assert.equal(gallery.active(), 0);
  assert.match(gallery.liveText(), /^Photo 1 of 4: Little beginnings$/u);
  gallery.click(/^Show photo 3:/u);
  assert.equal(gallery.active(), 2);
  assert.match(gallery.liveText(), /^Photo 3 of 4: Dr\. Lt Col Shafi Ahamad$/u);
  const manualMessage = gallery.liveText();
  gallery.click(/^Play slideshow$/u);
  gallery.advance(6_000);
  assert.equal(gallery.active(), 3);
  assert.equal(gallery.liveText(), manualMessage, "automatic changes must not update manual announcements");
  gallery.unmount();
});

test("hover, keyboard focus, offscreen and hidden-page gates independently stop rotation", () => {
  const gallery = createGallery();
  gallery.intersect(true);
  gallery.event("onMouseEnter");
  assert.equal(gallery.rotationTimers.length, 0);
  gallery.event("onFocusCapture");
  gallery.event("onMouseLeave");
  assert.equal(gallery.rotationTimers.length, 0, "leaving hover cannot override focused controls");
  const internalButton = gallery.element((node) => node.type === "button");
  gallery.event("onBlurCapture", { relatedTarget: internalButton });
  assert.equal(gallery.rotationTimers.length, 0, "focus moving within the gallery keeps it paused");
  gallery.event("onBlurCapture", { relatedTarget: null });
  assert.equal(gallery.rotationTimers.length, 1);
  for (const [pause, resume] of [
    [() => gallery.intersect(false), () => gallery.intersect(true)],
    [() => gallery.visibility(true), () => gallery.visibility(false)],
    [() => gallery.event("onMouseEnter"), () => gallery.event("onMouseLeave")],
  ]) {
    const before = gallery.active();
    pause();
    assert.equal(gallery.rotationTimers.length, 0);
    gallery.advance(12_000);
    assert.equal(gallery.active(), before);
    resume();
    assert.equal(gallery.rotationTimers.length, 1);
    gallery.advance(5_999);
    assert.equal(gallery.active(), before, "resuming grants a full six seconds to read the photo");
    gallery.advance(1);
    assert.equal(gallery.active(), (before + 1) % 4);
  }
  gallery.unmount();
});

test("explicit pause survives mouseleave and browser-environment changes until Play", () => {
  const gallery = createGallery();
  gallery.intersect(true);
  gallery.click(/^Pause slideshow$/u);
  gallery.event("onMouseEnter");
  gallery.event("onMouseLeave");
  gallery.visibility(true);
  gallery.visibility(false);
  gallery.motion(true);
  gallery.motion(false);
  gallery.intersect(false);
  gallery.intersect(true);
  assert.equal(gallery.rotationTimers.length, 0);
  gallery.advance(24_000);
  assert.equal(gallery.active(), 0);
  gallery.click(/^Play slideshow$/u);
  gallery.advance(6_000);
  assert.equal(gallery.active(), 1);
  gallery.unmount();
});

test("reduced motion is checked initially and dynamically while manual browsing stays available", () => {
  const gallery = createGallery({ reducedMotion: true });
  gallery.intersect(true);
  assert.equal(gallery.rotationTimers.length, 0);
  assert.equal(gallery.button(/^Slideshow paused for reduced motion$/u).props.disabled, true);
  gallery.advance(12_000);
  assert.equal(gallery.active(), 0);
  gallery.click(/^Next photo$/u);
  assert.equal(gallery.active(), 1);
  assert.equal(gallery.scrolls.at(-1).behavior, "instant");
  assert.match(gallery.liveText(), /^Photo 2 of 4:/u);
  gallery.motion(false);
  assert.equal(gallery.rotationTimers.length, 0, "removing reduced motion cannot override manual pause");
  gallery.click(/^Play slideshow$/u);
  assert.equal(gallery.rotationTimers.length, 1);
  gallery.advance(6_000);
  assert.equal(gallery.active(), 2);
  gallery.motion(true);
  assert.equal(gallery.rotationTimers.length, 0);
  gallery.advance(12_000);
  assert.equal(gallery.active(), 2);
  gallery.motion(false);
  gallery.advance(6_000);
  assert.equal(gallery.active(), 3);
  gallery.unmount();
});

test("native swipe and keyboard browsing synchronize selection and stop automatic movement", () => {
  const gallery = createGallery();
  gallery.intersect(true);
  gallery.swipe(2);
  assert.equal(gallery.active(), 2);
  assert.equal(gallery.rotationTimers.length, 0);
  assert.equal(gallery.liveText(), "", "native scroll events must not cause repeated announcements");
  gallery.advance(12_000);
  assert.equal(gallery.active(), 2);
  let prevented = 0;
  const key = (value) => gallery.event("onKeyDown", { key: value, preventDefault() { prevented += 1; } });
  key("ArrowRight");
  assert.equal(gallery.active(), 3);
  key("ArrowRight");
  assert.equal(gallery.active(), 0);
  key("ArrowLeft");
  assert.equal(gallery.active(), 3);
  assert.equal(prevented, 3);
  key("Tab");
  assert.equal(prevented, 3, "ordinary focus navigation must remain native");
  assert.match(gallery.liveText(), /^Photo 4 of 4:/u);
  gallery.resize(400);
  assert.equal(gallery.scrolls.at(-1).left, 1200, "resizing must keep the selected slide in view");
  assert.equal(gallery.scrolls.at(-1).behavior, "instant");
  gallery.unmount();
});

test("initially hidden documents and unavailable visibility observers fail closed", () => {
  for (const options of [{ hidden: true }, { observerAvailable: false }]) {
    const gallery = createGallery(options);
    gallery.intersect(true);
    assert.equal(gallery.rotationTimers.length, 0);
    gallery.advance(12_000);
    assert.equal(gallery.active(), 0);
    gallery.click(/^Next photo$/u);
    assert.equal(gallery.active(), 1, "manual controls must work without automatic rotation");
    gallery.unmount();
  }
});

test("unmounting while rotation is active cancels timers, observers and listeners", () => {
  const gallery = createGallery();
  gallery.intersect(true);
  assert.equal(gallery.rotationTimers.length, 1);
  gallery.unmount();
  const before = gallery.scrolls.length;
  gallery.advance(24_000);
  assert.equal(gallery.scrolls.length, before, "nothing should run after unmount");
});
