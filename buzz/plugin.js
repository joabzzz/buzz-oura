// Oura wordmark from https://ouraring.com/ (navigation logo).
const wordmarkPaths = [
  "M63.443 27.388H190.38V0H63.443zM643.464 174.105H554.68V83.082h88.783c31.634 0 52.89 18.292 52.89 45.513 0 27.221-21.256 45.51-52.89 45.51m29.409 21.29c30.456-8.686 50.136-34.907 50.136-66.8 0-41.397-31.967-69.212-79.547-69.212H528.035v244.66h26.646V198.174h90.3l57.501 105.867h28.83l-59.946-108.218zM389.668 308.653c65.348 0 110.987-45.903 110.987-111.63V59.384h-27.387v135.793c0 50.688-34.377 86.09-83.6 86.09-40.798 0-84.709-26.94-84.709-86.09V59.384h-27.382v137.64c0 65.726 46.093 111.628 112.093 111.628m478.192-217.35 57.757 126.333H809.735zm-12.848-31.916L743.16 304.044h28.606l27.662-62.713h136.493l27.67 62.713h28.603L880.342 59.383zm-728.077-4.611C56.944 54.775 0 111.719 0 181.712c0 69.996 56.944 126.94 126.937 126.94 69.996 0 126.94-56.944 126.94-126.94 0-69.993-56.944-126.937-126.94-126.937m0 226.49c-54.893 0-99.553-44.66-99.553-99.553 0-54.892 44.661-99.55 99.554-99.55 54.894 0 99.556 44.658 99.556 99.55 0 54.893-44.662 99.553-99.556 99.553",
];
const defaultPaths = {
  signIn: "/account",
  status: "/account/status",
};

const routes = [
  ["signIn", "Oura sign-in URL"],
  ["status", "Connection test URL"],
];

function workerOrigin(value) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) throw new Error();
  return url.origin;
}

function workerEndpoint(value, origin, defaultPath) {
  const url = new URL(value.trim() || defaultPath, origin);
  if (url.origin !== origin || url.username || url.password || url.hash)
    throw new Error();
  return url.href.replace(/[<>]/g, (character) => encodeURIComponent(character));
}

export const inject = ["react", "settingsCards", "conversation"];

