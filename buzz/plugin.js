// Oura wordmark from https://ouraring.com/ (navigation logo).
const wordmarkPaths = [
  "M63.443 27.388H190.38V0H63.443zM643.464 174.105H554.68V83.082h88.783c31.634 0 52.89 18.292 52.89 45.513 0 27.221-21.256 45.51-52.89 45.51m29.409 21.29c30.456-8.686 50.136-34.907 50.136-66.8 0-41.397-31.967-69.212-79.547-69.212H528.035v244.66h26.646V198.174h90.3l57.501 105.867h28.83l-59.946-108.218zM389.668 308.653c65.348 0 110.987-45.903 110.987-111.63V59.384h-27.387v135.793c0 50.688-34.377 86.09-83.6 86.09-40.798 0-84.709-26.94-84.709-86.09V59.384h-27.382v137.64c0 65.726 46.093 111.628 112.093 111.628m478.192-217.35 57.757 126.333H809.735zm-12.848-31.916L743.16 304.044h28.606l27.662-62.713h136.493l27.67 62.713h28.603L880.342 59.383zm-728.077-4.611C56.944 54.775 0 111.719 0 181.712c0 69.996 56.944 126.94 126.937 126.94 69.996 0 126.94-56.944 126.94-126.94 0-69.993-56.944-126.937-126.94-126.937m0 226.49c-54.893 0-99.553-44.66-99.553-99.553 0-54.892 44.661-99.55 99.554-99.55 54.894 0 99.556 44.658 99.556 99.55 0 54.893-44.662 99.553-99.556 99.553",
];
const managedOrigin = "https://wearables.joabar.xyz";
const accountPath = "/account";
const statusPath = "/account/status";
const settingsKey = "y13.oura.settings";
const legacyKey = "y13.oura.backend-origin";
const deviceChange = "y13.oura.device-change";
const attemptPattern = /^\d{13}\.[a-f0-9]{64}$/;
const codePattern = /^[a-f0-9]{32}$/;
const emptyDevice = {};
const connectionStates = {
  checking: ["Checking…", "Checking Oura account status."],
  disconnected: [
    "Not connected",
    "Connect your Oura account to check its connection in Buzz.",
  ],
  pending: [
    "Finish in browser",
    "Approve the connection in your browser and choose Return to Buzz.",
  ],
  connected: [
    "Connected",
    "Your Oura account is linked to this Buzz identity on this device.",
  ],
  reconnect_required: [
    "Reconnect required",
    "Oura needs you to sign in again.",
  ],
  test_failed: [
    "Check failed",
    "The connection couldn’t be verified. Try the test again.",
  ],
  browser: [
    "Check in browser",
    "This Worker reports its connection status in your browser.",
  ],
};
const labels = [
  ["signIn", "Sign-in URL", accountPath],
  ["status", "Connection test URL", statusPath],
];
const deviceKey = (viewer) => `y13.oura.device.${viewer}`;
const deadline = (attempt) => Number(attempt.slice(0, 13));
const returnGrace = 5 * 60_000;

function workerOrigin(value) {
  const url = new URL(value.trim() || managedOrigin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Enter an HTTPS Worker URL without a path.");
  return url.origin;
}

function workerEndpoint(value, origin, path) {
  const url = new URL(value.trim() || path, origin);
  if (url.origin !== origin || url.username || url.password || url.hash)
    throw new Error("Use a URL on the same Worker.");
  return url.href.replace(/[<>]/g, (character) =>
    encodeURIComponent(character),
  );
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || "null");
    const origin = workerOrigin(
      saved?.origin || localStorage.getItem(legacyKey) || "",
    );
    return {
      origin,
      signIn: workerEndpoint(saved?.signIn || "", origin, accountPath),
      status: workerEndpoint(saved?.status || "", origin, statusPath),
    };
  } catch {
    return {
      origin: managedOrigin,
      signIn: managedOrigin + accountPath,
      status: managedOrigin + statusPath,
    };
  }
}

