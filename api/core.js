/**
 * @file api/core.js
 * @version 20.0.0 (Glatt Kosher Enterprise Edition)
 * @description תשתית ליבה (Core Infrastructure) למערכת IVR מבוססת מודלי שפה.
 * 
 * מערכת זו כוללת ארכיטקטורת אנטרפרייז מקיפה:
 * 1. TelemetryLogger - מערכת ניטור ולוגים מתקדמת.
 * 2. WavEncoder - מערכת קידוד בינארית לתיקון כותרות קבצים לפורמט טלפוני נקי.
 * 3. AudioProcessor - מנוע DSP לניקוי רעשים סטטיים מהקלטות טלפוניות (Noise Gate & Compressor).
 * 4. HttpClient - קליינט HTTP נקי לחלוטין מבוסס Promises.
 * 5. RetryHandler - מנגנון Exponential Backoff נגד קריסות API.
 * 6. GeminiManager - ניהול STT כולל פילטר חרדי קפדני (Glatt Kosher) וחלוקה לקטגוריות.
 * 7. YemotManager - ממשק ניהול מלא מול ה-API של ימות המשיח.
 * 8. HarediFilterDictionary - מילון מחמיר והנחיות במאי.
 * 
 * נכתב במיוחד על מנת לעמוד בדרישות קפדניות של אבטחה, צניעות, חווית משתמש (UX) ואמינות.
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// [1] מערכת לוגים וטלמטריה (Enterprise Telemetry & Logging)
// ============================================================================
class TelemetryLogger {
    /**
     * רושם הודעת מידע שגרתית
     */
    static info(module, action, message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] [${module}][${action}] => ${message}`);
    }

    /**
     * רושם הודעת אזהרה
     */
    static warn(module, action, message) {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] [WARN] [${module}] [${action}] => ${message}`);
    }

    /**
     * רושם שגיאה קריטית המצריכה התערבות
     */
    static error(module, action, message, err = null) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [ERROR] [${module}][${action}] => ${message}`);
        if (err && err.stack) {
            console.error(err.stack);
        } else if (err) {
            console.error(err);
        }
    }

    /**
     * מתחיל טיימר למדידת ביצועים
     */
    static startTimer() {
        return Date.now();
    }

    /**
     * מסיים טיימר ורושם את זמן הביצוע
     */
    static endTimer(module, action, startTime) {
        const duration = Date.now() - startTime;
        console.log(`[METRIC] [${module}] [${action}] הושלם ב-${duration}ms`);
        return duration;
    }
}

// ============================================================================
// [2] מאגר קולות נרחב (Gemini TTS Voice Registry)
// מותאם לקריינות מכובדת, ללא שימוש במושגים לועזיים בהקראה למשתמש
// ============================================================================
const GEMINI_VOICES = {
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
// [3] מסד חוקים לסינון תוכן חרדי (Glatt Kosher AI Filter Rules)
// ============================================================================
const GLATT_KOSHER_PROMPT = `
אתה משמש כמערכת חרדית קפדנית לסינון, קטלוג ותמלול אודיו.
המטרה שלך היא להאזין להקלטה, להמיר אותה לטקסט (STT), לנתח את הטון, לשייך לקטגוריה, והכי חשוב - לסנן.

