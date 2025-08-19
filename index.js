/* Smart Sound Triggers for SillyTavern
   - Context-aware heuristics (no blind keyword match)
   - Sound variations & cooldowns
   - Simple user library via settings (URLs)
*/

import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "st-sound-triggers";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName] = extension_settings[extensionName] || {};

const defaultSettings = {
  enabled: true,
  volume: 0.8,
  cooldown: 2.5, // per-action cooldown in seconds
  // user-supplied sounds are stored as { action: 'laugh', url: '...' }
  userSounds: []
};

// --- small action dictionary: verbs & patterns
const ACTION_DEFINITIONS = {
  laugh: {
    words: ["laugh", "laughed", "laughing", "giggle", "giggled", "giggling", "chuckle", "chuckled", "chuckling", "snicker", "snickered", "cackle"],
    nounForms: ["laugh"], // when used as noun (e.g., "a laugh")
    defaultVariants: [
      `${extensionFolderPath}/sounds/laugh/laugh1.mp3`,
      `${extensionFolderPath}/sounds/laugh/laugh2.mp3`
    ]
  },
  footstep: {
    words: ["step","steps","stepped","walking","walked","footstep","footsteps","stomp","stomped"],
    nounForms: ["footstep","step"],
    defaultVariants: [
      `${extensionFolderPath}/sounds/footstep/step1.mp3`,
      `${extensionFolderPath}/sounds/footstep/step2.mp3`
    ]
  },
  rustle: {
    words: ["rustle","rustled","rustling","rummage","rummaged","shuffle","shuffled","grabbed","grabs","grabbing","fumble","fumbled"],
    nounForms: ["rustle","shuffle"],
    defaultVariants: [
      `${extensionFolderPath}/sounds/rustle/rustle1.mp3`,
      `${extensionFolderPath}/sounds/rustle/rustle2.mp3`
    ]
  },
  door: {
    words: ["open","opened","opens","close","closed","closing","shut","shuts"],
    nounForms: ["door"],
    defaultVariants: [
      `${extensionFolderPath}/sounds/door/open1.mp3`,
      `${extensionFolderPath}/sounds/door/close1.mp3`
    ]
  },
  sneeze: {
    words: ["sneeze","sneezed","sneezing","achoo"],
    nounForms: ["sneeze"],
    defaultVariants: [
      `${extensionFolderPath}/sounds/sneeze/sneeze1.mp3`,
      `${extensionFolderPath}/sounds/sneeze/sneeze2.mp3`
    ]
  },
  gasp: {
    words: ["gasp","gasped","gasping","caught breath","caught my breath"],
    nounForms: ["gasp"],
    defaultVariants: [
      `${extensionFolderPath}/sounds/gasp/gasp1.mp3`,
      `${extensionFolderPath}/sounds/gasp/gasp2.mp3`
    ]
  }
};

// internal state
const lastPlayed = {};
const lastVariantIndex = {};
let soundLibrary = {}; // action -> array of urls

// Load settings (create defaults if absent)
async function loadSettings() {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  Object.assign(extension_settings[extensionName], Object.assign({}, defaultSettings, extension_settings[extensionName]));
  // Ensure fields exist
  if (!Array.isArray(extension_settings[extensionName].userSounds))
    extension_settings[extensionName].userSounds = [];

  // init sound library from defaults + user-sounds
  buildSoundLibrary();
  // update UI values if present
  $("#sst_enable").prop("checked", extension_settings[extensionName].enabled);
  $("#sst_volume").val(extension_settings[extensionName].volume);
  $("#sst_cooldown").val(extension_settings[extensionName].cooldown);
  renderSoundList();
}

// Build sound library from ACTION_DEFINITIONS + user-sounds
function buildSoundLibrary() {
  soundLibrary = {};
  Object.keys(ACTION_DEFINITIONS).forEach(action=>{
    soundLibrary[action] = (ACTION_DEFINITIONS[action].defaultVariants || []).slice();
  });
  // Add user sounds
  extension_settings[extensionName].userSounds.forEach(s=>{
    soundLibrary[s.action] = soundLibrary[s.action] || [];
    soundLibrary[s.action].push(s.url);
  });
}

