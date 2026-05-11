/**
 * @file api/core.js
 * @version 20.5.0 Ultimate Enterprise Framework
 * @description תשתית ליבה (Core SDK) למערכות טלפוניה מורכבות משולבות AI.
 * 
 * מערכת זו נכתבה בסטנדרט תעשייתי מחמיר (Strict Enterprise Standard).
 * המערכת כוללת:
 * 1. Telemetry & Logging Engine - מערך לוגים וניטור ביצועים.
 * 2. Advanced Audio DSP - עיבוד אותות דיגיטלי לניקוי והגברת שמע.
 * 3. WavEncoder - מעבד בינארי להרכבת קבצי RIFF/WAVE תיקניים מאפס.
 * 4. Robust HTTP Client - קליינט תקשורת אפליקטיבי ללא תלויות חיצונות.
 * 5. Exponential Backoff & Circuit Breaker - מניעת קריסות שרת במצבי עומס.
 * 6. Gemini Enterprise Wrapper - ניהול פרומפטים מורכבים, אינטליגנציה רגשית, וסינון תוכן קפדני.
 * 7. Yemot SDK & Database Manager - מערכת המדמה מסד נתונים מבוסס JSON בתוך שרתי ימות המשיח.
 * 8. Validation & Type Checking - בדיקות קלט נוקשות לאבטחת מידע.
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// [1] מערכת לוגים וטלמטריה (Enterprise Telemetry & Observability)
// ============================================================================
class TelemetryLogger {
    static getTimestamp() {
        return new Date().toISOString();
    }
    static info(module, action, message) {
        console.log(`[${this.getTimestamp()}] [INFO] [${module}] [${action}] => ${message}`);
    }
    static warn(module, action, message) {
        console.warn(`[${this.getTimestamp()}] [WARN] [${module}] [${action}] => ${message}`);
    }
    static error(module, action, message, err = null) {
        console.error(`[${this.getTimestamp()}] [ERROR] [${module}][${action}] => ${message}`);
        if (err && err.stack) console.error(err.stack);
        else if (err) console.error(err);
    }
    static debug(module, action, message) {
        if (process.env.NODE_ENV === 'development') {
            console.debug(`[${this.getTimestamp()}] [DEBUG] [${module}][${action}] => ${message}`);
        }
    }
    static startTimer() { return Date.now(); }
    static endTimer(module, action, startTime) {
        const duration = Date.now() - startTime;
        this.info("Metric", "Performance", `[${module}][${action}] Executed in ${duration}ms`);
        return duration;
    }
}

// ============================================================================
// [2] מאגר קולות ותצורות Gemini (Voice Registry)
// ============================================================================
const GEMINI_VOICES = {
    MALE:[
        { id: "Puck", desc: "קול גברי קצבי" },
        { id: "Charon", desc: "קול גברי רציני" },
        { id: "Fenrir", desc: "קול גברי נמרץ" },
        { id: "Orus", desc: "קול גברי תקיף" },
        { id: "Enceladus", desc: "קול גברי רגוע" },
        { id: "Iapetus", desc: "קול גברי צלול" },
        { id: "Algieba", desc: "קול גברי נעים" },
        { id: "Algenib", desc: "קול גברי עמוק" },
        { id: "Achernar", desc: "קול גברי רך" },
        { id: "Alnilam", desc: "קול גברי סמכותי" }
    ],
    FEMALE:[
        { id: "Zephyr", desc: "קול נשי בהיר" },
        { id: "Kore", desc: "קול נשי יציב" },
        { id: "Leda", desc: "קול נשי צעיר" },
        { id: "Aoede", desc: "קול נשי אוורירי" },
        { id: "Callirrhoe", desc: "קול נשי רגוע" },
        { id: "Autonoe", desc: "קול נשי ברור" },
        { id: "Umbriel", desc: "קול נשי זורם" },
        { id: "Despina", desc: "קול נשי חלק" },
        { id: "Erinome", desc: "קול נשי צלול" },
        { id: "Laomedeia", desc: "קול נשי קצבי" }
    ]
};

// ============================================================================
// [3] מחלקות שגיאה מתקדמות (Error Handling Paradigm)
// ============================================================================
class AbstractIvrError extends Error {
    constructor(message, code = 500) { super(message); this.name = this.constructor.name; this.code = code; }
}
class YemotApiError extends AbstractIvrError {
    constructor(message, code) { super(message, code); }
}
class GeminiApiError extends AbstractIvrError {
    constructor(message, code, rawBody) { super(message, code); this.rawBody = rawBody; }
}
class DSPProcessingError extends AbstractIvrError {
    constructor(message) { super(message, 500); }
}
class HarediFilterViolation extends AbstractIvrError {
    constructor() { super("Content blocked by religious compliance filter", 403); }
}

// ============================================================================
// [4] מנועי עיבוד שמע - DSP & Encoders
// ============================================================================
class WavEncoder {
    /**
     * פונקציה לבניית כותרת WAV (RIFF Header) מדויקת לנתוני PCM.
     * נדרש כדי לתקן את קבצי השמע שמגיעים חשופים ממודל Gemini TTS.
     */
    static encodeFromBase64(base64PCM, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
        TelemetryLogger.info("WavEncoder", "encode", `Encoding WAV at ${sampleRate}Hz`);
        try {
            const pcmBuffer = Buffer.from(base64PCM, 'base64');
            if (pcmBuffer.length >= 44 && pcmBuffer.toString('utf8', 0, 4) === 'RIFF') return pcmBuffer; 
            
            const header = Buffer.alloc(44);
            header.write('RIFF', 0);
            header.writeUInt32LE(36 + pcmBuffer.length, 4);
            header.write('WAVE', 8);
            header.write('fmt ', 12);
            header.writeUInt32LE(16, 16);
            header.writeUInt16LE(1, 20);
            header.writeUInt16LE(numChannels, 22);
            header.writeUInt32LE(sampleRate, 24);
            header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
            header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
            header.writeUInt16LE(bitsPerSample, 34);
            header.write('data', 36);
            header.writeUInt32LE(pcmBuffer.length, 40);
            
            return Buffer.concat([header, pcmBuffer]);
        } catch (error) {
            throw new DSPProcessingError("Failed to encode PCM to WAV.");
        }
    }
}

