/**
 * @file api/core.js
 * @version 22.0.0 (Enterprise Voice Generator Edition)
 * @description תשתית ליבה (Core Infrastructure) למחולל הקראות מבוסס AI.
 * 
 * מערכת זו כוללת:
 * 1. TelemetryLogger - מערכת ניטור ורישום פעולות.
 * 2. WavEncoder - מערכת קידוד ליצירת קבצי WAV תקניים (16-bit PCM, 24kHz).
 * 3. AudioDSP - מנוע לעיבוד שמע (הסרת רעשים, הגברה, נורמליזציה).
 * 4. HttpClient - קליינט HTTP מבוסס Promises ללא תלויות.
 * 5. RetryHandler - מנגנון השהיה וחזרה (Exponential Backoff).
 * 6. ContentModerator - מסנן תוכן קפדני (Glatt Kosher).
 * 7. GeminiManager - ניהול מודלי ה-AI של גוגל (STT & TTS).
 * 8. YemotManager - ממשק ניהול מלא מול ה-API של ימות המשיח.
 * 9. InputValidator - אימות וניקוי נתוני קלט (מספרי טלפון וכו').
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// [1] מערכת לוגים וטלמטריה (Enterprise Telemetry & Logging)
// ============================================================================
class TelemetryLogger {
    static info(module, action, message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] [${module}][${action}] => ${message}`);
    }

    static warn(module, action, message) {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] [WARN] [${module}][${action}] => ${message}`);
    }

    static error(module, action, message, err = null) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [ERROR][${module}][${action}] => ${message}`);
        if (err && err.stack) {
            console.error(`[TRACE] ${err.stack}`);
        } else if (err) {
            console.error(`[DETAILS] ${JSON.stringify(err)}`);
        }
    }

    static startTimer() {
        return Date.now();
    }

    static endTimer(module, action, startTime) {
        const duration = Date.now() - startTime;
        console.log(`[METRIC] [${module}][${action}] הושלם ב-${duration}ms`);
        return duration;
    }
}

// ============================================================================
// [2] מאגר קולות נרחב (Voice Registry)
// ============================================================================
const VOICES_REGISTRY = {
    MALE:[
        { id: "Puck", desc: "קול גברי קצבי ודינמי" },
        { id: "Charon", desc: "קול גברי רציני ומכובד" },
        { id: "Fenrir", desc: "קול גברי נמרץ" },
        { id: "Orus", desc: "קול גברי תקיף ויציב" },
        { id: "Enceladus", desc: "קול גברי רגוע ושקול" },
        { id: "Iapetus", desc: "קול גברי צלול וברור" },
        { id: "Algieba", desc: "קול גברי חלק ונעים" },
        { id: "Algenib", desc: "קול גברי עמוק ומחוספס" },
        { id: "Achernar", desc: "קול גברי רך ועדין" },
        { id: "Alnilam", desc: "קול גברי סמכותי ומנהיגותי" },
        { id: "Gacrux", desc: "קול גברי בוגר וחכם" },
        { id: "Zubenelgenubi", desc: "קול גברי שגרתי ויומיומי" },
        { id: "Sadaltager", desc: "קול גברי ידען ומלומד" },
        { id: "Rasalgethi", desc: "קול גברי בעל נוכחות עמוקה" },
        { id: "Schedar", desc: "קול גברי מאוזן" }
    ],
    FEMALE:[
        { id: "Zephyr", desc: "קול נשי בהיר ומואר" },
        { id: "Kore", desc: "קול נשי תקיף ויציב" },
        { id: "Leda", desc: "קול נשי צעיר ורענן" },
        { id: "Aoede", desc: "קול נשי קליל" },
        { id: "Callirrhoe", desc: "קול נשי נינוח ורגוע" },
        { id: "Autonoe", desc: "קול נשי ברור ומדויק" },
        { id: "Umbriel", desc: "קול נשי זורם" },
        { id: "Despina", desc: "קול נשי אלגנטי וחלק" },
        { id: "Erinome", desc: "קול נשי צלול כבדולח" },
        { id: "Laomedeia", desc: "קול נשי קצבי" },
        { id: "Pulcherrima", desc: "קול נשי בוטח" },
        { id: "Achird", desc: "קול נשי ידידותי ומזמין" },
        { id: "Vindemiatrix", desc: "קול נשי סבלני ועדין" },
        { id: "Sadachbia", desc: "קול נשי חי ותוסס" },
        { id: "Sulafat", desc: "קול נשי חם ועוטף" }
    ]
};

// ============================================================================
// [3] מנהל אבטחה (Security & Access Management)
// ============================================================================
class SecurityManager {
    /**
     * בודק האם המספר המחייג מופיע ברשימת המנהלים שהוגדרה ב-ext.ini
     * @param {string} phone - מספר הטלפון של המחייג
     * @param {string} adminPhonesStr - מחרוזת של מספרי מנהלים (מופרדים בפסיק)
     * @returns {boolean}
     */
    static isAdministrator(phone, adminPhonesStr) {
        if (!adminPhonesStr) return false;
        
        let cleanPhone = phone || "";
        // מנרמל קידומת בינלאומית אם ימות המשיח שולחת "97254..."
        if (cleanPhone.startsWith("972")) {
            cleanPhone = "0" + cleanPhone.substring(3);
        }

        const adminPhones = adminPhonesStr.split(',').map(p => p.trim());
        return adminPhones.includes(cleanPhone);
    }
}