// Minimal helper: sanitize & tokenize
function wordsFrom(text) {
  return text
    .replace(/[^\w\s']/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// Heuristic engine: returns list of actions with score
function analyzeTextForActions(text) {
  const lower = text.toLowerCase();
  const tokens = wordsFrom(text);
  const results = [];

  // quick negation detection around a word (small window)
  function hasNegationBefore(idx) {
    const negations = ["stop","don't","do","do not","never","without","no","not","avoid"];
    const windowStart = Math.max(0, idx - 3);
    for (let i = windowStart; i < idx; i++) {
      if (negations.includes(tokens[i])) return true;
    }
    return false;
  }

  // helper: is the target used as noun phrase like "a laugh" or "your laugh"
  function isNounUsage(term) {
    const nounPattern = new RegExp(`\\b(a|an|the|your|my|his|her)\\s+\\w*${term}\\b`, 'i');
    return nounPattern.test(text);
  }

  Object.entries(ACTION_DEFINITIONS).forEach(([action, def])=>{
    let bestScore = 0;
    def.words.forEach((w)=>{
      // find occurrences
      // exact token match if present
      for (let i=0;i<tokens.length;i++){
        if (tokens[i] === w || tokens[i].startsWith(w)) {
          // base score
          let score = 0.5;

          // prefer verb-ish forms (ing, ed, s) or multiword "is laughing"/"was laughing"
          if (/\b(is|was|were|are|am|been|be)\b\s+\w*${w}\b/i.test(lower) || /ing$/.test(w) || /ed$/.test(w) || /s$/.test(w)) {
            score += 0.35;
          }

          // if surrounding words include action subjects (he/she/they/character names) add small bonus
          const subjWindow = tokens.slice(Math.max(0,i-3), i+1).join(' ');
          if (/\b(he|she|they|i|we|you)\b/.test(subjWindow)) score += 0.12;

          // if used as noun -> heavy penalty
          if (def.nounForms && def.nounForms.some(n=> isNounUsage(n))) {
            score -= 1.0;
          }

          // negation check
          if (hasNegationBefore(i) || /\bstop(ped|ing)?\b/.test(lower) || /\bdon't\b|\bdo not\b/.test(lower)) {
            score -= 1.0;
          }

          if (score > bestScore) bestScore = score;
        }
      }
    });

    // Additional pattern: explicit past/prog forms e.g., "she laughed", "they are laughing"
    if (new RegExp(`\\b(${def.words.join("|")})\\b`, 'i').test(lower)) {
      // raise bestScore slightly
      bestScore = Math.max(bestScore, 0.6);
    }

    if (bestScore > 0.5) {
      results.push({ action, score: bestScore });
    }
  });

  // sort by score desc
  results.sort((a,b)=>b.score-a.score);
  return results;
}

// choose a variant (avoid immediate repetition)
function chooseVariant(action) {
  const list = (soundLibrary[action] || []).slice();
  if (!list.length) return null;
  // choose random but not same as last
  let idx = Math.floor(Math.random()*list.length);
  if (list.length > 1 && idx === (lastVariantIndex[action]||-1)) {
    idx = (idx + 1) % list.length;
  }
  lastVariantIndex[action] = idx;
  return list[idx];
}

// play sound with volume and cooldown checks
function playSound(action) {
  const now = Date.now()/1000;
  const cooldown = Number(extension_settings[extensionName].cooldown) || 2.5;
  if (lastPlayed[action] && (now - lastPlayed[action]) < cooldown) return false;
  const url = chooseVariant(action);
  if (!url) return false;

  const audio = new Audio(url);
  audio.volume = Number(extension_settings[extensionName].volume) || 0.8;
  audio.play().catch(err=>{
    // won't crash ST if audio blocked
    console.warn("SST: audio play failed", err);
  });
  lastPlayed[action] = now;
  return true;
}

// Main handler (message events)
function onMessageReceived(evt) {
  try {
    if (!extension_settings[extensionName].enabled) return;
    // evt.data might have message contents depending on event shape
    // SillyTavern events often pass an object; guard accordingly:
    const payload = evt?.data || evt;
    // message text might be in payload.text or payload.content depending on event
    const text = (payload && (payload.text || payload.content || payload.message || payload.body)) || ('' + payload);
    if (!text || typeof text !== 'string') return;

    // analyze
    const actions = analyzeTextForActions(text);
    // For each candidate action, attempt to play (stop after first successful to avoid many overlapping sounds)
    for (let a of actions) {
      const played = playSound(a.action);
      if (played) break;
    }
  } catch (e) {
    console.error("SST: onMessageReceived error", e);
  }
}

// --- UI handlers
function renderSoundList() {
  const $list = $("#sst_sound_list");
  $list.empty();
  const all = extension_settings[extensionName].userSounds || [];
  if (!all.length) {
    $list.text("(no custom sounds)");
    return;
  }
  all.forEach((s, idx)=>{
    const $b = $(`<div style="margin:4px 0;"><a href="#" class="sst-remove" data-idx="${idx}" title="Click to remove">${s.action} → ${s.url}</a></div>`);
    $list.append($b);
  });
}

function addUserSound(action, url) {
  extension_settings[extensionName].userSounds = extension_settings[extensionName].userSounds || [];
  extension_settings[extensionName].userSounds.push({ action, url });
  saveSettingsDebounced();
  buildSoundLibrary();
  renderSoundList();
}

// wire UI + settings persistence
jQuery(async ()=> {
  // append settings HTML
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
  $("#extensions_settings").append(settingsHtml);

  // load settings into UI
  loadSettings();

  // UI interactions
  $("#sst_enable").on("input change", (e)=>{
    extension_settings[extensionName].enabled = Boolean($(e.target).prop("checked"));
    saveSettingsDebounced();
  });

  $("#sst_volume").on("input change", (e)=>{
    extension_settings[extensionName].volume = Number($(e.target).val());
    saveSettingsDebounced();
  });

  $("#sst_cooldown").on("input change", (e)=>{
    extension_settings[extensionName].cooldown = Number($(e.target).val());
    saveSettingsDebounced();
  });

  $("#sst_add_sound").on("click", ()=>{
    const url = $("#sst_new_sound_url").val().trim();
    const action = $("#sst_new_sound_action").val();
    if (!url) {
      toastr.warning("Provide a sound URL or relative path.");
      return;
    }
    addUserSound(action, url);
    $("#sst_new_sound_url").val("");
  });

  $("#sst_sound_list").on("click", ".sst-remove", function(e){
    e.preventDefault();
    const idx = Number($(this).data("idx"));
    extension_settings[extensionName].userSounds.splice(idx, 1);
    saveSettingsDebounced();
    buildSoundLibrary();
    renderSoundList();
  });

  // subscribe to ST events: MESSAGE_RECEIVED (incoming / completed message)
  try {
    // eventSource and event_types are available in ST UI environment
    if (typeof eventSource !== "undefined" && typeof event_types !== "undefined") {
      eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
      // also listen to CHARACTER_MESSAGE_RENDERED if present (for streaming completions)
      if (event_types.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);
      }
    } else if (window.SillyTavern && SillyTavern.getContext) {
      // fallback: subscribe through SillyTavern API if present
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.eventSource && ctx.event_types) {
        ctx.eventSource.on(ctx.event_types.MESSAGE_RECEIVED, onMessageReceived);
      }
    } else {
      console.warn("SST: No eventSource/event_types - unable to auto-listen to messages.");
    }
  } catch (e) {
    console.error("SST: event subscription error", e);
  }

});