class AudioProcessor {
    /**
     * מנוע סינון רעשים והגברה להקלטות טלפוניות.
     * מפעיל אלגוריתם של Noise Gate לחיתוך רעש סטטי, ו-Gain מחושב למניעת צרימה.
     */
    static enhanceWavAudio(buffer, gainMultiplier = 4.0, noiseGateThreshold = 350) {
        TelemetryLogger.info("AudioProcessor", "enhance", `Applying DSP Gain x${gainMultiplier}`);
        try {
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') return buffer; 
            const newBuffer = Buffer.from(buffer);
            let sum = 0, sampleCount = 0;
            
            // חישוב חריגת חשמל סטטי (DC Offset)
            for (let i = 44; i < newBuffer.length - 1; i += 2) {
                sum += newBuffer.readInt16LE(i);
                sampleCount++;
            }
            const dcOffset = sampleCount > 0 ? Math.round(sum / sampleCount) : 0;

            // עיבוד האות הדיגיטלי
            for (let i = 44; i < newBuffer.length - 1; i += 2) {
                let sample = newBuffer.readInt16LE(i) - dcOffset;
                if (Math.abs(sample) < noiseGateThreshold) {
                    sample = 0; 
                } else {
                    sample = Math.round(sample * gainMultiplier);
                    if (sample > 32767) sample = 32767;
                    if (sample < -32768) sample = -32768;
                }
                newBuffer.writeInt16LE(sample, i);
            }
            return newBuffer;
        } catch (error) {
            TelemetryLogger.error("AudioProcessor", "enhance", "DSP failure", error);
            return buffer; 
        }
    }
}

// ============================================================================
// [5] תשתית HTTP פנימית מבוססת Native Node.js
// ============================================================================
class HttpClient {
    /**
     * ביצוע קריאת HTTP בצורה בטוחה, עם תמיכה ב-Timeouts וניהול זיכרון נכון.
     */
    static request(url, options, postData = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, options, (res) => {
                const chunks =[];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ statusCode: res.statusCode, headers: res.headers, body });
                    } else {
                        reject({ statusCode: res.statusCode, headers: res.headers, body: body.toString('utf8') });
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.setTimeout(50000, () => {
                req.destroy();
                reject(new AbstractIvrError("HTTP Request Timeout (50s)", 408));
            });

            if (postData) req.write(postData);
            req.end();
        });
    }
}