function readDevice(viewer) {
  if (!viewer) return emptyDevice;
  try {
    const saved = JSON.parse(localStorage.getItem(deviceKey(viewer)) || "{}");
    const hasCredential = /^\d{13}\.[a-f0-9]{64}\.[a-f0-9]{32}$/.test(
      saved.credential,
    );
    const { pending } = saved;
    return {
      credential: hasCredential ? saved.credential : undefined,
      pending:
        pending &&
        attemptPattern.test(pending.attempt) &&
        attemptPattern.test(pending.proof) &&
        deadline(pending.attempt) + returnGrace > Date.now()
          ? pending
          : undefined,
    };
  } catch {
    return emptyDevice;
  }
}

function saveDevice(viewer, device) {
  localStorage.setItem(deviceKey(viewer), JSON.stringify(device));
  window.dispatchEvent(new Event(deviceChange));
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function prepareAttempt() {
  const expires = Date.now() + 10 * 60_000;
  const proof = `${expires}.${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(proof),
  );
  return { proof, attempt: `${expires}.${toHex(new Uint8Array(digest))}` };
}

function approvalRoute(params) {
  return (
    params &&
    typeof params === "object" &&
    typeof params.attempt === "string" &&
    attemptPattern.test(params.attempt) &&
    typeof params.code === "string" &&
    codePattern.test(params.code)
  );
}

export const inject = [
  "react",
  "settingsCards",
  "conversation",
  "host",
  "relay",
  "pages",
];

export function apply(ctx) {
  const {
    createElement: h,
    useState,
    useEffect,
    useRef,
    useSyncExternalStore,
  } = ctx.react;
  const ui = ctx.reflect?.get("ui");
  const Button =
    ui?.Button ??
    (({ variant: _variant, loading: _loading, ...props }) =>
      h("button", props));
  const Markdown = ctx.conversation.ui.Markdown;
  const getViewer = () => {
    const viewer = ctx.relay.snapshot().viewer;
    return /^[a-f0-9]{64}$/.test(viewer) ? viewer : "";
  };
  const subscribeViewer = (listener) => ctx.relay.subscribe(listener);
  const alwaysActive = () => true;

  async function request(credential, test = false) {
    const response = await ctx.host.request({
      url:
        managedOrigin + (test ? "/buzz/connection/test" : "/buzz/connection"),
      method: test ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${credential}`,
        Accept: "application/json",
      },
      timeoutMs: 13_000,
    });
    const result = JSON.parse(response.body);
    if (response.status === 401 && result.state === "disconnected")
      return result;
    if (
      response.status === 200 &&
      ["connected", "reconnect_required", "test_failed"].includes(result.state)
    )
      return result;
    throw new Error("Connection check failed");
  }

  function externalAction(label, url, primary, beforeOpen) {
    return h(
      "div",
      { className: "oura-action", "data-primary": primary || undefined },
      h(Markdown, {
        content: `[${label}](<${url}>)`,
        scale: "document",
        ...(beforeOpen ? { openLink: () => !beforeOpen() } : {}),
      }),
    );
  }

  function UrlField({
    label,
    value,
    placeholder,
    onChange,
    readOnly,
    type = "text",
  }) {
    return h(
      "label",
      { className: "oura-field" },
      label,
      ui?.Input
        ? h(ui.Input, {
            value,
            placeholder,
            readOnly,
            onValueChange: onChange,
            "aria-label": label,
          })
        : h("input", {
            value,
            placeholder,
            readOnly,
            type,
            onChange: onChange && ((event) => onChange(event.target.value)),
          }),
    );
  }

  function Advanced({ settings, save, active }) {
    const [draft, setDraft] = useState(() => ({
      origin: settings.origin,
      ...Object.fromEntries(
        labels.map(([key, , path]) => [
          key,
          settings[key] === settings.origin + path ? "" : settings[key],
        ]),
      ),
    }));
    const [notice, setNotice] = useState("");
    function submit(event) {
      event.preventDefault();
      if (!active()) return;
      try {
        const origin = workerOrigin(draft.origin);
        const next = { origin };
        for (const [key, label, path] of labels) {
          try {
            next[key] = workerEndpoint(draft[key], origin, path);
          } catch {
            throw new Error(`${label} must use the Worker above.`);
          }
        }
        localStorage.setItem(settingsKey, JSON.stringify(next));
        save(next);
        setNotice("Saved on this device.");
      } catch (error) {
        setNotice(
          error instanceof TypeError
            ? "Enter a valid HTTPS Worker URL."
            : error.message,
        );
      }
    }
    function input(key, label, placeholder, type) {
      return h(UrlField, {
        key,
        label,
        placeholder,
        type,
        value: draft[key],
        onChange: (value) => {
          setDraft((current) => ({ ...current, [key]: value }));
          setNotice("");
        },
      });
    }
    return h(
      "details",
      { className: "oura-disclosure" },
      h("summary", null, "Advanced settings"),
      h(
        "form",
        { className: "oura-fields", onSubmit: submit },
        input("origin", "Worker URL", managedOrigin, "url"),
        ...labels.map(([key, label, path]) => input(key, label, path)),
        h(UrlField, {
          label: "OAuth redirect URI",
          value: settings.origin + "/oauth/oura/callback",
          readOnly: true,
        }),
        externalAction("Open browser connection test", settings.status, false),
        h(
          "div",
          { className: "oura-actions" },
          h(Button, { type: "submit" }, "Save URLs"),
          h("small", { role: "status" }, notice),
        ),
      ),
    );
  }

  function Connection({ viewer, active, completion }) {
    const [settings, setSettings] = useState(readSettings);
    const [device, setDevice] = useState(() => readDevice(viewer));
    const [result, setResult] = useState(null);
    const [candidate, setCandidate] = useState(null);
    const [attemptRevision, resetAttempt] = useState(0);
    const [message, setMessage] = useState("");
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const currentOperation = useRef(null);
    const completionHandled = useRef("");
    const eligible = () => active() && getViewer() === viewer;
    const hosted = settings.origin === managedOrigin && !!viewer;
    const pending = hosted && device.pending;
    const credential = hosted ? device.credential : undefined;

    useEffect(() => {
      const sync = () => setDevice(readDevice(viewer));
      window.addEventListener(deviceChange, sync);
      window.addEventListener("storage", sync);
      return () => {
        currentOperation.current = null;
        window.removeEventListener(deviceChange, sync);
        window.removeEventListener("storage", sync);
      };
    }, [viewer]);

    useEffect(() => {
      if (!hosted) return;
      let live = true;
      let timer;
      function prepare() {
        setDevice(readDevice(viewer));
        prepareAttempt().then(
          (next) => {
            if (live) setCandidate(next);
          },
          () => {
            if (live)
              setMessage("Buzz couldn’t prepare a secure sign-in link.");
          },
        );
        timer = setTimeout(prepare, 9 * 60_000);
      }
      prepare();
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }, [hosted, viewer, attemptRevision]);

    useEffect(() => {
      if (!pending) return;
      const timer = setTimeout(
        () => setDevice(readDevice(viewer)),
        Math.max(deadline(pending.attempt) + returnGrace - Date.now(), 0),
      );
      return () => clearTimeout(timer);
    }, [pending?.attempt, viewer]);

    async function run(authorization, { test = false, attempt } = {}) {
      if (!eligible() || !hosted || (currentOperation.current && !attempt))
        return;
      const operation = {};
      currentOperation.current = operation;
      setBusy(true);
      setMessage("");
      try {
        const next = await request(authorization, test);
        if (currentOperation.current !== operation || !eligible()) return;
        const saved = readDevice(viewer);
        if (attempt) {
          if (saved.pending?.attempt !== attempt) return;
          if (next.state === "disconnected") {
            setMessage(
              "Buzz couldn’t verify that approval. Check the code or start again.",
            );
            return;
          }
          saveDevice(viewer, { credential: authorization });
          setCode("");
        } else {
          if (saved.credential !== authorization) return;
          if (next.state === "disconnected")
            saveDevice(viewer, { pending: saved.pending });
        }
        setResult(next);
      } catch {
        if (currentOperation.current !== operation || !eligible()) return;
        setMessage(
          attempt
            ? "Buzz couldn’t check the approval. Try again."
            : "The Worker didn’t respond. Try the connection test again.",
        );
        if (!attempt) setResult({ state: "test_failed" });
      } finally {
        if (currentOperation.current === operation) {
          currentOperation.current = null;
          setBusy(false);
        }
      }
    }

    function finish(approvedCode, approvedAttempt) {
      const saved = readDevice(viewer);
      if (!codePattern.test(approvedCode)) {
        setMessage("Enter the connection code shown in your browser.");
        return;
      }
      if (!saved.pending || saved.pending.attempt !== approvedAttempt) {
        setMessage(
          "This approval needs the Buzz identity and device that started sign-in. Open Oura settings there or start again.",
        );
        return;
      }
      return run(`${saved.pending.proof}.${approvedCode}`, {
        attempt: approvedAttempt,
      });
    }

    useEffect(() => {
      if (
        !hosted ||
        !completion ||
        completionHandled.current === completion.code
      )
        return;
      completionHandled.current = completion.code;
      if (pending) void finish(completion.code, completion.attempt);
      else if (!credential)
        setMessage(
          "This approval needs the Buzz identity and device that started sign-in. Start again from Oura settings.",
        );
    }, [hosted, viewer, completion?.code]);

    useEffect(() => {
      if (!credential || (completion && pending)) return;
      void run(credential);
      const onFocus = () => {
        if (readDevice(viewer).credential === credential) void run(credential);
      };
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
    }, [credential, viewer]);

    function begin(attempt) {
      if (!eligible() || !attempt) return false;
      if (deadline(attempt.attempt) <= Date.now()) {
        startOver();
        setMessage(
          "The sign-in link expired. Click Sign in to Oura to try again.",
        );
        return false;
      }
      try {
        saveDevice(viewer, { ...readDevice(viewer), pending: attempt });
        setMessage("");
        return true;
      } catch {
        setMessage("Buzz couldn’t save the sign-in attempt on this device.");
        return false;
      }
    }

    function startOver() {
      if (!eligible()) return;
      try {
        saveDevice(viewer, { credential });
        setCandidate(null);
        resetAttempt((revision) => revision + 1);
        setMessage("");
        setCode("");
      } catch {
        setMessage("Buzz couldn’t reset the sign-in attempt.");
      }
    }

    function saveSettings(next) {
      currentOperation.current = null;
      setBusy(false);
      setResult(null);
      setMessage("");
      setSettings(next);
    }

    const state = !hosted
      ? "browser"
      : pending
        ? "pending"
        : (result?.state ?? (credential ? "checking" : "disconnected"));
    const [label, summary] = connectionStates[state];
    const reconnect = result?.state === "reconnect_required";
    const signInAttempt = pending || candidate;
    const signInUrl = new URL(settings.signIn);
    if (hosted && signInAttempt)
      signInUrl.searchParams.set("buzz", signInAttempt.attempt);
    const connectLabel = pending
      ? "Open sign-in again"
      : reconnect
        ? "Reconnect Oura"
        : "Sign in to Oura";
    const showConnect = hosted && (!credential || pending || reconnect);
    const lastVerifiedAt = result?.lastVerifiedAt;
    const checked =
      state === "connected" && Number.isSafeInteger(lastVerifiedAt)
        ? `Last tested ${new Date(lastVerifiedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
        : "";

    return h(
      "section",
      { className: "ui-card oura-card", "aria-label": "Oura connection" },
      h(
        "style",
        null,
        `
        .oura-card { display: grid; gap: var(--space-3, 12px); padding: var(--space-panel-inset); max-width: 40rem; }
        .oura-header, .oura-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2, 8px); }
        .oura-header { justify-content: space-between; }
        .oura-card p { margin: 0; }
        .oura-badge { display: inline-flex; align-items: center; gap: .4em; border: 1px solid currentColor; border-radius: 999px; padding: .2em .65em; font-size: .85em; }
        .oura-badge::before { content: ""; width: .45em; height: .45em; border-radius: 50%; background: currentColor; }
        .oura-badge[data-state="connected"] { color: light-dark(#16644b, #9bdfc7); }
        .oura-badge[data-state="reconnect_required"], .oura-badge[data-state="test_failed"] { color: light-dark(#8e4408, #f8c381); }
        .oura-action p { margin: 0; }
        .oura-action a { display: inline-block; border: 1px solid currentColor; border-radius: .5rem; padding: .45rem .8rem; text-decoration: none; font-weight: 600; }
        .oura-action[data-primary] a { background: CanvasText; color: Canvas; border-color: CanvasText; }
        .oura-disclosure { border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding-top: var(--space-2, 8px); }
        .oura-disclosure summary { cursor: pointer; }
        .oura-fields { display: grid; gap: var(--space-2, 8px); margin-top: var(--space-2, 8px); }
        .oura-field { display: grid; gap: .25em; overflow-wrap: anywhere; }
        .oura-field input { width: 100%; box-sizing: border-box; }
      `,
      ),
      h(
        "header",
        { className: "oura-header" },
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
        h(
          "span",
          { className: "oura-badge", "data-state": state, role: "status" },
          busy ? "Checking…" : label,
        ),
      ),
      h(
        "p",
        null,
        !viewer && settings.origin === managedOrigin
          ? "Select a Buzz identity to see your connection here."
          : summary,
      ),
      checked && h("small", null, checked),
      h(
        "div",
        { className: "oura-actions" },
        showConnect &&
          (signInAttempt
            ? externalAction(connectLabel, signInUrl.href, true, () =>
                begin(signInAttempt),
              )
            : h(
                Button,
                { type: "button", disabled: true },
                "Preparing sign-in…",
              )),
        pending &&
          h(
            Button,
            { type: "button", disabled: busy, onClick: startOver },
            "Start over",
          ),
        hosted &&
          credential &&
          !pending &&
          h(
            Button,
            {
              type: "button",
              variant: "prominent",
              loading: busy,
              disabled: busy,
              onClick: () => void run(credential, { test: true }),
            },
            "Test connection",
          ),
        (!hosted || (credential && !pending)) &&
          externalAction(
            hosted ? "Manage account" : "Sign in to Oura",
            settings.signIn,
            !hosted,
          ),
        !hosted && externalAction("Test in browser", settings.status, false),
      ),
      pending &&
        h(
          "details",
          null,
          h("summary", null, "Have a connection code?"),
          h(
            "form",
            {
              className: "oura-fields",
              onSubmit: (event) => {
                event.preventDefault();
                void finish(code.trim().toLowerCase(), pending.attempt);
              },
            },
            h(UrlField, {
              label: "Connection code",
              value: code,
              onChange: setCode,
            }),
            h(
              "div",
              { className: "oura-actions" },
              h(
                Button,
                { type: "submit", disabled: busy || !code.trim() },
                "Verify code",
              ),
            ),
          ),
        ),
      message && h("p", { role: "alert" }, message),
      h(Advanced, { settings, save: saveSettings, active: eligible }),
      h("small", null, "Plugin v0.2.0"),
    );
  }

  function Oura({ active = alwaysActive, navigation }) {
    const viewer = useSyncExternalStore(subscribeViewer, getViewer, getViewer);
    const params = navigation?.target?.route?.params;
    return h(Connection, {
      key: viewer,
      viewer,
      active,
      completion: approvalRoute(params) ? params : null,
    });
  }

  ctx.settingsCards.register({
    id: "oura",
    title: "Oura",
    group: "Integrations",
    component: Oura,
  });
  ctx.pages.register({
    id: "connection",
    title: "Oura connection",
    component: Oura,
    route: { version: 1, validate: approvalRoute },
  });
}
