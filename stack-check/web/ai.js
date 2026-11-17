// AI Stack Check: Firebase AI Logic hybrid inference (Gemini Nano in Chrome, Gemini in the cloud as fallback).
// Copyright 2026 Munim, Inc. Licensed under the Apache License, Version 2.0 (Apache-2.0).
// Made by MV2 of Munim, Inc. with AI agents.
import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/13.3.0';

let modPromise = null;
let appState = null;

/** True when this deployment has a Firebase project configured. */
export function aiConfigured() {
  return !!(firebaseConfig && firebaseConfig.projectId);
}

async function loadSdk() {
  if (!modPromise) {
    modPromise = Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-ai.js`),
      import(`${SDK}/firebase-app-check.js`),
    ]);
  }
  return modPromise;
}

async function init() {
  if (appState) return appState;
  const [appMod, aiMod, checkMod] = await loadSdk();
  const app = appMod.initializeApp(firebaseConfig);
  // App Check with reCAPTCHA v3 (free, no billing account needed).
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    // Local development only: Firebase prints a debug token to register in the console.
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (appCheckSiteKey) {
    checkMod.initializeAppCheck(app, {
      provider: new checkMod.ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  const ai = aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() });
  appState = { aiMod, ai, models: {} };
  return appState;
}

/**
 * Which on-device status Chrome reports, without downloading anything:
 * 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api'.
 */
export async function deviceModelStatus() {
  try {
    if (typeof LanguageModel === 'undefined' || !LanguageModel.availability) return 'no-api';
    return await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  } catch (e) {
    return 'unavailable';
  }
}

/**
 * Run one prompt. privacy: 'device-only' (never leaves the computer) or 'hybrid' (on-device first,
 * cloud fallback with the same redacted prompt). Must be called from a click handler.
 * Returns { text, source } where source is the SDK's inferenceSource.
 */
export async function explain(prompt, systemText, schema, privacy, onProgress) {
  const { aiMod, ai, models } = await init();
  const mode = privacy === 'device-only' ? aiMod.InferenceMode.ONLY_ON_DEVICE : aiMod.InferenceMode.PREFER_ON_DEVICE;
  const key = String(mode);
  if (!models[key]) {
    models[key] = aiMod.getGenerativeModel(ai, {
      mode,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          initialPrompts: [{ role: 'system', content: systemText }],
        },
      },
      inCloudParams: {
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 2048 },
        systemInstruction: systemText,
      },
    });
    if (typeof models[key].initializeDeviceModel === 'function') {
      try {
        models[key].initializeDeviceModel((p) => onProgress && onProgress(p));
      } catch (e) {
        // No on-device model here; PREFER_ON_DEVICE falls back to the cloud, ONLY_ON_DEVICE will throw below.
      }
    }
  }
  const result = await models[key].generateContent(prompt);
  return { text: result.response.text(), source: result.response.inferenceSource || '' };
}
