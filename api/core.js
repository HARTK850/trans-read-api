/**
 * @file api/core.js
 * @version 21.0.0 (Glatt Kosher Enterprise Edition - Ultimate)
 * @description תשתית ליבה (Core Infrastructure) למערכת IVR מבוססת מודלים מתקדמים.
 * 
 * מערכת זו בנויה בארכיטקטורת Enterprise מקיפה וכוללת:
 * 1. TelemetryLogger - מערכת ניטור ולוגים מתקדמת לתיעוד פעולות שרת.
 * 2. SecurityManager - ניהול הרשאות, סינון משתמשים ואבטחת גישה.
 * 3. WavEncoder - מערכת קידוד בינארית ליצירת כותרות RIFF/WAVE תקניות (פותר בעיות השמע בימות המשיח).
 * 4. AudioDSP - מנוע עיבוד אותות (Digital Signal Processing) לניקוי רעשים, השתקת רחשים (Noise Gate) והגברה (Compression).
 * 5. HttpClient - קליינט HTTP נקי לחלוטין (Zero Dependencies) לביצוע בקשות רשת מאובטחות.
 * 6. RetryHandler - מנגנון התאוששות שגיאות Exponential Backoff נגד קריסות שרת צד ג'.
 * 7. ContentModerator - מסנן תוכן קפדני (Glatt Kosher) למניעת תוכן לא ראוי, כפירה או לשון הרע.
 * 8. GeminiManager - ניהול עיבוד טקסט ושמע.
 * 9. YemotManager - ממשק ניהול מלא מול ה-API של ימות המשיח.
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// [1] מערכת לוגים וטלמטריה (Enterprise Telemetry & Logging)
// ============================================================================
class TelemetryLogger {
    /**
     * רושם הודעת מידע שגרתית בלוג השרת.
     * @param {string} module - שם הרכיב
     * @param {string} action - שם הפעולה
     * @param {string} message - תוכן ההודעה
     */
    static info(module, action, message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] [${module}][${action}] => ${message}`);
    }

    /**
     * רושם הודעת אזהרה (אינה קורסת אך דורשת שימת לב).
     */
    static warn(module, action, message) {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}][WARN] [${module}][${action}] => ${message}`);
    }

    /**
     * רושם שגיאה קריטית המצריכה התערבות. תומך באובייקטי Error של Node.js.
     */
    static error(module, action, message, err = null) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [ERROR][${module}][${action}] => ${message}`);
        if (err && err.stack) {
            console.error(`[TRACE] ${err.stack}`);
        } else if (err) {
            console.error(`[DETAILS] ${JSON.stringify(err)}`);
        }
    }

    /**
     * מתחיל טיימר למדידת ביצועים (Performance Metrics).
     * @returns {number} הזמן הנוכחי במילישניות
     */
    static startTimer() {
        return Date.now();
    }

    /**
     * מסיים טיימר ורושם את זמן הביצוע בלוג.
     */
    static endTimer(module, action, startTime) {
        const duration = Date.now() - startTime;
        console.log(`[METRIC] [${module}][${action}] הושלם ב-${duration}ms`);
        return duration;
    }
}

// ============================================================================
// [2] מאגר קולות נרחב (Voice Registry)
// מותאם לקריינות רשמית ומכובדת, ללא מושגים לועזיים בהקראה למשתמש
// ============================================================================
const VOICES_REGISTRY = {
    MALE:[
        { id: "Puck", desc: "קול גברי קצבי ודינמי", promptCue: "[Speak in a dynamic, upbeat and clear tone]" },
        { id: "Charon", desc: "קול גברי רציני ומכובד", promptCue: "[Speak in a serious, informative and highly professional tone]" },
        { id: "Fenrir", desc: "קול גברי נמרץ", promptCue: "[Speak in an energetic, fast-paced and passionate tone]" },
        { id: "Orus", desc: "קול גברי תקיף ויציב", promptCue: "[Speak in a firm, steady and authoritative tone]" },
        { id: "Enceladus", desc: "קול גברי רגוע ושקול", promptCue: "[Speak in a calm, relaxing and measured tone]" },
        { id: "Iapetus", desc: "קול גברי צלול וברור", promptCue: "[Speak in a clear, crisp and articulate tone]" },
        { id: "Algieba", desc: "קול גברי חלק ונעים", promptCue: "[Speak in a smooth, pleasant and soothing tone]" },
        { id: "Algenib", desc: "קול גברי עמוק ומחוספס", promptCue: "[Speak in a deep, slightly gravelly and strong tone]" },
        { id: "Achernar", desc: "קול גברי רך ועדין", promptCue: "[Speak in a soft, gentle and warm tone]" },
        { id: "Alnilam", desc: "קול גברי סמכותי ומנהיגותי", promptCue: "[Speak in a highly authoritative, commanding tone]" },
        { id: "Gacrux", desc: "קול גברי בוגר וחכם", promptCue: "[Speak in a mature, experienced and wise tone]" },
        { id: "Zubenelgenubi", desc: "קול גברי שגרתי ויומיומי", promptCue: "[Speak in a neutral, everyday routine tone]" },
        { id: "Sadaltager", desc: "קול גברי ידען ומלומד", promptCue: "[Speak in a knowledgeable, smart and intellectual tone]" },
        { id: "Rasalgethi", desc: "קול גברי בעל נוכחות עמוקה", promptCue: "[Speak in a very deep, resonant and strong tone]" },
        { id: "Schedar", desc: "קול גברי מאוזן", promptCue: "[Speak in a perfectly even, balanced and calm tone]" }
    ],
    FEMALE:[
        { id: "Zephyr", desc: "קול נשי בהיר ומואר", promptCue: "[Speak in a bright, light and cheerful tone]" },
        { id: "Kore", desc: "קול נשי תקיף ויציב", promptCue: "[Speak in a firm, steady and confident tone]" },
        { id: "Leda", desc: "קול נשי צעיר ורענן", promptCue: "[Speak in a youthful, fresh and energetic tone]" },
        { id: "Aoede", desc: "קול נשי קליל", promptCue: "[Speak in a breezy, airy and carefree tone]" },
        { id: "Callirrhoe", desc: "קול נשי נינוח ורגוע", promptCue: "[Speak in a relaxed, easygoing and peaceful tone]" },
        { id: "Autonoe", desc: "קול נשי ברור ומדויק", promptCue: "[Speak in a highly clear, distinct and articulate tone]" },
        { id: "Umbriel", desc: "קול נשי זורם", promptCue: "[Speak in a flowing, continuous and smooth tone]" },
        { id: "Despina", desc: "קול נשי אלגנטי וחלק", promptCue: "[Speak in a silky smooth, elegant tone]" },
        { id: "Erinome", desc: "קול נשי צלול כבדולח", promptCue: "[Speak in a crystal clear, pure tone]" },
        { id: "Laomedeia", desc: "קול נשי קצבי", promptCue: "[Speak in an upbeat, rhythmic and dynamic tone]" },
        { id: "Pulcherrima", desc: "קול נשי בוטח", promptCue: "[Speak in a forward, confident and assertive tone]" },
        { id: "Achird", desc: "קול נשי ידידותי ומזמין", promptCue: "[Speak in a warm, friendly and welcoming tone]" },
        { id: "Vindemiatrix", desc: "קול נשי סבלני ועדין", promptCue: "[Speak in a gentle, soft and tender tone]" },
        { id: "Sadachbia", desc: "קול נשי חי ותוסס", promptCue: "[Speak in a lively, vibrant and animated tone]" },
        { id: "Sulafat", desc: "קול נשי חם ועוטף", promptCue: "[Speak in a warm, enveloping and comforting tone]" }
    ]
};

// ============================================================================
//[3] מנהל אבטחה וניהול גישה (Security & Access Management)
// ============================================================================
class SecurityManager {
    /**
     * בודק האם המספר המחייג שייך לרשימת המנהלים המורשים.
     * @param {string} phone - מספר הטלפון של המחייג.
     * @returns {boolean}
     */
    static isAdministrator(phone) {
        const ADMIN_PHONES = ["0548582624", "0534170633"];
        // ניקוי קידומות אפשריות של ימות המשיח
        let cleanPhone = phone || "";
        if (cleanPhone.startsWith("972")) {
            cleanPhone = "0" + cleanPhone.substring(3);
        }
        return ADMIN_PHONES.includes(cleanPhone);
    }
}

// ============================================================================
// [4] מסד חוקים לסינון תוכן חרדי (Glatt Kosher Filter Rules)
// ============================================================================
class ContentModerator {
    /**
     * מחזיר את הפרומפט המלא הנדרש לסינון ועיבוד התוכן לפני הפקתו.
     */
    static getModerationPrompt() {
        return `
