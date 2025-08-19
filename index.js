// SillyTavern Contextual Sound Effects Extension
// Plays sound effects based on actions and dialogue with AI-assisted context analysis

import { eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';

// Extension configuration
const extensionName = 'st-context-sounds';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const MODULE_NAME = 'ContextSounds';

// Default settings
const defaultSettings = {
    enabled: true,
    volume: 0.7,
    maxConcurrentSounds: 3,
    preventRepeatMs: 2000,
    contextSensitivity: 0.8,
    soundVariations: true,
    debugMode: false,
    useAiAnalysis: false,
    aiAnalysisTimeout: 5000,
    enabledCategories: {
        emotions: true,
        actions: true,
        ambient: true,
        dialogue: true
    }
};

// Sound library with context-aware patterns
const soundLibrary = {
    emotions: {
        laugh: {
            variations: ['laugh1.mp3', 'giggle.mp3', 'chuckle.mp3'],
            patterns: [
                { regex: /\b(laughed|laughing|giggles?|giggling|chuckles?|chuckling)\b/gi, context: 'action' },
                { regex: /\b(haha|hehe|lol)\b/gi, context: 'direct' },
                { regex: /"[^"]*(?:ha|he){2,}[^"]*"/gi, context: 'dialogue' }
            ],
            excludePatterns: [
                /\b(?:don't|stop|quit|without|no|never)\s+(?:\w+\s+){0,2}(?:laugh|giggl|chuckl)/gi,
                /\b(?:laugh|giggl|chuckl)\w*\s+(?:at|about|over)\b/gi
            ]
        },
        cry: {
            variations: ['cry1.mp3', 'sob.mp3', 'weep.mp3'],
            patterns: [
                { regex: /\b(cried|crying|sobbed|sobbing|wept|weeping|tears?\s+(?:fell|stream|flow))/gi, context: 'action' },
                { regex: /"[^"]*(?:\*sniff\*|\*sob\*).*"/gi, context: 'dialogue' }
            ],
            excludePatterns: [
                /\b(?:don't|stop|quit|without|no)\s+(?:\w+\s+){0,2}(?:cry|sob|weep)/gi
            ]
        },
        sigh: {
            variations: ['sigh1.mp3', 'exhale.mp3'],
            patterns: [
                { regex: /\b(sighed|sighing)\b/gi, context: 'action' },
                { regex: /"[^"]*\*sigh\*[^"]*"/gi, context: 'dialogue' }
            ]
        }
    },
    actions: {
        footsteps: {
            variations: ['step1.mp3', 'step2.mp3', 'footsteps.mp3'],
            patterns: [
                { regex: /\b(walked|walking|stepped|stepping|strolled|strolling|paced|pacing)\b/gi, context: 'action' },
                { regex: /\bfootsteps?\b/gi, context: 'direct' }
            ],
            excludePatterns: [
                /\b(?:stopped|quit|ceased)\s+(?:\w+\s+){0,2}(?:walk|step|stroll|pac)/gi
            ]
        },
        door: {
            variations: ['door_open.mp3', 'door_close.mp3', 'door_creak.mp3'],
            patterns: [
                { regex: /\b(?:opened|closed|shut|slammed)\s+(?:the\s+)?door\b/gi, context: 'action' },
                { regex: /\bdoor\s+(?:opened|closed|creaked|slammed)\b/gi, context: 'action' }
            ]
        }
    },
    ambient: {
        wind: {
            variations: ['wind1.mp3', 'breeze.mp3'],
            patterns: [
                { regex: /\bwind\s+(?:blew|howled|whistled|rustled)/gi, context: 'ambient' },
                { regex: /\b(?:gentle|strong|cold)\s+(?:breeze|wind)\b/gi, context: 'ambient' }
            ]
        },
        rain: {
            variations: ['rain_light.mp3', 'rain_heavy.mp3'],
            patterns: [
                { regex: /\brain\s+(?:fell|pattered|drummed|began)/gi, context: 'ambient' },
                { regex: /\b(?:raindrops?|downpour|drizzl\w+)\b/gi, context: 'ambient' }
            ]
        }
    },
    dialogue: {
        whisper: {
            variations: ['whisper1.mp3', 'whisper_soft.mp3'],
            patterns: [
                { regex: /\b(whispered|whispering)\b/gi, context: 'dialogue' },
                { regex: /"[^"]*"\s*(?:she|he|they)\s+whispered/gi, context: 'dialogue' }
            ]
        },
        shout: {
            variations: ['shout1.mp3', 'yell.mp3'],
            patterns: [
                { regex: /\b(shouted|yelled|screamed|called out)\b/gi, context: 'dialogue' },
                { regex: /"[^"]*[!]{2,}[^"]*"/gi, context: 'dialogue' }
            ]
        }
    }
};

// Extension state
let extensionState = {
    audioContext: null,
    audioBuffers: new Map(),
    recentSounds: new Map(),
    loadingPromises: new Map(),
    isInitialized: false
};

// Settings management
function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }

    // Ensure all default keys exist
    for (const key in defaultSettings) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }

    return extension_settings[extensionName];
}

