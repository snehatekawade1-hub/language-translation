'use strict';

/* =====================================================================
   Smart Translator: front-end logic

   Two ways to translate (set CONFIG.provider):
     'mymemory'  Free demo. Calls the MyMemory API straight from the browser.
                 No API key needed. Has daily limits.
     'backend'   Calls your own Spring Boot server (see /backend), which holds
                 the private Google Cloud Translation key. Use this for anything
                 beyond a demo, because API keys must never live in browser code.
   ===================================================================== */

const CONFIG = {
  provider: 'mymemory',                          // 'mymemory' or 'backend'
  backendUrl: 'http://localhost:8080/api/translate',
  contactEmail: '',                              // optional: a real email raises MyMemory's daily limit
  maxChars: 5000,
  chunkBytes: 450,                               // MyMemory accepts at most 500 bytes per request
  timeoutMs: 15000
};

const LANGUAGES = [
  { code: 'en',    name: 'English',                speech: 'en-US' },
  { code: 'hi',    name: 'Hindi (हिन्दी)',          speech: 'hi-IN' },
  { code: 'mr',    name: 'Marathi (मराठी)',         speech: 'mr-IN' },
  { code: 'es',    name: 'Spanish (Español)',      speech: 'es-ES' },
  { code: 'fr',    name: 'French (Français)',      speech: 'fr-FR' },
  { code: 'de',    name: 'German (Deutsch)',       speech: 'de-DE' },
  { code: 'ja',    name: 'Japanese (日本語)',        speech: 'ja-JP' },
  { code: 'zh-CN', name: 'Chinese (中文)',           speech: 'zh-CN' },
  { code: 'ar',    name: 'Arabic (العربية)',        speech: 'ar-SA', rtl: true },
  { code: 'pt',    name: 'Portuguese (Português)', speech: 'pt-BR' },
  { code: 'ru',    name: 'Russian (Русский)',      speech: 'ru-RU' },
  { code: 'it',    name: 'Italian (Italiano)',     speech: 'it-IT' },
  { code: 'ko',    name: 'Korean (한국어)',          speech: 'ko-KR' },
  { code: 'bn',    name: 'Bengali (বাংলা)',         speech: 'bn-IN' },
  { code: 'ta',    name: 'Tamil (தமிழ்)',           speech: 'ta-IN' },
  { code: 'te',    name: 'Telugu (తెలుగు)',         speech: 'te-IN' },
  { code: 'gu',    name: 'Gujarati (ગુજરાતી)',      speech: 'gu-IN' },
  { code: 'pa',    name: 'Punjabi (ਪੰਜਾਬੀ)',        speech: 'pa-IN' },
  { code: 'ur',    name: 'Urdu (اردو)',            speech: 'ur-PK', rtl: true },
  { code: 'tr',    name: 'Turkish (Türkçe)',       speech: 'tr-TR' },
  { code: 'nl',    name: 'Dutch (Nederlands)',     speech: 'nl-NL' }
];

/* ---------- DOM references ---------- */

const $ = (id) => document.getElementById(id);

const el = {
  source: $('sourceLang'),
  target: $('targetLang'),
  swap: $('swapBtn'),
  input: $('inputText'),
  output: $('outputText'),
  count: $('charCount'),
  detected: $('detected'),
  status: $('status'),
  error: $('errorBox'),
  translate: $('translateBtn'),
  translateLabel: $('translateLabel'),
  clear: $('clearBtn'),
  copy: $('copyBtn'),
  copyLabel: $('copyLabel'),
  speak: $('speakBtn')
};

const state = {
  loading: false,
  lastTranslation: '',
  outputLang: 'hi',
  detectedCode: null
};

/* ---------- Helpers ---------- */

class TranslateError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'validation' | 'network' | 'api'
  }
}

const getLang = (code) => LANGUAGES.find((l) => l.code === code);
const shortName = (code) => (getLang(code)?.name || code).split(' (')[0];
const byteLen = (s) => new TextEncoder().encode(s).length;

function decodeEntities(str) {
  // MyMemory sometimes returns HTML entities such as &#39;. A <textarea> decodes them safely.
  const box = document.createElement('textarea');
  box.innerHTML = str;
  return box.value;
}

function normalizeLang(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lc = raw.toLowerCase();
  if (lc.startsWith('zh')) return 'zh-CN';
  const base = lc.split(/[-_]/)[0];
  return getLang(base) ? base : null;
}

/* ---------- UI: errors, loading, output ---------- */

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = false;
}

function hideError() {
  el.error.hidden = true;
  el.error.textContent = '';
}

function setLoading(isLoading) {
  state.loading = isLoading;
  el.translate.disabled = isLoading;
  el.translate.classList.toggle('is-loading', isLoading);
  el.translate.setAttribute('aria-busy', String(isLoading));
  el.translateLabel.textContent = isLoading ? 'Translating…' : 'Translate';
}