עליך להחזיר **אך ורק** אובייקט JSON חוקי ותקני במבנה הבא (ללא שום טקסט מחוץ ל-JSON! ללא בלוקי markdown של \`\`\`json):
{
  "is_kosher": true/false,
  "text": "הטקסט המתומלל",
  "emotion": "הוראות במאי לטון הדיבור",
  "category": "שם הקטגוריה"
}

חוקי סינון (is_kosher):
1. החזר false אם ההקלטה מכילה תוכן הנוגד את ההלכה היהודית האורתודוקסית.
2. החזר false אם יש לשון הרע, רכילות, או פגיעה בתלמידי חכמים ורבנים.
3. החזר false אם יש מילים גסות, חוסר צניעות, תכנים שבינו לבינה, או ניבול פה.
4. החזר false אם התוכן מכיל כפירה, דברי הסתה, או פוליטיקה מלוכלכת.
5. החזר true אך ורק אם התוכן נקי לחלוטין וראוי להישמע בציבור היראים.

חוקי תמלול (text):
1. תמלל במדויק את הנאמר לעברית תקנית.
2. אל תוסיף שום מילות פתיחה משלך.
3. אם ההקלטה ריקה או שיש רק רעש רקע, החזר טקסט ריק ואת is_kosher כ-false.

חוקי טון (emotion):
1. הוסף באנגלית הוראה קצרה המתאימה לרגש (למשל: Speaking in a happy, upbeat tone).
2. אם זה סיפור, הוסף: Speaking in a dramatic storytelling tone.
3. אם זה חידוש תורה, הוסף: Speaking in a serious, intellectual and formal tone.

חוקי קטגוריה (category):
בחר את הקטגוריה המתאימה ביותר למלל מתוך הרשימה הבאה בלבד:
- "תורה_והלכה"
- "סיפורים_ומרגש"
- "חדשות_ועדכונים"
- "כללי"
אם אינך בטוח, בחר "כללי".
`;

// ============================================================================
// [4] מערך שגיאות מותאם אישית (Custom Error Classes)
// ============================================================================
class IvrInternalError extends Error {
    constructor(message) { super(message); this.name = "IvrInternalError"; }
}
class YemotApiError extends Error {
    constructor(message) { super(message); this.name = "YemotApiError"; }
}
class GeminiApiError extends Error {
    constructor(message, statusCode, rawBody) { 
        super(message); 
        this.name = "GeminiApiError"; 
        this.statusCode = statusCode;
        this.rawBody = rawBody;
    }
}
class ContentModerationError extends Error {
    constructor(message) { super(message); this.name = "ContentModerationError"; }
}

// ============================================================================
// [5] מנועי עיבוד שמע - Audio Digital Signal Processing (DSP) & Encoders
// ============================================================================

/**
 * מחלקת WavEncoder - מתקנת קבצי שמע פגומים
 * מיועדת לפתור את בעיית השמע במרכזיות הטלפוניות על ידי יציקת כותרת RIFF תקנית.
 */
class WavEncoder {
    /**
     * @param {string} base64PCM - נתונים גולמיים מ-Gemini
     * @param {number} sampleRate - תדר (ברירת מחדל 24000)
     * @returns {Buffer}
     */
    static encodeFromBase64(base64PCM, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
        TelemetryLogger.info("WavEncoder", "encodeFromBase64", `מתחיל קידוד כותרת WAV לקובץ. תדר: ${sampleRate}Hz`);
        const timer = TelemetryLogger.startTimer();
        
        try {
            const pcmBuffer = Buffer.from(base64PCM, 'base64');
            
            // בודק אם כבר יש כותרת תקינה
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
            TelemetryLogger.error("WavEncoder", "encodeFromBase64", "שגיאה בקידוד קובץ ה-WAV", error);
            throw new IvrInternalError("Failed to encode WAV file.");
        }
    }
}

/**
 * מחלקת AudioProcessor
 * מנקה רעשי רקע של רשת סלולרית לפני העברה לג'מיני כדי לשפר את איכות התמלול.
 */
class AudioProcessor {
    static enhanceWavAudio(buffer, gainMultiplier = 4.5, noiseGateThreshold = 350) {
        TelemetryLogger.info("AudioProcessor", "enhanceWavAudio", `מתחיל עיבוד DSP מתקדם. Gain: ${gainMultiplier}`);
        const timer = TelemetryLogger.startTimer();
        
        try {
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                return buffer; 
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; 

            // חישוב ממוצע להסרת חריגת DC Offset (רעש רקע קבוע)
            let sum = 0;
            let sampleCount = 0;
            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                sum += newBuffer.readInt16LE(i);
                sampleCount++;
            }
            const dcOffset = sampleCount > 0 ? Math.round(sum / sampleCount) : 0;

            // עיבוד הסיגנל (Gate & Gain)
            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                let sample = newBuffer.readInt16LE(i) - dcOffset;
                
                // החרשת רעשים שקטים מתחת לסף
                if (Math.abs(sample) < noiseGateThreshold) {
                    sample = 0; 
                } else {
                    // הגברה וטיפול בעיוות
                    sample = Math.round(sample * gainMultiplier);
                    if (sample > 32767) sample = 32767;
                    if (sample < -32768) sample = -32768;
                }
                newBuffer.writeInt16LE(sample, i);
            }
            
            TelemetryLogger.endTimer("AudioProcessor", "enhanceWavAudio", timer);
            return newBuffer;
        } catch (error) {
            TelemetryLogger.error("AudioProcessor", "enhanceWavAudio", "קריסה בעיבוד השמע", error);
            return buffer; 
        }
    }
}