// ============================================================================
// [4] מסד חוקים לסינון תוכן חרדי (Glatt Kosher Filter Rules)
// ============================================================================
class ContentModerator {
    /**
     * הפרומפט החדש למאזינים. ממוקד בהבנת הטקסט וניקויו מהזיות,
     * תוך הקפדה על סינון התוכן. אין כאן דרישה להסקת "טון דיבור".
     */
    static getListenerModerationPrompt() {
        return `
אתה משמש כמערכת סינון ותמלול.
עליך להאזין להקלטה, לפענח אותה לעברית תקנית, ולסנן תכנים שאינם ראויים.

עליך להחזיר אך ורק אובייקט JSON חוקי במבנה הבא (ללא Markdown וללא תוספות):
{
  "is_kosher": true/false,
  "text": "הטקסט המפוענח",
  "category": "שם הקטגוריה"
}

חוקי סינון (is_kosher):
1. החזר false אם ההקלטה מכילה תוכן הנוגד את ההלכה היהודית, או מכילה לשון הרע, ניבול פה, הסתה, פוליטיקה וכדומה.
2. החזר true אך ורק אם התוכן נקי.

חוקי פענוח (text):
1. תמלל במדויק את הנאמר לעברית תקנית בלבד.
2. אם הדובר מגמגם או אומר מילים לא ברורות - התעלם מהן. ספק משפט הגיוני ורציף.
3. אל תמציא מילים שלא נאמרו. אם לא שומעים כלום ברור, החזר טקסט ריק ו-is_kosher=false.
4. אל תוסיף פתיחים או סיכומים.

חוקי קטגוריה (category):
בחר: "תורה_והלכה", "סיפורים", "חדשות_ועדכונים", "כללי".
`;
    }

    /**
     * הפרומפט למנהלים. מאפשר זיהוי טון דיבור (Emotion).
     */
    static getAdminModerationPrompt() {
        return `
אתה משמש כמערכת סינון, תמלול וזיהוי רגש.
עליך להאזין להקלטה, לפענח אותה, לזהות את האווירה, ולסנן תכנים.

עליך להחזיר אך ורק אובייקט JSON חוקי במבנה הבא:
{
  "is_kosher": true/false,
  "text": "הטקסט המפוענח",
  "emotion": "הוראות במאי לטון הדיבור באנגלית",
  "category": "שם הקטגוריה"
}

חוקי פענוח וסינון זהים.
ב-emotion: כתוב באנגלית הוראה קצרה (למשל: Speaking in an energetic tone).
`;
    }
}

// ============================================================================
// [5] מנועי עיבוד שמע - Audio Digital Signal Processing (DSP) & Encoders
// ============================================================================