function showOutput(text, langCode) {
  state.lastTranslation = text;
  state.outputLang = langCode;
  el.output.textContent = text;
  el.output.classList.remove('is-empty');
  el.output.lang = langCode;
  el.output.dir = getLang(langCode)?.rtl ? 'rtl' : 'ltr';
}

function clearOutput() {
  state.lastTranslation = '';
  el.output.textContent = '';
  el.output.classList.add('is-empty');
  el.status.textContent = '';
}

function showDetected(code) {
  state.detectedCode = code;
  if (code) {
    el.detected.textContent = 'Detected: ' + shortName(code);
    el.detected.hidden = false;
  } else {
    el.detected.hidden = true;
  }
}

function updateCount() {
  el.count.textContent = `${el.input.value.length} / ${CONFIG.maxChars}`;
}

/* ---------- Network ---------- */

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
  let res;

  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const hint = CONFIG.provider === 'backend' ? ' Is the Java backend running?' : '';
    if (err.name === 'AbortError') {
      throw new TranslateError('The request timed out. Please try again.' + hint, 'network');
    }
    throw new TranslateError('Network error. Check your internet connection and try again.' + hint, 'network');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await res.json(); } catch { /* body was not JSON */ }

  if (!res.ok) {
    const message = (data && data.error) || `The translation service returned an error (HTTP ${res.status}).`;
    throw new TranslateError(message, 'api');
  }
  return data;
}

/* ---------- Provider 1: MyMemory (free demo) ---------- */

function splitHard(piece, maxBytes) {
  // Last resort for a single sentence longer than the limit: split on spaces, then on characters.
  const parts = piece.split(/(\s+)/);
  const out = [];
  let cur = '';
  for (const part of parts) {
    if (byteLen(part) > maxBytes) {
      if (cur) { out.push(cur); cur = ''; }
      let buf = '';
      for (const ch of part) {
        if (byteLen(buf + ch) > maxBytes) { out.push(buf); buf = ''; }
        buf += ch;
      }
      cur = buf;
      continue;
    }
    if (cur && byteLen(cur + part) > maxBytes) { out.push(cur); cur = ''; }
    cur += part;
  }
  if (cur) out.push(cur);
  return out;
}

function splitText(text, maxBytes) {
  // Break text into sentence-sized chunks that fit the API's per-request limit.
  const pieces = text.match(/[^.!?।\n]+[.!?।]*[ \t]*|\n+|[.!?।]+[ \t]*/g) || [text];
  const chunks = [];
  let current = '';
  const flush = () => { if (current) { chunks.push(current); current = ''; } };

  for (const piece of pieces) {
    if (byteLen(piece) > maxBytes) {
      flush();
      chunks.push(...splitHard(piece, maxBytes));
      continue;
    }
    if (current && byteLen(current + piece) > maxBytes) flush();
    current += piece;
  }
  flush();
  return chunks;
}

async function translateChunkMyMemory(text, source, target) {
  const params = new URLSearchParams({
    q: text,
    langpair: `${source === 'auto' ? 'Autodetect' : source}|${target}`
  });
  if (CONFIG.contactEmail) params.set('de', CONFIG.contactEmail);

  const data = await fetchJson(`https://api.mymemory.translated.net/get?${params}`);
  const translated = data?.responseData?.translatedText;

  if (Number(data?.responseStatus) !== 200 || typeof translated !== 'string') {
    throw new TranslateError(data?.responseDetails || 'The translation service could not translate this text.', 'api');
  }
  if (/^MYMEMORY WARNING/i.test(translated)) {
    throw new TranslateError('The free daily translation limit has been reached. Try again tomorrow, or switch to the backend provider.', 'api');
  }

  return {
    text: decodeEntities(translated),
    detected: source === 'auto' ? normalizeLang(data.matches?.[0]?.source) : null
  };
}

async function translateViaMyMemory(text, source, target) {
  const chunks = splitText(text, CONFIG.chunkBytes);
  const out = [];
  let detected = null;
  let src = source;

  for (const chunk of chunks) {
    const m = chunk.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2]) { out.push(chunk); continue; }       // whitespace only: keep as is

    const part = await translateChunkMyMemory(m[2], src, target);
    if (!detected && part.detected) {
      detected = part.detected;
      src = detected;                               // use the same source language for the rest
    }
    out.push(m[1] + part.text + m[3]);
  }
  return { text: out.join('').trim(), detected };
}

/* ---------- Provider 2: your Spring Boot backend ---------- */

async function translateViaBackend(text, source, target) {
  const data = await fetchJson(CONFIG.backendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source, target })
  });
  if (!data || typeof data.translatedText !== 'string') {
    throw new TranslateError('The server sent an unexpected response.', 'api');
  }
  return { text: data.translatedText, detected: normalizeLang(data.detectedSource) };
}

/* ---------- Actions ---------- */

