# web/ — voice→voice front end

A static, dependency-light front end: hand-rolled CSS + htmx for server
interaction, with small ES modules for the parts htmx doesn't cover
(microphone capture, audio playback). No build step.

## Layout

```
web/
├── index.html              # landing page
├── app/
│   └── index.html          # the voice workspace
└── static/
    ├── css/
    │   ├── base.css        # tokens, reset, shared primitives, toasts
    │   ├── landing.css     # landing page only
    │   └── app.css         # voice workspace only
    ├── js/
    │   ├── app.js          # page glue: state machine + htmx wiring
    │   ├── audio-recorder.js  # DOM-agnostic MediaRecorder wrapper
    │   └── toast.js        # notifications
    ├── vendor/
    │   └── htmx.min.js     # vendored, version pinned in package.json
    └── icon.svg
```

## Running locally

Serve this directory with any static file server, e.g.:

```sh
npx serve .            # or
python -m http.server 8080
```

Then open `/` for the landing page and `/app/` for the voice workspace.
Later, the Go API can serve this directory directly (`http.FileServer` /
`embed`) so front and back end share an origin.

> Microphone capture requires a secure context: `localhost` is fine,
> plain-HTTP on a LAN IP is not.

## Speech API contract _(placeholder — backend not built yet)_

The UI expects a single endpoint (declared once, on `#stt-form` in
`app/index.html` — update it there):

```
POST /api/v1/stt
Content-Type: multipart/form-data
```

| Field        | Type | Notes                                                        |
| ------------ | ---- | ------------------------------------------------------------ |
| `audio`      | file | one utterance; webm/opus (browser-dependent), `take-<ts>.webm` |
| `session_id` | text | opaque id, one per page load — thread conversations with it  |

**Success (200):** an HTML fragment appended to `#conversation`, e.g.

```html
<div class="msg msg--user"><p>hello there</p></div>
<div class="msg msg--assistant"><p>Hi! How can I help?</p></div>
```

**Spoken replies (optional):** return an `HX-Trigger` header and the client
plays the audio automatically:

```
HX-Trigger: {"voice:audio": {"url": "/api/v1/audio/<id>.wav"}}
```

**Errors:** any non-2xx surfaces a toast (with a status-aware message);
the response body is currently ignored. A short human-readable body is
fine for logs.

## Conventions

- **Endpoints live in HTML attributes** (`hx-post`, …), never in JS.
- **JS ↔ htmx talk via DOM events.** JS dispatches `recording-ready`
  (CustomEvent on `<body>`) once an audio take is ready; the form's
  `hx-trigger` picks it up. The audio file is attached via the
  `htmx:configRequest` hook (`parameters.audio = file`, `formData.set('audio', file, filename)`).
- **UI states** are data, not imperative class juggling:
  `#voiceDock[data-state="idle|recording|processing"]` — CSS renders from it.
- **Server drives the conversation markup.** The client never fabricates
  message bubbles; it only appends what the API returns.

## When you build the real API

1. Implement `POST /api/v1/stt` per the contract above.
2. If the path differs, change only `hx-post` in `app/index.html`.
3. To evolve to full voice-to-voice, either emit `HX-Trigger voice:audio`
   as above, or graduate `audio-recorder.js` to a WebSocket client — it's
   already UI-free, so `app.js` keeps working.