export function apply(ctx) {
  const { createElement: h, useState } = ctx.react;
  const Button = ctx.reflect?.get("ui")?.Button ?? "button";
  const Markdown = ctx.conversation.ui.Markdown;
  const storageKey = "y13.oura.settings";
  const legacyKey = "y13.oura.backend-origin";
  const stack = { display: "grid", gap: "var(--space-2)" };
  const row = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "var(--space-2)",
  };

  function load() {
    try {
      const settings = JSON.parse(localStorage.getItem(storageKey) || "null");
      const origin = workerOrigin(settings?.origin || localStorage.getItem(legacyKey) || "");
      return {
        origin,
        signIn: workerEndpoint(settings?.signIn || "", origin, defaultPaths.signIn),
        status: workerEndpoint(settings?.status || "", origin, defaultPaths.status),
      };
    } catch {
      return { origin: "", signIn: "", status: "" };
    }
  }

  function externalAction(label, url, primary) {
    return h("div", {
      className: "oura-external-action",
      "data-primary": primary || undefined,
    }, h(Markdown, {
      content: `[${label}](<${url}>)`,
      scale: "document",
    }));
  }

  ctx.settingsCards.register({
    id: "oura",
    title: "Oura",
    group: "Integrations",
    component: function Oura({ active }) {
      const [settings, setSettings] = useState(load);
      const [draft, setDraft] = useState(settings);
      const [editing, setEditing] = useState(!settings.origin);
      const [error, setError] = useState("");
      const isActive = active();

      function save(event) {
        event.preventDefault();
        if (!active()) return;
        let origin;
        try {
          origin = workerOrigin(draft.origin);
        } catch {
          setError("Enter an HTTPS Worker origin, such as https://oura.example.com.");
          return;
        }

        const next = { origin };
        for (const [key, label] of routes) {
          try {
            next[key] = workerEndpoint(draft[key], origin, defaultPaths[key]);
          } catch {
            setError(`${label} must point to the Worker URL above.`);
            return;
          }
        }
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          setError("Buzz could not save these settings on this device.");
          return;
        }
        setSettings(next);
        setEditing(false);
        setError("");
      }

      function field(key, label, placeholder) {
        return h("label", { key, style: stack }, label, h("input", {
          type: key === "origin" ? "url" : "text",
          inputMode: "url",
          placeholder,
          value: draft[key],
          required: key === "origin",
          onChange: (event) => {
            const value = event.target.value;
            setDraft((current) => ({ ...current, [key]: value }));
          },
        }));
      }

      function edit() {
        const { origin, signIn, status } = settings;
        setDraft({
          origin,
          signIn: signIn === origin + defaultPaths.signIn ? "" : signIn,
          status: status === origin + defaultPaths.status ? "" : status,
        });
        setEditing(true);
      }

      return h("section", {
        className: "ui-card",
        style: { ...stack, padding: "var(--space-panel-inset)" },
      },
        h("style", null, `
          .oura-external-action p { margin: 0; }
          .oura-external-action a {
            display: inline-block;
            border: 1px solid currentColor;
            border-radius: 0.5rem;
            padding: 0.45rem 0.8rem;
            text-decoration: none;
            font-weight: 600;
          }
          .oura-external-action[data-primary] a {
            background: CanvasText;
            color: Canvas;
            border-color: CanvasText;
          }
        `),
        h("header", { style: { ...row, justifyContent: "space-between" } },
          h("svg", {
            role: "img", "aria-label": "Oura", viewBox: "0 0 993 311",
            width: 82, fill: "currentColor",
          }, ...wordmarkPaths.map((d) => h("path", { key: d, d }))),
          h("span", {
            role: "status",
            style: { border: "1px solid currentColor", borderRadius: "999px", padding: "0.2rem 0.65rem" },
          }, settings.origin ? "Connection unverified" : "Setup required"),
        ),
        h("p", null, settings.origin
          ? "Sign in to link your ring, or test your connection in the browser."
          : "Enter your Oura Worker URL to get started."),
        isActive && settings.origin && !editing && h("div", { style: row },
          externalAction("Sign in to Oura", settings.signIn, true),
          externalAction("Test connection", settings.status),
          h(Button, { type: "button", onClick: edit }, "Edit URLs"),
        ),
        isActive && editing && h("form", { style: stack, onSubmit: save },
          field("origin", "Worker URL", "https://oura.example.com"),
          h("details", { open: draft.signIn || draft.status ? true : undefined },
            h("summary", null, "Advanced URLs"),
            h("div", { style: stack },
              h("p", null, "Leave these blank to use your Worker’s standard routes."),
              ...routes.map(([key, label]) => field(key, label, defaultPaths[key])),
            ),
          ),
          error && h("p", { role: "alert" }, error),
          h("div", { style: row },
            h(Button, { type: "submit" }, "Save URLs"),
            settings.origin && h(Button, {
              type: "button", onClick: () => { setEditing(false); setError(""); },
            }, "Cancel"),
          ),
          h(Markdown, {
            content: "[Set up an Oura Worker](https://github.com/joabzzz/buzz-oura#self-host-with-your-own-secrets)",
            scale: "document",
          }),
        ),
        settings.origin && h("details", null,
          h("summary", null, "Oura developer settings"),
          h("label", { style: stack },
            "OAuth redirect URI",
            h("input", { readOnly: true, value: settings.origin + "/oauth/oura/callback" }),
          ),
          h("p", null, "Register this URI in the Oura developer portal. Authorize, token, and API URLs are configured on the Worker."),
        ),
      );
    },
  });
}