async function handleTranslate() {
  if (state.loading) return;
  hideError();

  const text = el.input.value.trim();
  const source = el.source.value;
  const target = el.target.value;

  if (!text) {
    showError('Enter some text to translate.');
    el.input.focus();
    return;
  }
  if (text.length > CONFIG.maxChars) {
    showError(`The text is too long. Keep it under ${CONFIG.maxChars} characters.`);
    return;
  }
  if (source === target) {
    showError('The source and target languages are the same. Choose a different target language.');
    return;
  }

  setLoading(true);
  showDetected(null);

  try {
    const result = CONFIG.provider === 'backend'
      ? await translateViaBackend(text, source, target)
      : await translateViaMyMemory(text, source, target);

    if (!result.text) throw new TranslateError('The service returned an empty translation. Try rephrasing the text.', 'api');

    showOutput(result.text, target);
    if (source === 'auto') showDetected(result.detected);
    el.status.textContent = CONFIG.provider === 'backend' ? 'Translated with Google Cloud Translation' : 'Translated with MyMemory';
  } catch (err) {
    clearOutput();
    showError(err instanceof TranslateError ? err.message : 'Something went wrong. Please try again.');
    console.error(err);
  } finally {
    setLoading(false);
  }
}

function swapLanguages() {
  hideError();
  let newTarget = el.source.value;

  if (newTarget === 'auto') {
    if (!state.detectedCode) {
      showError('Choose a specific source language before swapping, or translate once so the language can be detected.');
      return;
    }
    newTarget = state.detectedCode;
  }

  const newSource = el.target.value;
  el.source.value = newSource;
  el.target.value = newTarget;

  // The translation becomes the new input, ready to translate back.
  if (state.lastTranslation) {
    el.input.value = state.lastTranslation.slice(0, CONFIG.maxChars);
    updateCount();
    clearOutput();
  }
  showDetected(null);
}

function clearAll() {
  hideError();
  stopSpeaking();
  el.input.value = '';
  updateCount();
  clearOutput();
  showDetected(null);
  el.input.focus();
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(area);
  return ok;
}

async function copyTranslation() {
  hideError();
  if (!state.lastTranslation) {
    showError('There is no translation to copy yet.');
    return;
  }

  let ok = false;
  try {
    await navigator.clipboard.writeText(state.lastTranslation);
    ok = true;
  } catch {
    ok = legacyCopy(state.lastTranslation);
  }

  if (!ok) {
    showError('Copying failed. Select the translated text and copy it manually.');
    return;
  }
  el.copyLabel.textContent = 'Copied!';
  setTimeout(() => { el.copyLabel.textContent = 'Copy Translation'; }, 1600);
}

/* ---------- Text to speech (Web Speech API) ---------- */

function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  el.speak.classList.remove('is-speaking');
}

function speakTranslation() {
  hideError();

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    showError('Your browser does not support text to speech.');
    return;
  }
  if (!state.lastTranslation) {
    showError('Translate some text first, then listen to it.');
    return;
  }
  if (window.speechSynthesis.speaking) {
    stopSpeaking();
    return;
  }

  const lang = getLang(state.outputLang);
  const wanted = lang.speech.toLowerCase();
  const base = wanted.split('-')[0];
  const voices = window.speechSynthesis.getVoices();
  const norm = (v) => v.lang.toLowerCase().replace('_', '-');
  const voice = voices.find((v) => norm(v) === wanted) || voices.find((v) => norm(v).split('-')[0] === base);

  if (voices.length && !voice) {
    showError(`No ${shortName(state.outputLang)} voice is installed on this device. Add one in your system's speech settings.`);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(state.lastTranslation);
  utterance.lang = lang.speech;
  if (voice) utterance.voice = voice;
  utterance.onstart = () => el.speak.classList.add('is-speaking');
  utterance.onend = () => el.speak.classList.remove('is-speaking');
  utterance.onerror = () => el.speak.classList.remove('is-speaking');
  window.speechSynthesis.speak(utterance);
}

/* ---------- Setup ---------- */

function fillSelect(select, withAuto, selected) {
  const options = withAuto ? [{ code: 'auto', name: 'Detect language' }, ...LANGUAGES] : LANGUAGES;
  for (const lang of options) {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name;
    select.appendChild(opt);
  }
  select.value = selected;
}

function init() {
  fillSelect(el.source, true, 'en');
  fillSelect(el.target, false, 'hi');
  updateCount();

  el.translate.addEventListener('click', handleTranslate);
  el.clear.addEventListener('click', clearAll);
  el.swap.addEventListener('click', swapLanguages);
  el.copy.addEventListener('click', copyTranslation);
  el.speak.addEventListener('click', speakTranslation);
  el.input.addEventListener('input', () => { updateCount(); if (!el.error.hidden) hideError(); });

  el.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleTranslate();
    }
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      el.input.value = chip.dataset.text;
      el.source.value = chip.dataset.from;
      el.target.value = chip.dataset.to;
      updateCount();
      handleTranslate();
    });
  });

  // Some browsers load speech voices asynchronously; this warms the list up.
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
}

init();