// ============================================================================
// [6] תשתית HTTP פנימית מבוססת Promises (ללא ספריות 외부)
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

            req.on('error', (e) => {
                TelemetryLogger.error("HttpClient", "request", `Network failure attempting to reach ${url}`, e);
                reject(e);
            });

            req.setTimeout(45000, () => {
                req.destroy();
                reject(new Error("HTTP Request Timeout Exceeded (45s)"));
            });

            if (postData) req.write(postData);
            req.end();
        });
    }
}

// ============================================================================
//[7] מנהל שגיאות ו-Exponential Backoff
// ============================================================================
class RetryHandler {
    static async executeWithBackoff(fn, maxRetries = 4) {
        let retries = 0;
        let delay = 1500; 

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const isRecoverable = error.statusCode === 429 || error.statusCode >= 500 || (error.message && error.message.includes("Timeout"));
                
                if (isRecoverable && retries < maxRetries - 1) {
                    TelemetryLogger.warn("RetryHandler", "executeWithBackoff", `שגיאת ${error.statusCode}. ניסיון חוזר ${retries + 1}/${maxRetries} בעוד ${delay}ms...`);
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
// [8] מחלקת תקשורת מתקדמת מול Gemini AI (STT JSON & TTS)
// ============================================================================
class GeminiManager {
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new GeminiApiError("Missing Gemini API Keys.");
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
     * פונקציה חכמה המבצעת גם תמלול, גם סינון תוכן, גם סיווג וגם ניתוח טון במכה אחת.
     * מחזירה אובייקט חוקי של JSON.
     */
    async transcribeAndModerateAudio(audioBuffer) {
        TelemetryLogger.info("GeminiManager", "transcribeAndModerate", "שולח לג'מיני תמלול + סינון קפדני (Glatt Kosher)...");
        const timer = TelemetryLogger.startTimer();
        
        const enhancedBuffer = AudioProcessor.enhanceWavAudio(audioBuffer, 4.5, 350);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            const postData = JSON.stringify({
                contents: [{
                    parts:[
                        { text: GLATT_KOSHER_PROMPT },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            });

            const response = await HttpClient.request(url, options, postData);
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        TelemetryLogger.endTimer("GeminiManager", "transcribeAndModerate", timer);
        
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            let rawText = result.candidates[0].content.parts[0].text.trim();
            // ניקוי עטיפות markdown של json שמודלי שפה אוהבים להוסיף
            rawText = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
            
            try {
                const parsedData = JSON.parse(rawText);
                return parsedData; // { is_kosher: boolean, text: string, emotion: string, category: string }
            } catch (jsonErr) {
                TelemetryLogger.error("GeminiManager", "ParseJSON", "ג'מיני החזיר פלט שאינו JSON חוקי.", jsonErr);
                throw new IvrInternalError("Failed to parse Gemini JSON output.");
            }
        }
        throw new GeminiApiError("Gemini returned an invalid STT response.", 200, JSON.stringify(result));
    }

    /**
     * TTS חכם: מקבל את הטקסט העשיר (עם הערות במאי בסוגריים) ללא שימוש ב-systemInstruction
     */
    async generateTTS(text, voiceName, emotionCue) {
        TelemetryLogger.info("GeminiManager", "generateTTS", `מפיק הקראה בקול '${voiceName}'.`);
        const timer = TelemetryLogger.startTimer();
        
        // הזרקת הטון לפרומפט בצורה שקופה
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
        TelemetryLogger.endTimer("GeminiManager", "generateTTS", timer);
        
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            // חובה להפעיל מקודד בינארי כדי שימות המשיח יוכלו לנגן!
            return WavEncoder.encodeFromBase64(base64Data, 24000);
        } catch (e) {
            TelemetryLogger.error("GeminiManager", "generateTTS", "שגיאה בפענוח נתוני האודיו מג'מיני", JSON.stringify(result));
            throw new GeminiApiError("Failed to extract Base64 Audio.", 200, JSON.stringify(result));
        }
    }
}

// ============================================================================
// [9] מחלקת תקשורת מתקדמת מול "ימות המשיח" (Yemot API)
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
     * מעלה קובץ אודיו לימות המשיח. מריץ convertAudio=1 לקידוד טלפוני מושלם.
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

// ייצוא מודולים לשימוש בקובץ האינדקס
module.exports = { 
    GeminiManager, 
    YemotManager, 
    GEMINI_VOICES, 
    AudioProcessor, 
    WavEncoder, 
    TelemetryLogger, 
    RetryHandler 
};
