import { useEffect } from "react";

function isEditableElement(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || "text").toLowerCase();
    const nonTextTypes = new Set([
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "range",
      "color",
      "file",
      "image",
      "hidden",
    ]);
    return !nonTextTypes.has(type);
  }
  return false;
}

function computeKeyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const inset = window.innerHeight - vv.height - vv.offsetTop;
  return Math.max(0, Math.round(inset));
}

export function MobileKeyboardManager() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const updateInset = () => {
      const inset = computeKeyboardInset();
      root.style.setProperty("--djt-keyboard-inset", `${inset}px`);
    };

    updateInset();

    vv?.addEventListener("resize", updateInset);
    vv?.addEventListener("scroll", updateInset);
    window.addEventListener("resize", updateInset);
    window.addEventListener("orientationchange", updateInset);

    const onFocusIn = (ev: FocusEvent) => {
      const target = ev.target;
      if (!isEditableElement(target)) return;

      const inset = Number.parseInt(getComputedStyle(root).getPropertyValue("--djt-keyboard-inset") || "0", 10) || 0;
      if (inset <= 0) return;

      window.setTimeout(() => {
        try {
          (target as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          // ignore
        }
      }, 60);
    };

    document.addEventListener("focusin", onFocusIn);

    return () => {
      vv?.removeEventListener("resize", updateInset);
      vv?.removeEventListener("scroll", updateInset);
      window.removeEventListener("resize", updateInset);
      window.removeEventListener("orientationchange", updateInset);
      document.removeEventListener("focusin", onFocusIn);
      root.style.removeProperty("--djt-keyboard-inset");
    };
  }, []);

  return null;
}