class WavEncoder {
    static encodeFromBase64(base64PCM, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
        TelemetryLogger.info("WavEncoder", "encodeFromBase64", `מתחיל קידוד WAV. תדר: ${sampleRate}Hz`);
        const timer = TelemetryLogger.startTimer();
        
        try {
            const pcmBuffer = Buffer.from(base64PCM, 'base64');
            
            // בודק אם הכותרת כבר קיימת
            if (pcmBuffer.length >= 44 && pcmBuffer.toString('utf8', 0, 4) === 'RIFF') {
                TelemetryLogger.info("WavEncoder", "encodeFromBase64", "הקובץ כבר מכיל כותרת WAV.");
                return pcmBuffer;
            }

            const header = Buffer.alloc(44);
            header.write('RIFF', 0);
            header.writeUInt32LE(36 + pcmBuffer.length, 4);
            header.write('WAVE', 8);
            header.write('fmt ', 12);
            header.writeUInt32LE(16, 16);
            header.writeUInt16LE(1, 20); // PCM
            header.writeUInt16LE(numChannels, 22);
            header.writeUInt32LE(sampleRate, 24);
            header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
            header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
            header.writeUInt16LE(bitsPerSample, 34);
            header.write('data', 36);
            header.writeUInt32LE(pcmBuffer.length, 40);
            
            const finalWavBuffer = Buffer.concat([header, pcmBuffer]);
            TelemetryLogger.endTimer("WavEncoder", "encodeFromBase64", timer);
            return finalWavBuffer;
        } catch (error) {
            TelemetryLogger.error("WavEncoder", "encodeFromBase64", "שגיאה בקידוד WAV", error);
            throw new Error("WavEncoder Error");
        }
    }
}

class AudioDSP {
    static enhanceWavAudio(buffer, gainMultiplier = 3.5, noiseGateThreshold = 300) {
        TelemetryLogger.info("AudioDSP", "enhanceWavAudio", `מתחיל עיבוד DSP. Gain: ${gainMultiplier}`);
        
        try {
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                return buffer; 
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; 

            // הסרת DC Offset
            let sum = 0;
            let sampleCount = 0;
            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                sum += newBuffer.readInt16LE(i);
                sampleCount++;
            }
            const dcOffset = sampleCount > 0 ? Math.round(sum / sampleCount) : 0;

            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
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
            TelemetryLogger.error("AudioDSP", "enhanceWavAudio", "קריסה בעיבוד השמע", error);
            return buffer; 
        }
    }
}

// ============================================================================
//[6] תשתית HTTP פנימית מבוססת Promises
// ============================================================================
class HttpClient {
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
            req.setTimeout(55000, () => {
                req.destroy();
                reject(new Error("Timeout"));
            });

            if (postData) req.write(postData);
            req.end();
        });
    }
}

