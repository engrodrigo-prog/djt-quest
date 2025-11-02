import DOMPurify from "dompurify";

/**
 * Sanitiza HTML antes de injetar no DOM.
 * Garante que links abram em nova aba com rel seguro.
 */
export function sanitizeHtml(html: string) {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });

  if (typeof window === "undefined") {
    return sanitized;
  }

  const temp = document.createElement("div");
  temp.innerHTML = sanitized;

  temp.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });

  return temp.innerHTML;
}