// Context analysis engine
class ContextAnalyzer {
    constructor() {
        this.sentimentWords = {
            positive: ['happy', 'joy', 'cheerful', 'delighted', 'pleased', 'content'],
            negative: ['sad', 'angry', 'frustrated', 'disappointed', 'upset', 'annoyed'],
            neutral: ['said', 'replied', 'responded', 'mentioned', 'noted']
        };
    }

    async analyzeContext(text, soundKey, pattern) {
        const lowerText = text.toLowerCase();
        const match = pattern.regex.exec(text);
        
        if (!match) return { score: 0, reason: 'no_match' };

        const context = {
            sentence: this.extractSentence(text, match.index),
            surrounding: this.getSurroundingWords(text, match.index, 10),
            position: match.index / text.length,
            match: match[0]
        };

        // Check for negation patterns first (highest priority)
        const category = this.getCategoryForSound(soundKey);
        const soundData = soundLibrary[category]?.[soundKey];
        
        if (soundData?.excludePatterns) {
            for (const excludePattern of soundData.excludePatterns) {
                if (excludePattern.test(context.sentence)) {
                    return { score: 0, reason: 'excluded_by_pattern', context };
                }
            }
        }

        // Pattern-based analysis
        let score = 0.5; // Base score

        // Pattern-specific scoring
        switch (pattern.context) {
            case 'action':
                score += this.analyzeActionContext(context, soundKey);
                break;
            case 'dialogue':
                score += this.analyzeDialogueContext(context, soundKey);
                break;
            case 'ambient':
                score += this.analyzeAmbientContext(context, soundKey);
                break;
            case 'direct':
                score += 0.3; // Direct mentions get bonus
                break;
        }

        // Sentiment alignment
        score += this.analyzeSentiment(context, soundKey);

        return { 
            score: Math.max(0, Math.min(1, score)), 
            reason: 'pattern_analyzed',
            context,
            match: match[0]
        };
    }

    extractSentence(text, position) {
        const sentences = text.split(/[.!?]+/);
        let currentPos = 0;
        
        for (const sentence of sentences) {
            if (currentPos + sentence.length > position) {
                return sentence.trim();
            }
            currentPos += sentence.length + 1;
        }
        return '';
    }

    getSurroundingWords(text, position, wordCount = 5) {
        const words = text.split(/\s+/);
        let currentPos = 0;
        let wordIndex = 0;

        for (let i = 0; i < words.length; i++) {
            if (currentPos > position) {
                wordIndex = i;
                break;
            }
            currentPos += words[i].length + 1;
        }

        const start = Math.max(0, wordIndex - wordCount);
        const end = Math.min(words.length, wordIndex + wordCount);
        return words.slice(start, end).join(' ');
    }

    analyzeActionContext(context, soundKey) {
        let score = 0;
        
        // Look for action verbs in past tense (more definitive)
        if (/\b\w+ed\b/.test(context.sentence)) score += 0.2;
        
        // Present continuous suggests ongoing action
        if (/\b\w+ing\b/.test(context.sentence)) score += 0.1;
        
        // Character attribution
        if (/\b(?:she|he|they|I)\s+\w+ed\b/.test(context.sentence)) score += 0.15;
        
        return score;
    }

    analyzeDialogueContext(context, soundKey) {
        let score = 0;
        
        // Quoted speech
        if (context.sentence.includes('"')) score += 0.2;
        
        // Dialogue tags
        if (/\b(?:said|whispered|shouted|asked|replied)\b/.test(context.sentence)) score += 0.15;
        
        return score;
    }

    analyzeAmbientContext(context, soundKey) {
        let score = 0;
        
        // Environmental descriptions
        if (/\b(?:outside|air|atmosphere|environment|weather)\b/.test(context.surrounding)) {
            score += 0.2;
        }
        
        return score;
    }

