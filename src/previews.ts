export function renderPreview(
  target: HTMLElement,
  preview: string | undefined,
  format: "html" | "markdown" | "none",
  label: string,
) {
  target.replaceChildren();
  if (preview === undefined) {
    target.textContent = "No preview was supplied by Claude for this option.";
    return;
  }
  const purify = (window as any).DOMPurify;
  if (format === "html") {
    const fragment = purify.sanitize(preview, {
      ALLOWED_TAGS: [
        "div",
        "span",
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "strong",
        "b",
        "em",
        "i",
        "ul",
        "ol",
        "li",
        "br",
        "hr",
        "pre",
        "code",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
      ],
      ALLOWED_ATTR: ["style", "class"],
      ALLOW_DATA_ATTR: false,
    });
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "");
    frame.referrerPolicy = "no-referrer";
    frame.title = "Claude-generated preview: " + label;
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:20px/1.4 Arial;margin:12px;color:#102544;background:#fff;overflow-wrap:anywhere}body *{font-size:20px!important}h1,h2,h3,strong{font-size:24px!important}pre{white-space:pre-wrap}</style></head><body>${fragment}</body></html>`;
    target.append(frame);
  } else if (format === "markdown") {
    target.innerHTML = purify.sanitize((window as any).marked.parse(preview), {
      FORBID_TAGS: ["img", "iframe", "form", "input", "style", "script"],
      FORBID_ATTR: ["style"],
    });
  } else target.textContent = preview;
}