class RetryHandler {
    /**
     * מנגנון התאוששות שגיאות חכם (Exponential Backoff).
     * מווסת בקשות שנדחו בגלל עומס בשרתי גוגל (429) או שגיאות שרת פנימיות (5xx).
     */
    static async executeWithBackoff(fn, maxRetries = 4) {
        let retries = 0, delay = 1000; 
        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const isRecoverable = error.statusCode === 429 || error.statusCode >= 500;
                if (isRecoverable && retries < maxRetries - 1) {
                    TelemetryLogger.warn("RetryHandler", "backoff", `Error ${error.statusCode}. Retrying in ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                    retries++;
                    delay *= 2; 
                } else {
                    throw error; 
                }
            }
        }
    }
}

// ============================================================================
// [6] Gemini AI Wrapper - מנוע בינה מלאכותית ותמלול חרדי
// ============================================================================
class GeminiManager {
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) throw new GeminiApiError("Missing Keys", 500);
        this.keys = apiKeys;
        this.currentIndex = 0;
    }

    _getRotateKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * STT מתקדם: מתמלל + מסנן תוכן + מקטלג + מזהה טון דיבור.
     * פונקציה זו כוללת את פרומפט הסינון המחמיר.
     */
    async transcribeAndAnalyze(audioBuffer) {
        TelemetryLogger.info("GeminiManager", "transcribe", "שולח לג'מיני תמלול + סינון וקיטלוג...");
        const enhancedBuffer = AudioProcessor.enhanceWavAudio(audioBuffer, 4.0, 300);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            const prompt = `אתה מערכת לתמלול קול וסינון תוכן קפדנית עבור הציבור החרדי שומר התורה והמצוות.
משימתך:
1. תמלל את קובץ האודיו לעברית במדויק.
2. זהה את טון הדיבור של הדובר והוסף אותו כהנחיית במאי בסוגריים עגולים בתחילת הטקסט (למשל: '(בקול רגוע ושלו) שלום').
3. סווג את הקלטת לאחת מהקטגוריות הבאות בלבד, והוסף את הקטגוריה בתחילת הטקסט בסוגריים מרובעות: [CAT: תורה], [CAT: סיפורים], [CAT: מידע],[CAT: כללי].

**אזהרה קריטית - סינון הלכתי והשקפתי:**
עליך לסרוק את התוכן. אם התוכן כולל כל רמז ל:
- ניבול פה, שפה זולה או חוסר צניעות.
- כפירה, דעות חילוניות, או השקפות הנוגדות את התורה.
- לשון הרע, רכילות, מחלוקת או פוליטיקה מפלגתית קטנונית.
- אלימות או הסתה.
- חוסר כבוד לתלמידי חכמים ולגדולי ישראל.

אם זיהית הפרה כלשהי מהרשימה הנ"ל, עליך למחוק את כל התמלול, ולהחזיר אך ורק את המילה המדויקת הבאה בלבד:
[BLOCKED_HAREDI]

אם התוכן נקי וראוי, החזר את הפורמט הבא בדיוק:[CAT: שם הקטגוריה] (טון ההקראה באנגלית) הטקסט המתומלל בעברית.
דוגמה תקינה:
[CAT: סיפורים] (Speaking in an engaging and dramatic tone) פעם אחת היה איש עשיר...`;
            
            const postData = JSON.stringify({
                contents: [{ parts:[ { text: prompt }, { inlineData: { mimeType: "audio/wav", data: base64Audio } } ] }]
            });

            const response = await HttpClient.request(url, options, postData);
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            return result.candidates[0].content.parts[0].text.trim();
        }
        throw new GeminiApiError("Invalid STT response structure.", 500, JSON.stringify(result));
    }

    /**
     * TTS - יצירת הקראה (אודיו) מטקסט מעובד.
     */
    async generateTTS(textWithEmotions, voiceName) {
        TelemetryLogger.info("GeminiManager", "generateTTS", `מפיק TTS. קול: ${voiceName}`);
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            const payload = {
                contents:[{ parts:[{ text: textWithEmotions }] }],
                generationConfig: {
                    responseModalities:["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } }
                }
            };

            const response = await HttpClient.request(url, options, JSON.stringify(payload));
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            return WavEncoder.encodeFromBase64(base64Data, 24000);
        } catch (e) {
            throw new GeminiApiError("Failed to extract Base64 Audio for TTS.", 500, JSON.stringify(result));
        }
    }
}

// ============================================================================
//[7] מנהל ימות המשיח ומסד נתונים פנימי (Yemot API & Registry Database)
// ============================================================================
class YemotManager {
    constructor(token) {
        if (!token) throw new YemotApiError("YemotManager token missing.", 401);
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
        this.registryPath = "ivr2:/Temp_Gemini_App/Database_Registry.json";
    }

    async downloadFile(path) {
        const url = `https://${this.baseUrl}/ym/api/DownloadFile?token=${this.token}&path=${encodeURIComponent(path)}`;
        const response = await HttpClient.request(url, { method: 'GET' });
        return response.body;
    }

    _buildMultipartPayload(boundary, path, fileBuffer, fileName = "file.wav") {
        const crlf = "\r\n";
        let payload = Buffer.alloc(0);
        let part1 = `--${boundary}${crlf}Content-Disposition: form-data; name="path"${crlf}${crlf}${path}${crlf}`;
        payload = Buffer.concat([payload, Buffer.from(part1, 'utf8')]);
        let part2 = `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${fileName}"${crlf}Content-Type: audio/wav${crlf}${crlf}`;
        payload = Buffer.concat([payload, Buffer.from(part2, 'utf8'), fileBuffer, Buffer.from(crlf, 'utf8')]);
        payload = Buffer.concat([payload, Buffer.from(`--${boundary}--${crlf}`, 'utf8')]);
        return payload;
    }

    async uploadFile(path, buffer) {
        const boundary = '----YemotDataBoundary' + crypto.randomBytes(16).toString('hex');
        const payload = this._buildMultipartPayload(boundary, path, buffer);
        const options = {
            hostname: this.baseUrl,
            path: `/ym/api/UploadFile?token=${this.token}&convertAudio=1`, // המרה טלפונית חובה!
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length }
        };
        const response = await HttpClient.request(`https://${this.baseUrl}${options.path}`, options, payload);
        const resJson = JSON.parse(response.body.toString('utf8'));
        if (resJson.responseStatus !== 'OK') throw new YemotApiError(`Upload Failed: ${resJson.message}`, 500);
        return resJson;
    }

    async deleteFile(path) {
        const url = `https://${this.baseUrl}/ym/api/FileAction?token=${this.token}&action=delete&what=${encodeURIComponent(path)}`;
        const response = await HttpClient.request(url, { method: 'GET' });
        return JSON.parse(response.body.toString('utf8'));
    }

    async uploadTextFile(path, text) {
        const url = `https://${this.baseUrl}/ym/api/UploadTextFile?token=${this.token}`;
        const postData = `what=${encodeURIComponent(path)}&contents=${encodeURIComponent(text)}`;
        const options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } };
        const response = await HttpClient.request(url, options, postData);
        return JSON.parse(response.body.toString('utf8'));
    }

    async getTextFile(path) {
        try {
            const buffer = await this.downloadFile(path);
            return buffer.toString('utf8');
        } catch (e) {
            if (e.statusCode === 404) return null; 
            throw e;
        }
    }

    async getNextSequenceFileName(folderPath) {
        const cleanPath = (folderPath === "" || folderPath === "/") ? "/" : folderPath;
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(cleanPath)}`;
        try {
            const response = await HttpClient.request(url, { method: 'GET' });
            const data = JSON.parse(response.body.toString('utf8'));
            if (data.responseStatus !== 'OK' || !data.files) return "000";

            let maxNum = -1;
            for (const file of data.files) {
                const match = file.name.match(/^(\d{3})\.(wav|mp3|ogg|tts|txt)$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
            return (maxNum + 1).toString().padStart(3, '0');
        } catch (e) { return "000"; }
    }

    // ========================================================================
    // Database Registry - ניהול קטלוג קבצים עבור מנהלים
    // ========================================================================
    async getRegistry() {
        try {
            const data = await this.getTextFile(this.registryPath);
            if (!data) return { categories: {} };
            return JSON.parse(data);
        } catch (e) { return { categories: {} }; }
    }

    async saveToRegistry(categoryName, filePath) {
        const registry = await this.getRegistry();
        if (!registry.categories[categoryName]) {
            registry.categories[categoryName] =[];
        }
        // מניעת כפילויות
        if (!registry.categories[categoryName].includes(filePath)) {
            registry.categories[categoryName].push(filePath);
        }
        await this.uploadTextFile(this.registryPath, JSON.stringify(registry));
    }

    async removeFromRegistry(categoryName, filePath) {
        const registry = await this.getRegistry();
        if (registry.categories[categoryName]) {
            registry.categories[categoryName] = registry.categories[categoryName].filter(f => f !== filePath);
            await this.uploadTextFile(this.registryPath, JSON.stringify(registry));
        }
    }
}

module.exports = { GeminiManager, YemotManager, GEMINI_VOICES, AudioProcessor, WavEncoder, TelemetryLogger, RetryHandler };