אתה משמש כמערכת סינון ופענוח קפדנית.
המטרה שלך היא להאזין להקלטה, לפענח אותה לטקסט, לנתח את טון הדיבור, לשייך לקטגוריה, והכי חשוב - לסנן תכנים שאינם ראויים.

עליך להחזיר אך ורק אובייקט JSON חוקי במבנה הבא (ללא שום טקסט מחוץ ל-JSON, וללא בלוקים של Markdown):
{
  "is_kosher": true/false,
  "text": "הטקסט המפוענח",
  "emotion": "הוראות במאי לטון הדיבור",
  "category": "שם הקטגוריה"
}

חוקי סינון (is_kosher):
1. החזר false אם ההקלטה מכילה תוכן הנוגד את ערכי היהדות, המסורת או ההלכה.
2. החזר false אם יש לשון הרע, רכילות, או פגיעה ברבנים, אישי ציבור או בני אדם בכלל.
3. החזר false אם יש מילים גסות, חוסר צניעות, תכנים שבינו לבינה.
4. החזר false אם התוכן מכיל כפירה, הסתה, פוליטיקה או מחלוקת.
5. החזר true אך ורק אם התוכן נקי לחלוטין וראוי להישמע בציבור.

חוקי פענוח (text):
1. כתוב את הטקסט במדויק ובעברית תקנית.
2. אל תוסיף פתיחים או סיכומים.
3. אם ההקלטה ריקה או מכילה רק רעש, החזר טקסט ריק ואת is_kosher כ-false.

