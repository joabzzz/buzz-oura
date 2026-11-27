export const inject = ["react", "settingsCards", "conversation"];

export function apply(ctx) {
  const { createElement: h, useState } = ctx.react;
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
      function save(event) {
        event.preventDefault();
        if (!active()) return;
        try {
          const next = workerOrigin(input);
          localStorage.setItem(storageKey, next);
          setOrigin(next);
          setError("");
        } catch {
          setError(
            "Enter an HTTPS Worker origin, such as https://oura.example.com.",
          );
        }
      }
      return h(
        "section",
        {
          className: "ui-card",
          style: { padding: "var(--space-panel-inset)" },
        },
        h("h1", null, "Oura"),
        h(
          "form",
          { onSubmit: save },
          h(
            "label",
            null,
            "Worker URL",
            h("input", {
              type: "url",
              value: input,
              required: true,
              onChange: (event) => setInput(event.target.value),
            }),
          ),
          h("button", { type: "submit" }, "Save"),
        ),
        error && h("p", { role: "alert" }, error),
        active() &&
          origin &&
          h(ctx.conversation.ui.Markdown, {
            content: `[Open Oura sign-in in browser](<${new URL("/account", origin).href}>)`,
            scale: "document",
          }),
        h("h2", null, "Who can ask about my data?"),
        h(
          "p",
          null,
          "People and channels: none. Sharing is unavailable until the service can verify Buzz identities and channel membership.",
        ),
      );
    },
  });
}
