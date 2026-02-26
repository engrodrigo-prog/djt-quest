type PerfDebugOptions = {
  enabled?: boolean;
  messageThresholdMs?: number;
  layoutThresholdMs?: number;
};

declare global {
  interface Window {
    __PERF_DEBUG_INSTALLED__?: boolean;
  }
}

function isPerfDebugEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("perf") === "1") return true;
    if (params.get("perfDebug") === "1") return true;
  } catch {
    // ignore
  }

  try {
    return window.localStorage?.getItem("perfDebug") === "1";
  } catch {
    return false;
  }
}

function safePreviewData(data: unknown): string {
  if (typeof data === "string") return `string(${data.length})`;
  if (data === null) return "null";
  if (data === undefined) return "undefined";
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (typeof data === "object") {
    try {
      const keys = Object.keys(data as Record<string, unknown>);
      return `object(keys:${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""})`;
    } catch {
      return "object(?)";
    }
  }
  return typeof data;
}

export function installPerfDebug(options: PerfDebugOptions = {}): void {
  const enabled = isPerfDebugEnabled(options.enabled);
  if (!enabled) return;
  if (typeof window === "undefined") return;
  if (window.__PERF_DEBUG_INSTALLED__) return;
  window.__PERF_DEBUG_INSTALLED__ = true;

  const messageThresholdMs = options.messageThresholdMs ?? 50;
  const layoutThresholdMs = options.layoutThresholdMs ?? 16;

  const logSlow = (label: string, details: Record<string, unknown>) => {
    console.groupCollapsed(`[perf] ${label}`);
    console.table(details);
    console.groupEnd();
  };

  const installLongTaskObserver = () => {
    if (!("PerformanceObserver" in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          const duration = Number(entry.duration ?? 0);
          if (!Number.isFinite(duration) || duration < messageThresholdMs) continue;
          logSlow("longtask", {
            durationMs: Math.round(duration),
            name: entry.name,
            startTimeMs: Math.round(Number(entry.startTime ?? 0)),
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] as any });
    } catch {
      // ignore
    }
  };

  const installLayoutReadProbes = () => {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

    const wrapProtoGetter = (
      proto: any,
      propName: string,
      label: string,
      thresholdMs: number
    ) => {
      const desc = Object.getOwnPropertyDescriptor(proto, propName);
      if (!desc?.get || !desc.configurable) return;
      if ((desc.get as any).__perfWrapped) return;

      const originalGet = desc.get;
      const wrappedGet = function (this: unknown) {
        const t0 = now();
        const result = originalGet.call(this);
        const dt = now() - t0;
        if (dt >= thresholdMs) {
          logSlow(label, {
            durationMs: Math.round(dt),
            prop: propName,
            stack: new Error().stack,
          });
        }
        return result;
      };
      (wrappedGet as any).__perfWrapped = true;

      try {
        Object.defineProperty(proto, propName, {
          configurable: true,
          enumerable: desc.enumerable,
          get: wrappedGet,
          set: desc.set,
        });
      } catch {
        // ignore
      }
    };

    const wrapProtoMethod = (
      proto: any,
      methodName: string,
      label: string,
      thresholdMs: number
    ) => {
      const original = proto?.[methodName];
      if (typeof original !== "function") return;
      if ((original as any).__perfWrapped) return;

      const wrapped = function (this: unknown, ...args: unknown[]) {
        const t0 = now();
        const result = original.apply(this, args);
        const dt = now() - t0;
        if (dt >= thresholdMs) {
          logSlow(label, {
            durationMs: Math.round(dt),
            method: methodName,
            stack: new Error().stack,
          });
        }
        return result;
      };
      (wrapped as any).__perfWrapped = true;

      try {
        proto[methodName] = wrapped;
      } catch {
        // ignore
      }
    };

    wrapProtoMethod(Element?.prototype, "getBoundingClientRect", "layout-read", layoutThresholdMs);
    wrapProtoMethod(Element?.prototype, "getClientRects", "layout-read", layoutThresholdMs);
    wrapProtoMethod(window as any, "getComputedStyle", "style-read", layoutThresholdMs);

    // These getters are common sources of forced reflow when read after DOM writes.
    for (const proto of [Element?.prototype, HTMLElement?.prototype]) {
      if (!proto) continue;
      wrapProtoGetter(proto, "scrollHeight", "layout-getter", layoutThresholdMs);
      wrapProtoGetter(proto, "scrollWidth", "layout-getter", layoutThresholdMs);
      wrapProtoGetter(proto, "clientHeight", "layout-getter", layoutThresholdMs);
      wrapProtoGetter(proto, "clientWidth", "layout-getter", layoutThresholdMs);
      wrapProtoGetter(proto, "offsetHeight", "layout-getter", layoutThresholdMs);
      wrapProtoGetter(proto, "offsetWidth", "layout-getter", layoutThresholdMs);
    }
  };

  const installMessageHandlerProbes = () => {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;

    type ListenerKey = string; // `${type}|${capture}`
    type WrappedListener = EventListenerOrEventListenerObject;

    const perTarget = new WeakMap<EventTarget, WeakMap<object, Map<ListenerKey, WrappedListener>>>();

    const getCapture = (options?: boolean | AddEventListenerOptions): boolean => {
      if (typeof options === "boolean") return options;
      return Boolean(options?.capture);
    };

    const getWrapped = (
      target: EventTarget,
      listener: EventListenerOrEventListenerObject,
      type: string,
      capture: boolean
    ): WrappedListener | undefined => {
      const byListener = perTarget.get(target);
      if (!byListener) return undefined;
      const byKey = byListener.get(listener as any);
      if (!byKey) return undefined;
      return byKey.get(`${type}|${capture}`);
    };

    const setWrapped = (
      target: EventTarget,
      listener: EventListenerOrEventListenerObject,
      type: string,
      capture: boolean,
      wrapped: WrappedListener
    ) => {
      let byListener = perTarget.get(target);
      if (!byListener) {
        byListener = new WeakMap();
        perTarget.set(target, byListener);
      }
      let byKey = byListener.get(listener as any);
      if (!byKey) {
        byKey = new Map();
        byListener.set(listener as any, byKey);
      }
      byKey.set(`${type}|${capture}`, wrapped);
    };

    const wrapListener = (
      original: EventListenerOrEventListenerObject,
      registrationStack: string
    ): WrappedListener => {
      if (typeof original === "function") {
        const fn = original;
        const wrappedFn: EventListener = function (this: unknown, event: Event) {
          const t0 = now();
          try {
            return fn.call(this, event);
          } finally {
            const dt = now() - t0;
            if (dt >= messageThresholdMs) {
              const messageEvent = event as MessageEvent;
              logSlow("message handler", {
                durationMs: Math.round(dt),
                origin: (messageEvent as any).origin,
                data: safePreviewData((messageEvent as any).data),
                registrationStack,
              });
            }
          }
        };
        return wrappedFn;
      }

      const obj = original;
      const wrappedObj: EventListenerObject = {
        handleEvent(event: Event) {
          const t0 = now();
          try {
            obj.handleEvent(event);
          } finally {
            const dt = now() - t0;
            if (dt >= messageThresholdMs) {
              const messageEvent = event as MessageEvent;
              logSlow("message handler", {
                durationMs: Math.round(dt),
                origin: (messageEvent as any).origin,
                data: safePreviewData((messageEvent as any).data),
                registrationStack,
              });
            }
          }
        },
      };
      return wrappedObj;
    };

    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      if (type !== "message" || !listener) {
        return originalAdd.call(this, type, listener as any, options as any);
      }

      const capture = getCapture(options);
      const existing = getWrapped(this, listener, type, capture);
      if (existing) {
        return originalAdd.call(this, type, existing as any, options as any);
      }

      const registrationStack = new Error().stack ?? "(no stack)";
      const wrapped = wrapListener(listener, registrationStack);
      setWrapped(this, listener, type, capture, wrapped);
      return originalAdd.call(this, type, wrapped as any, options as any);
    };

    EventTarget.prototype.removeEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions
    ) {
      if (type !== "message" || !listener) {
        return originalRemove.call(this, type, listener as any, options as any);
      }

      const capture = getCapture(options as any);
      const wrapped = getWrapped(this, listener, type, capture);
      return originalRemove.call(this, type, (wrapped ?? listener) as any, options as any);
    };

    try {
      const winProto = (window as any).Window?.prototype ?? Window.prototype;
      const desc = Object.getOwnPropertyDescriptor(winProto, "onmessage");
      if (desc?.configurable && typeof desc.set === "function" && typeof desc.get === "function") {
        const onmessageWrap = new WeakMap<Function, Function>();
        Object.defineProperty(winProto, "onmessage", {
          configurable: true,
          enumerable: desc.enumerable,
          get() {
            return desc.get!.call(this);
          },
          set(value: unknown) {
            if (typeof value !== "function") return desc.set!.call(this, value);
            const existing = onmessageWrap.get(value);
            if (existing) return desc.set!.call(this, existing);
            const registrationStack = "window.onmessage assignment";
            const wrapped = wrapListener(value, registrationStack) as any;
            onmessageWrap.set(value, wrapped);
            return desc.set!.call(this, wrapped);
          },
        });
      }
    } catch {
      // ignore
    }
  };

  console.info(
    "[perf] instrumentation enabled (use ?perf=1 or localStorage.perfDebug=1 to toggle)"
  );

  installLongTaskObserver();
  installLayoutReadProbes();
  installMessageHandlerProbes();
}
