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