    analyzeSentiment(context, soundKey) {
        let score = 0;
        const sentence = context.sentence.toLowerCase();
        
        // Match sentiment with sound type
        if (soundKey.includes('laugh') || soundKey.includes('giggle')) {
            if (this.sentimentWords.positive.some(word => sentence.includes(word))) {
                score += 0.1;
            }
        } else if (soundKey.includes('cry') || soundKey.includes('sob')) {
            if (this.sentimentWords.negative.some(word => sentence.includes(word))) {
                score += 0.1;
            }
        }
        
        return score;
    }

    getCategoryForSound(soundKey) {
        for (const [category, sounds] of Object.entries(soundLibrary)) {
            if (sounds[soundKey]) {
                return category;
            }
        }
        return null;
    }
}

// Audio management
class AudioManager {
    constructor() {
        this.contextAnalyzer = new ContextAnalyzer();
    }

    async initialize() {
        try {
            extensionState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await this.loadDefaultSounds();
            extensionState.isInitialized = true;
            console.log('[Context Sounds] Audio system initialized');
        } catch (error) {
            console.error('[Context Sounds] Failed to initialize audio:', error);
        }
    }

    async loadDefaultSounds() {
        const loadPromises = [];
        
        for (const [category, sounds] of Object.entries(soundLibrary)) {
            if (!getSettings().enabledCategories[category]) continue;
            
            for (const [soundKey, soundData] of Object.entries(sounds)) {
                for (const variation of soundData.variations) {
                    const soundPath = `${extensionFolderPath}/sounds/${variation}`;
                    loadPromises.push(this.loadSound(soundPath, `${soundKey}_${variation}`));
                }
            }
        }

        await Promise.allSettled(loadPromises);
    }

    async loadSound(path, key) {
        if (extensionState.loadingPromises.has(key)) {
            return extensionState.loadingPromises.get(key);
        }

        const loadPromise = this.fetchAndDecodeAudio(path, key);
        extensionState.loadingPromises.set(key, loadPromise);
        
        try {
            await loadPromise;
        } catch (error) {
            console.warn(`[Context Sounds] Could not load sound: ${path}`, error);
        }
        
        return loadPromise;
    }

    async fetchAndDecodeAudio(path, key) {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await extensionState.audioContext.decodeAudioData(arrayBuffer);
        
        extensionState.audioBuffers.set(key, audioBuffer);
        return audioBuffer;
    }

    async playSound(soundKey, text, variation = null) {
        if (!extensionState.isInitialized || !getSettings().enabled) return;

        const category = this.contextAnalyzer.getCategoryForSound(soundKey);
        if (!category || !getSettings().enabledCategories[category]) return;

        const soundData = soundLibrary[category][soundKey];
        if (!soundData) return;

        // Prevent sound spam
        const now = Date.now();
        const lastPlayed = extensionState.recentSounds.get(soundKey) || 0;
        if (now - lastPlayed < getSettings().preventRepeatMs) {
            if (getSettings().debugMode) {
                console.log(`[Context Sounds] Prevented repeat of ${soundKey}`);
            }
            return;
        }

        // Context analysis
        let bestMatch = null;
        let bestScore = 0;

        for (const pattern of soundData.patterns) {
            const analysis = await this.contextAnalyzer.analyzeContext(text, soundKey, pattern);
            
            if (analysis.score > bestScore && analysis.score >= getSettings().contextSensitivity) {
                bestScore = analysis.score;
                bestMatch = analysis;
            }
        }

        if (!bestMatch || bestScore < getSettings().contextSensitivity) {
            if (getSettings().debugMode) {
                console.log(`[Context Sounds] Context check failed for ${soundKey}, score: ${bestScore}`);
            }
            return;
        }

        // Select variation
        const variations = soundData.variations;
        const selectedVariation = variation || variations[Math.floor(Math.random() * variations.length)];
        const audioKey = `${soundKey}_${selectedVariation}`;

        if (!extensionState.audioBuffers.has(audioKey)) {
            console.warn(`[Context Sounds] Audio buffer not found: ${audioKey}`);
            return;
        }

        // Play the sound
        try {
            const source = extensionState.audioContext.createBufferSource();
            const gainNode = extensionState.audioContext.createGain();
            
            source.buffer = extensionState.audioBuffers.get(audioKey);
            gainNode.gain.value = getSettings().volume;
            
            source.connect(gainNode);
            gainNode.connect(extensionState.audioContext.destination);
            
            source.start();
            
            extensionState.recentSounds.set(soundKey, now);
            
            if (getSettings().debugMode) {
                console.log(`[Context Sounds] Played ${audioKey} (score: ${bestScore.toFixed(2)}, match: "${bestMatch.match}")`);
            }
            
        } catch (error) {
            console.error('[Context Sounds] Error playing sound:', error);
        }
    }