class RetryHandler {
    static async executeWithBackoff(fn, maxRetries = 4) {
        let retries = 0;
        let delay = 1000; 

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const isRecoverable = error.statusCode === 429 || error.statusCode >= 500 || error.message.includes("Timeout");
                if (isRecoverable && retries < maxRetries - 1) {
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
// [7] מחלקת Gemini AI
// ============================================================================
class GeminiManager {
    constructor(apiKeys) {
        this.keys = apiKeys ||[];
        this.currentIndex = 0;
    }

    _getKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * פענוח למאזינים - ללא רגש, טקסט נקי.
     */
    async transcribeSimple(audioBuffer) {
        TelemetryLogger.info("GeminiManager", "transcribeSimple", "מתמלל (מאזין)...");
        const enhancedBuffer = AudioDSP.enhanceWavAudio(audioBuffer, 4.0, 300);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this._getKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            const postData = JSON.stringify({
                contents: [{
                    parts:[
                        { text: ContentModerator.getListenerModerationPrompt() },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            });
            const res = await HttpClient.request(url, options, postData);
            return JSON.parse(res.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            let rawText = result.candidates[0].content.parts[0].text.trim();
            rawText = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
            return JSON.parse(rawText);
        }
        throw new Error("Invalid STT response.");
    }

    /**
     * פענוח למנהלים - כולל זיהוי רגש.
     */
    async transcribeWithEmotion(audioBuffer) {
        TelemetryLogger.info("GeminiManager", "transcribeWithEmotion", "מתמלל (מנהל)...");
        const enhancedBuffer = AudioDSP.enhanceWavAudio(audioBuffer, 4.0, 300);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this._getKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            const postData = JSON.stringify({
                contents: [{
                    parts:[
                        { text: ContentModerator.getAdminModerationPrompt() },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            });
            const res = await HttpClient.request(url, options, postData);
            return JSON.parse(res.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            let rawText = result.candidates[0].content.parts[0].text.trim();
            rawText = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
            return JSON.parse(rawText);
        }
        throw new Error("Invalid STT response.");
    }

    /**
     * יצירת הקראה (TTS)
     * @param {string} text - הטקסט
     * @param {string} voiceName - שם הקול
     * @param {string} emotionCue - למנהלים: הוראות טון; למאזינים: null
     */
    async generateTTS(text, voiceName, emotionCue = null) {
        TelemetryLogger.info("GeminiManager", "generateTTS", `מפיק קול ${voiceName}`);
        
        let promptText = text;
        // במצב מאזין אנו רוצים קצב אחיד ומונוטוני
        if (!emotionCue) {
            promptText = `[Director's Note: Read the following Hebrew text in a steady, even, slightly robotic and highly monotonous pace. Do not read this note aloud.]\n\n${text}`;
        } else {
            promptText = `[Director's Note: Read the following Hebrew text in a ${emotionCue} tone. Do not read this note aloud.]\n\n${text}`;
        }

        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this._getKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            const payload = {
                contents: [{ parts:[{ text: promptText }] }],
                generationConfig: {
                    responseModalities:["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } }
                }
            };
            const res = await HttpClient.request(url, options, JSON.stringify(payload));
            return JSON.parse(res.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            return WavEncoder.encodeFromBase64(base64Data, 24000);
        } catch (e) {
            throw new Error("Failed to extract Base64 Audio.");
        }
    }
}

// ============================================================================
// [8] מחלקת YemotManager (תקשורת מול ימות המשיח)
// ============================================================================
class YemotManager {
    constructor(token) {
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
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
            path: `/ym/api/UploadFile?token=${this.token}&convertAudio=1`,
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length }
        };
        const response = await HttpClient.request(`https://${this.baseUrl}${options.path}`, options, payload);
        const resJson = JSON.parse(response.body.toString('utf8'));
        if (resJson.responseStatus !== 'OK') throw new Error(`Upload Failed: ${resJson.message}`);
        return resJson;
    }

    async uploadTextFile(path, text) {
        const url = `https://${this.baseUrl}/ym/api/UploadTextFile?token=${this.token}`;
        const postData = `what=${encodeURIComponent(path)}&contents=${encodeURIComponent(text)}`;
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
        };
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

    async deleteFile(path) {
        const url = `https://${this.baseUrl}/ym/api/FileAction?token=${this.token}&action=delete&what=${encodeURIComponent(path)}`;
        try {
            const response = await HttpClient.request(url, { method: 'GET' });
            return JSON.parse(response.body.toString('utf8'));
        } catch (e) {
            return null;
        }
    }

    async getIvr2Dir(folderPath) {
        const cleanPath = (!folderPath || folderPath === "") ? "/" : folderPath;
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(cleanPath)}`;
        const response = await HttpClient.request(url, { method: 'GET' });
        return JSON.parse(response.body.toString('utf8'));
    }

    async getNextSequenceFileName(folderPath) {
        const data = await this.getIvr2Dir(folderPath);
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
    }
}

// מחלקת עזר לניקוי קלט מספרי
class InputValidator {
    static getFirstDigit(inputStr) {
        if (!inputStr) return null;
        const digits = inputStr.replace(/\D/g, "");
        return digits.length > 0 ? digits.charAt(0) : null;
    }
}

module.exports = { 
    GeminiManager, 
    YemotManager, 
    VOICES_REGISTRY, 
    TelemetryLogger, 
    SecurityManager,
    InputValidator
};