חוקי טון (emotion):
1. הוסף באנגלית הוראה קצרה המתאימה לרגש הדובר (למשל: Speaking in a happy, upbeat tone).

חוקי קטגוריה (category):
בחר את הקטגוריה המתאימה ביותר למלל מתוך הרשימה הבאה בלבד:
- "תורה_והלכה"
- "סיפורים"
- "חדשות_ועדכונים"
- "כללי"
אם אינך בטוח, בחר "כללי".
`;
    }
}

// ============================================================================
// [5] מערך שגיאות מותאם אישית (Custom Error Classes)
// ============================================================================
class IvrInternalError extends Error {
    constructor(message) { super(message); this.name = "IvrInternalError"; }
}
class YemotApiError extends Error {
    constructor(message) { super(message); this.name = "YemotApiError"; }
}
class ExternalApiError extends Error {
    constructor(message, statusCode, rawBody) { 
        super(message); 
        this.name = "ExternalApiError"; 
        this.statusCode = statusCode;
        this.rawBody = rawBody;
    }
}

// ============================================================================
// [6] מנועי עיבוד שמע - Audio Digital Signal Processing (DSP) & Encoders
// ============================================================================

/**
 * מחלקת WavEncoder - מתקנת קבצי שמע פגומים.
 * לוקחת נתוני PCM RAW גולמיים ויוצקת עליהם כותרת RIFF/WAVE חוקית לחלוטין.
 */
class WavEncoder {
    static encodeFromBase64(base64PCM, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
        TelemetryLogger.info("WavEncoder", "encodeFromBase64", `מתחיל קידוד כותרת WAV. תדר: ${sampleRate}Hz`);
        const timer = TelemetryLogger.startTimer();
        
        try {
            const pcmBuffer = Buffer.from(base64PCM, 'base64');
            
            // מונע קידוד כפול אם הכותרת כבר קיימת
            if (pcmBuffer.length >= 44 && pcmBuffer.toString('utf8', 0, 4) === 'RIFF') {
                TelemetryLogger.info("WavEncoder", "encodeFromBase64", "הקובץ כבר מכיל כותרת WAV תקינה.");
                return pcmBuffer;
            }

            const header = Buffer.alloc(44);
            header.write('RIFF', 0);
            header.writeUInt32LE(36 + pcmBuffer.length, 4);
            header.write('WAVE', 8);
            header.write('fmt ', 12);
            header.writeUInt32LE(16, 16);
            header.writeUInt16LE(1, 20); // 1 = PCM
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
            TelemetryLogger.error("WavEncoder", "encodeFromBase64", "שגיאה בקידוד קובץ ה-WAV", error);
            throw new IvrInternalError("Failed to encode WAV file.");
        }
    }
}

/**
 * מחלקת AudioDSP
 * מנקה רעשי רקע של רשת סלולרית ומגבירה עוצמה כדי שהמערכת תבין את המילים במדויק.
 */
class AudioDSP {
    static enhanceWavAudio(buffer, gainMultiplier = 4.5, noiseGateThreshold = 350) {
        TelemetryLogger.info("AudioDSP", "enhanceWavAudio", `מתחיל עיבוד DSP. Gain: ${gainMultiplier}`);
        const timer = TelemetryLogger.startTimer();
        
        try {
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                return buffer; 
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; 

            // חישוב ממוצע להסרת חריגת DC Offset
            let sum = 0;
            let sampleCount = 0;
            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                sum += newBuffer.readInt16LE(i);
                sampleCount++;
            }
            const dcOffset = sampleCount > 0 ? Math.round(sum / sampleCount) : 0;

            // עיבוד הסיגנל (Noise Gate + Gain)
            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                let sample = newBuffer.readInt16LE(i) - dcOffset;
                
                // החרשת רעשים שקטים מתחת לסף (Hiss)
                if (Math.abs(sample) < noiseGateThreshold) {
                    sample = 0; 
                } else {
                    // הגברה וטיפול בעיוות (Hard Clipping)
                    sample = Math.round(sample * gainMultiplier);
                    if (sample > 32767) sample = 32767;
                    if (sample < -32768) sample = -32768;
                }
                newBuffer.writeInt16LE(sample, i);
            }
            
            TelemetryLogger.endTimer("AudioDSP", "enhanceWavAudio", timer);
            return newBuffer;
        } catch (error) {
            TelemetryLogger.error("AudioDSP", "enhanceWavAudio", "קריסה בעיבוד השמע", error);
            return buffer; 
        }
    }
}

// ============================================================================
// [7] תשתית HTTP פנימית מבוססת Promises (ללא ספריות 외부)
// ============================================================================
class HttpClient {
    /**
     * מבצע בקשת HTTP אסינכרונית טהורה ב-Node.js.
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

            req.on('error', (e) => {
                TelemetryLogger.error("HttpClient", "request", `Network failure to ${url}`, e);
                reject(e);
            });

            // הגדרת Timeout קשיח למניעת תליית השרת
            req.setTimeout(55000, () => {
                req.destroy();
                reject(new Error("HTTP Request Timeout Exceeded"));
            });

            if (postData) req.write(postData);
            req.end();
        });
    }
}

// ============================================================================
// [8] מנהל שגיאות ו-Exponential Backoff
// ============================================================================
class RetryHandler {
    /**
     * מפעיל פונקציה מחדש במקרה של כישלון זמני.
     */
    static async executeWithBackoff(fn, maxRetries = 4) {
        let retries = 0;
        let delay = 1500; 

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const isRecoverable = error.statusCode === 429 || error.statusCode >= 500 || (error.message && error.message.includes("Timeout"));
                
                if (isRecoverable && retries < maxRetries - 1) {
                    TelemetryLogger.warn("RetryHandler", "executeWithBackoff", `שגיאת ${error.statusCode}. מנסה שוב בעוד ${delay}ms...`);
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
// [9] מחלקת עיבוד מתקדמת מול מודלי ההפקה
// ============================================================================
class ProcessingManager {
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new ExternalApiError("Missing API Keys for initialization.");
        }
        this.keys = apiKeys;
        this.currentIndex = 0;
    }

    _getRotateKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * פענוח מקיף של האודיו כולל סינון תוכן קפדני (Content Moderation).
     */
    async processAudioAndModerate(audioBuffer) {
        TelemetryLogger.info("ProcessingManager", "processAudio", "מתחיל פענוח מקיף וסינון תוכן...");
        const timer = TelemetryLogger.startTimer();
        
        const enhancedBuffer = AudioDSP.enhanceWavAudio(audioBuffer, 4.5, 350);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            const postData = JSON.stringify({
                contents:[{
                    parts:[
                        { text: ContentModerator.getModerationPrompt() },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            });

            const response = await HttpClient.request(url, options, postData);
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        TelemetryLogger.endTimer("ProcessingManager", "processAudio", timer);
        
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            let rawText = result.candidates[0].content.parts[0].text.trim();
            rawText = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
            
            try {
                return JSON.parse(rawText);
            } catch (jsonErr) {
                TelemetryLogger.error("ProcessingManager", "ParseJSON", "פלט לא תקין מהמודל.", jsonErr);
                throw new IvrInternalError("Failed to parse moderation JSON.");
            }
        }
        throw new ExternalApiError("Invalid response structure from external service.", 200, JSON.stringify(result));
    }

    /**
     * יצירת הקובץ הקולי הסופי (הזרקת הוראות ללא הקראתן).
     */
    async generateVoiceAudio(text, voiceName, emotionCue) {
        TelemetryLogger.info("ProcessingManager", "generateVoice", `מפיק קריינות בקול '${voiceName}'.`);
        const timer = TelemetryLogger.startTimer();
        
        const promptText = `[Director's Note: Read the following Hebrew text in a ${emotionCue} tone. Do not read this note aloud.]\n\n${text}`;

        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            const payload = {
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: {
                    responseModalities:["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName }
                        }
                    }
                }
            };

            const response = await HttpClient.request(url, options, JSON.stringify(payload));
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        TelemetryLogger.endTimer("ProcessingManager", "generateVoice", timer);
        
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            // הלבשת כותרת חוקית על הנתונים הגולמיים
            return WavEncoder.encodeFromBase64(base64Data, 24000);
        } catch (e) {
            TelemetryLogger.error("ProcessingManager", "generateVoice", "שגיאה בפענוח הנתונים הבינאריים", JSON.stringify(result));
            throw new ExternalApiError("Failed to extract Base64 Audio.", 200, JSON.stringify(result));
        }
    }
}