    async processMessage(messageText) {
        if (!messageText || !extensionState.isInitialized) return;

        const promises = [];
        
        for (const [category, sounds] of Object.entries(soundLibrary)) {
            if (!getSettings().enabledCategories[category]) continue;
            
            for (const [soundKey, soundData] of Object.entries(sounds)) {
                for (const pattern of soundData.patterns) {
                    if (pattern.regex.test(messageText)) {
                        promises.push(this.playSound(soundKey, messageText));
                        break; // Only one pattern per sound per message
                    }
                }
            }
        }

        // Limit concurrent sounds
        const maxConcurrent = getSettings().maxConcurrentSounds;
        if (promises.length > maxConcurrent) {
            promises.splice(maxConcurrent);
        }

        await Promise.allSettled(promises);
    }
}

// Event handlers
async function onMessageReceived(data) {
    if (!data?.message?.mes) return;
    await audioManager.processMessage(data.message.mes);
}

function onEnabledToggle() {
    const enabled = $('#context-sounds-enabled').prop('checked');
    getSettings().enabled = enabled;
    saveSettingsDebounced();
    
    if (enabled && !extensionState.isInitialized) {
        audioManager.initialize();
    }
}

function onVolumeChange() {
    const volume = parseFloat($('#context-sounds-volume').val());
    getSettings().volume = volume;
    $('#context-sounds-volume-display').text(`${Math.round(volume * 100)}%`);
    saveSettingsDebounced();
}

function onCategoryToggle(category) {
    const enabled = $(`#context-sounds-category-${category}`).prop('checked');
    getSettings().enabledCategories[category] = enabled;
    saveSettingsDebounced();
}

function onSensitivityChange() {
    const sensitivity = parseFloat($('#context-sounds-sensitivity').val());
    getSettings().contextSensitivity = sensitivity;
    $('#context-sounds-sensitivity-display').text(`${Math.round(sensitivity * 100)}%`);
    saveSettingsDebounced();
}

function onTestSound() {
    const testText = $('#context-sounds-test-text').val() || "She laughed at the joke and walked to the door.";
    audioManager.processMessage(testText);
}

// UI Setup
async function loadSettingsUI() {
    const settings = getSettings();
    
    $('#context-sounds-enabled').prop('checked', settings.enabled);
    $('#context-sounds-volume').val(settings.volume);
    $('#context-sounds-volume-display').text(`${Math.round(settings.volume * 100)}%`);
    $('#context-sounds-sensitivity').val(settings.contextSensitivity);
    $('#context-sounds-sensitivity-display').text(`${Math.round(settings.contextSensitivity * 100)}%`);
    
    // Category toggles
    for (const category of Object.keys(settings.enabledCategories)) {
        $(`#context-sounds-category-${category}`).prop('checked', settings.enabledCategories[category]);
    }
}

// Initialize extension
const audioManager = new AudioManager();

jQuery(async () => {
    console.log('[Context Sounds] Loading extension...');
    
    try {
        // Load HTML UI
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);
        
        // Bind event handlers
        $('#context-sounds-enabled').on('change', onEnabledToggle);
        $('#context-sounds-volume').on('input', onVolumeChange);
        $('#context-sounds-sensitivity').on('input', onSensitivityChange);
        $('#context-sounds-test').on('click', onTestSound);
        
        // Category toggles
        for (const category of Object.keys(defaultSettings.enabledCategories)) {
            $(`#context-sounds-category-${category}`).on('change', () => onCategoryToggle(category));
        }
        
        // Load settings
        await loadSettingsUI();
        
        // Listen for message events
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        
        // Initialize audio if enabled
        if (getSettings().enabled) {
            await audioManager.initialize();
        }
        
        console.log('[Context Sounds] Extension loaded successfully');
        
    } catch (error) {
        console.error('[Context Sounds] Failed to load extension:', error);
    }
});

export { MODULE_NAME };
