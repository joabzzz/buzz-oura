// Oura wordmark from https://ouraring.com/ (navigation logo).
const wordmarkPaths = [
  "M63.443 27.388H190.38V0H63.443zM643.464 174.105H554.68V83.082h88.783c31.634 0 52.89 18.292 52.89 45.513 0 27.221-21.256 45.51-52.89 45.51m29.409 21.29c30.456-8.686 50.136-34.907 50.136-66.8 0-41.397-31.967-69.212-79.547-69.212H528.035v244.66h26.646V198.174h90.3l57.501 105.867h28.83l-59.946-108.218zM389.668 308.653c65.348 0 110.987-45.903 110.987-111.63V59.384h-27.387v135.793c0 50.688-34.377 86.09-83.6 86.09-40.798 0-84.709-26.94-84.709-86.09V59.384h-27.382v137.64c0 65.726 46.093 111.628 112.093 111.628m478.192-217.35 57.757 126.333H809.735zm-12.848-31.916L743.16 304.044h28.606l27.662-62.713h136.493l27.67 62.713h28.603L880.342 59.383zm-728.077-4.611C56.944 54.775 0 111.719 0 181.712c0 69.996 56.944 126.94 126.937 126.94 69.996 0 126.94-56.944 126.94-126.94 0-69.993-56.944-126.937-126.94-126.937m0 226.49c-54.893 0-99.553-44.66-99.553-99.553 0-54.892 44.661-99.55 99.554-99.55 54.894 0 99.556 44.658 99.556 99.55 0 54.893-44.662 99.553-99.556 99.553",
];
const version = "0.1.3";
const apiEndpoints = [
  ["OAuth authorization", "https://cloud.ouraring.com/oauth/authorize"],
  ["OAuth token exchange", "https://api.ouraring.com/oauth/token"],
  ["Oura API base", "https://api.ouraring.com/v2"],
];

export const inject = ["react", "settingsCards", "conversation"];

export function apply(ctx) {
  const { createElement: h, useState } = ctx.react;
  const ui = ctx.reflect?.get("ui");
  const Button = ui?.Button ?? "button";
  const Markdown = ctx.conversation.ui.Markdown;
  const storageKey = "y13.oura.backend-origin";
  function workerOrigin(value) {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  }
  ctx.settingsCards.register({
    id: "oura",
    title: "Oura",
    group: "Integrations",
    component: function Oura({ active }) {
      const [origin, setOrigin] = useState(() => {
        try {
          return workerOrigin(localStorage.getItem(storageKey) || "");
        } catch {
          return "";
        }
      });
      const [input, setInput] = useState(origin);
      const [error, setError] = useState("");
      const [editing, setEditing] = useState(!origin);
      function save(event) {
        event.preventDefault();
        if (!active()) return;
        try {
          const next = workerOrigin(input);
          localStorage.setItem(storageKey, next);
          setOrigin(next);
          setEditing(false);
          setError("");
        } catch {
          setError(
            "Enter an HTTPS Worker origin, such as https://oura.example.com.",
          );
        }
      }
      const isActive = active();
      const sectionStyle = {
        padding: "var(--space-panel-inset)",
        display: "grid",
        gap: "var(--space-2)",
      };
      return h(
        "div",
        { style: { display: "grid", gap: "var(--space-2)" } },
        h(
          "header",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
            },
          },
          h(
            "svg",
            {
              role: "img",
              "aria-label": "Oura",
              viewBox: "0 0 993 311",
              width: 82,
              fill: "currentColor",
            },
            ...wordmarkPaths.map((d) => h("path", { key: d, d })),
          ),
          h("span", null, `Plugin v${version}`),
        ),
        h(
          "section",
          { className: "ui-card", style: sectionStyle },
          h("h2", null, "Oura account"),
          h(
            "p",
            null,
            origin ? "Backend configured" : "Set up a backend to connect Oura.",
          ),
          origin && h("p", null, origin),
          isActive &&
            origin &&
            h(Markdown, {
              content: `[Open Oura sign-in in browser](<${new URL("/account", origin).href}>)`,
              scale: "document",
            }),
          isActive &&
            origin &&
            h(Markdown, {
              content: `[Test connection in browser](<${new URL("/account/status", origin).href}>)`,
              scale: "document",
            }),
          isActive &&
            origin &&
            !editing &&
            h(
              Button,
              {
                type: "button",
                onClick: () => {
                  setInput(origin);
                  setEditing(true);
                },
              },
              "Change backend",
            ),
          isActive &&
            editing &&
            h(
              "form",
              {
                onSubmit: save,
                style: { display: "grid", gap: "var(--space-2)" },
              },
              h("label", { htmlFor: "oura-worker-url" }, "Worker URL"),
              h("input", {
                id: "oura-worker-url",
                type: "url",
                placeholder: "https://oura.example.com",
                value: input,
                required: true,
                onChange: (event) => setInput(event.target.value),
              }),
              error && h("p", { role: "alert" }, error),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "var(--space-2)",
                  },
                },
                h(Button, { type: "submit" }, "Save backend"),
                origin &&
                  h(
                    Button,
                    {
                      type: "button",
                      onClick: () => {
                        setEditing(false);
                        setError("");
                      },
                    },
                    "Cancel",
                  ),
              ),
              h(Markdown, {
                content:
                  "[Set up an Oura backend](https://github.com/joabzzz/buzz-oura#self-host-with-your-own-secrets)",
                scale: "document",
              }),
            ),
        ),
        h(
          "section",
          { className: "ui-card", style: sectionStyle },
          h("h2", null, "OAuth and API details"),
          h(
            "p",
            null,
            "Register this exact callback URL in the Oura developer portal.",
          ),
          h(
            "dl",
            null,
            ...[
              [
                "Redirect URI",
                `${origin || "https://oura.example.com"}/oauth/oura/callback`,
              ],
              ...apiEndpoints,
            ].map(([label, value]) =>
              h(
                "div",
                { key: label, style: { marginBottom: "var(--space-2)" } },
                h("dt", null, label),
                h(
                  "dd",
                  { style: { marginInlineStart: 0, overflowWrap: "anywhere" } },
                  h("code", null, value),
                ),
              ),
            ),
          ),
        ),
        h(
          "section",
          { className: "ui-card", style: sectionStyle },
          h("h2", null, "Data sharing"),
          h(
            "dl",
            null,
            h("dt", null, "People"),
            h("dd", null, "None"),
            h("dt", null, "Channels"),
            h("dd", null, "None"),
          ),
          h("p", null, "Sharing is unavailable in this version."),
        ),
      );
    },
  });
}