// ============================================================================
// [10] מחלקת תקשורת מתקדמת מול "ימות המשיח" (Yemot API)
// ============================================================================
class YemotManager {
    constructor(token) {
        if (!token) throw new YemotApiError("YemotManager requires a valid token.");
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
    }

    async downloadFile(path) {
        TelemetryLogger.info("YemotManager", "downloadFile", `מוריד מנתיב: ${path}`);
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

    /**
     * מעלה קובץ שמע לימות המשיח עם פקודת ההמרה הייעודית.
     */
    async uploadFile(path, buffer) {
        TelemetryLogger.info("YemotManager", "uploadFile", `מעלה קובץ אודיו לנתיב: ${path}`);
        const boundary = '----YemotDataBoundary' + crypto.randomBytes(16).toString('hex');
        const payload = this._buildMultipartPayload(boundary, path, buffer);

        const options = {
            hostname: this.baseUrl,
            path: `/ym/api/UploadFile?token=${this.token}&convertAudio=1`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length
            }
        };

        const response = await HttpClient.request(`https://${this.baseUrl}${options.path}`, options, payload);
        const resJson = JSON.parse(response.body.toString('utf8'));
        if (resJson.responseStatus !== 'OK') throw new YemotApiError(`Upload Failed: ${resJson.message}`);
        return resJson;
    }

    async uploadTextFile(path, text) {
        TelemetryLogger.info("YemotManager", "uploadTextFile", `שומר טקסט בנתיב: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/UploadTextFile?token=${this.token}`;
        const postData = `what=${encodeURIComponent(path)}&contents=${encodeURIComponent(text)}`;
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
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
        TelemetryLogger.info("YemotManager", "deleteFile", `מוחק קובץ מנתיב: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/FileAction?token=${this.token}&action=delete&what=${encodeURIComponent(path)}`;
        try {
            const response = await HttpClient.request(url, { method: 'GET' });
            return JSON.parse(response.body.toString('utf8'));
        } catch (e) {
            TelemetryLogger.error("YemotManager", "deleteFile", "כשל במחיקת קובץ", e);
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
        try {
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
        } catch (e) {
            return "000";
        }
    }
}

module.exports = { 
    GeminiManager: ProcessingManager, // Alias 
    YemotManager, 
    GEMINI_VOICES: VOICES_REGISTRY, 
    AudioProcessor: AudioDSP, 
    WavEncoder, 
    TelemetryLogger, 
    RetryHandler,
    ContentModerator,
    SecurityManager
};
