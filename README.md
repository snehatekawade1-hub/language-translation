# Smart Translator

A responsive language translator website built with plain HTML, CSS and JavaScript.
It ships in two modes:

| Mode | What it uses | API key? | Best for |
|---|---|---|---|
| **Frontend-only demo** (default) | Free MyMemory API, called from the browser | None | Learning, demos |
| **Java backend** (optional) | Spring Boot proxy to Google Cloud Translation | Yes, kept on the server | Anything real |

## Project structure

```
translator-website/
├── index.html          Page structure
├── style.css           Blue/purple gradient theme, responsive layout
├── script.js           UI logic and API calls (CONFIG at the top picks the mode)
├── backend/            Optional Spring Boot server
│   ├── pom.xml
│   └── src/main/
│       ├── java/com/smarttranslator/
│       │   ├── TranslatorApplication.java
│       │   └── TranslationController.java
│       └── resources/application.properties
└── README.md
```

## Features

- Source and target dropdowns with 21 languages (English, Hindi, Marathi, Spanish, French, German, Japanese, Chinese, Arabic and more)
- "Detect language" option for the source
- Swap button (also moves the translation into the input so you can translate back)
- Translate button with a loading spinner
- Copy Translation, Clear, and a speaker button (browser Web Speech API)
- Character counter (limit 5,000) and Ctrl/Cmd + Enter shortcut
- Friendly errors for empty input, same source/target, timeouts, network failures, quota limits and API errors
- Works on desktop, tablet and phone

## Run the frontend-only demo

You need a browser and an internet connection. Nothing to install.

**Option A:** double-click `index.html`.

**Option B (recommended):** serve the folder, which behaves like a real website.

```bash
cd translator-website
python3 -m http.server 8000      # on Windows: python -m http.server 8000
```

Open <http://localhost:8000>.

Click **Try an example**, or type text, pick languages, and press **Translate**.

## How the frontend talks to the API

1. You press **Translate**. `handleTranslate()` in `script.js` validates the input (not empty, under 5,000 characters, different languages).
2. In demo mode, `translateViaMyMemory()` splits long text into sentence-sized chunks (the free API accepts at most 500 bytes per request) and calls
   `GET https://api.mymemory.translated.net/get?q=...&langpair=en|hi` using `fetch()` for each chunk.
3. The JSON reply has the translation in `responseData.translatedText`. The chunks are joined and shown in the output box.
4. In backend mode, `translateViaBackend()` instead sends `POST /api/translate` with `{"text","source","target"}` to your Java server, which calls Google and returns `{"translatedText","detectedSource"}`.

## Limits of the free demo service

MyMemory is a free public service. Expect these limitations:

- A daily character quota for anonymous use (about 5,000 characters per day per IP at the time of writing). Putting a real email in `CONFIG.contactEmail` raises it. Check [mymemory.translated.net/doc](https://mymemory.translated.net/doc/spec.php) for current numbers.
- Quality is uneven: it mixes machine translation with human-contributed memory matches.
- No uptime guarantee, and automatic language detection is best-effort.

Do not rely on it for a production site.

## Use the Java backend (recommended for real use)

### 1. Get a Google Cloud Translation API key

1. Sign in at [console.cloud.google.com](https://console.cloud.google.com) and create or select a project.
2. Enable billing for the project (Cloud Translation is a paid API with a monthly free allowance; check current pricing).
3. Go to **APIs & Services → Library**, search for **Cloud Translation API**, and click **Enable**.
4. Go to **APIs & Services → Credentials → Create credentials → API key**.
5. Click **Restrict key** and limit it to the Cloud Translation API. Add an IP restriction for your server if you can.

*Microsoft Translator alternative:* create a Translator resource in the Azure portal, copy a key and region from **Keys and Endpoint**, and change the request in `TranslationController.java` to call `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=..&to=..` with the headers `Ocp-Apim-Subscription-Key` and `Ocp-Apim-Subscription-Region`. The same rule applies: keep the key on the server.

### 2. Store the key in an environment variable

Never paste the key into `script.js`, `index.html` or `application.properties`, and never commit it to Git.

```bash
# macOS / Linux
export GOOGLE_TRANSLATE_API_KEY="your-key-here"

# Windows PowerShell
$env:GOOGLE_TRANSLATE_API_KEY = "your-key-here"

# Windows cmd
set GOOGLE_TRANSLATE_API_KEY=your-key-here
```

### 3. Start the server

Requires Java 17+ and Maven 3.6+.

```bash
cd backend
mvn spring-boot:run
```

The server listens on <http://localhost:8080>.

### 4. Point the frontend at it

In `script.js`, change:

```js
provider: 'backend',
```

Then serve the frontend on port 8000 (see above). If you use another port or origin, add it to `app.cors.allowed-origins` in `application.properties`. A page opened with `file://` is not allowed by CORS, so use the local web server.

## Sample translations

Wording from a live service may differ slightly, but expect results like these:

| English | Hindi | Marathi |
|---|---|---|
| Hello, how are you? | नमस्ते, आप कैसे हैं? | नमस्कार, तुम्ही कसे आहात? |
| Thank you very much. | आपका बहुत-बहुत धन्यवाद। | खूप खूप धन्यवाद. |
| Where is the railway station? | रेलवे स्टेशन कहाँ है? | रेल्वे स्टेशन कुठे आहे? |
| Good morning | सुप्रभात | शुभ प्रभात |

## How to test

**In the browser**

1. Click the **English to Hindi** example. You should see the Hindi translation and a spinner while it loads.
2. Click **Copy Translation**, then paste somewhere. The button briefly says "Copied!".
3. Click the speaker button to hear it. This needs a Hindi voice installed on your device.
4. Click **Swap**. Languages exchange and the translation moves into the input.
5. Click **Clear**. Both boxes reset.
6. Click **Translate** with an empty box. You should see "Enter some text to translate."
7. Turn off your Wi-Fi and translate. You should see a network error.

**The backend directly**

```bash
curl -X POST http://localhost:8080/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, how are you?","source":"en","target":"mr"}'
```

Expected: `{"translatedText":"...","detectedSource":null}`. With `"source":"auto"`, `detectedSource` holds the detected code (for example `"en"`).

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| "Network error" in demo mode | No internet, or a firewall/ad blocker is blocking `api.mymemory.translated.net`. |
| "The free daily translation limit has been reached" | MyMemory quota used up. Wait a day, set `contactEmail`, or switch to the backend. |
| "Network error ... Is the Java backend running?" | Server not started, wrong `backendUrl`, or CORS: the page's origin must be listed in `app.cors.allowed-origins`. Check the browser console. |
| Backend returns 503 "no translation API key" | `GOOGLE_TRANSLATE_API_KEY` not set in the same terminal that runs `mvn spring-boot:run`. |
| Backend returns 502 "Google rejected the request" | Key is wrong, Cloud Translation API not enabled, billing not enabled, or key restrictions block the call. |
| Speaker says no voice installed | Install a voice for that language in your OS speech settings. Support differs by browser and device. |
| Copy does not work | Some browsers only allow clipboard access on `https` or `localhost`. Use the local server. |
| Hindi or Marathi shows as boxes | Your device lacks a Devanagari font. Install one, such as Noto Sans Devanagari. |
| `mvn` not found / Java version error | Install JDK 17+ and Maven, and check with `java -version` and `mvn -v`. |

## Security notes

- The browser never sees the Google key. It only talks to your server.
- The server validates length and language codes before calling Google.
- Before going public, add rate limiting to the backend and restrict CORS to your real domain, otherwise anyone can run up your translation bill through your endpoint.
