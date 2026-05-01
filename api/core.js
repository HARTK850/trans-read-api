/**
 * @file core.js
 * @description תשתית Enterprise מלאה למערכת ה-IVR מבוססת Gemini API וימות המשיח.
 * קובץ זה תוכנן לעמוד בעומסים גבוהים, לספק חווית פיתוח חלקה, ולטפל בכל מקרי הקצה.
 * הקובץ מכיל מעטפות API, ניהול שגיאות מתקדם, לוגים מפורטים, וניהול נתונים.
 * @version 2.5.0
 * @author מערכת אוטומטית מתקדמת
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. מערכת לוגים וניטור (Logger Subsystem)
// ============================================================================

/**
 * מחלקת לוגים מתקדמת להדפסה ברורה וצבעונית בקונסול
 * מסייעת רבות בניפוי שגיאות (Debugging) של מערכות טלפוניות
 */
class Logger {
    static levels = {
        INFO: '[INFO]',
        WARN: '[WARN]',
        ERROR: '[ERROR]',
        DEBUG: '[DEBUG]',
        YEMOT: '[YEMOT-API]',
        GEMINI: '[GEMINI-API]',
        FLOW: '[CALL-FLOW]'
    };

    /**
     * פונקציית עזר להדפסת הלוג עם חותמת זמן מדויקת
     * @param {string} level - רמת הלוג
     * @param {string} message - ההודעה
     * @param {any} [data] - נתונים נוספים
     */
    static _log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logMsg = `${timestamp} ${level} ${message}`;
        
        if (level === this.levels.ERROR) {
            console.error(logMsg);
            if (data) console.error(data);
        } else if (level === this.levels.WARN) {
            console.warn(logMsg);
            if (data) console.warn(data);
        } else {
            console.log(logMsg);
            if (data) console.log(JSON.stringify(data, null, 2));
        }
    }

    static info(msg, data) { this._log(this.levels.INFO, msg, data); }
    static warn(msg, data) { this._log(this.levels.WARN, msg, data); }
    static error(msg, data) { this._log(this.levels.ERROR, msg, data); }
    static debug(msg, data) { this._log(this.levels.DEBUG, msg, data); }
    static yemot(msg, data) { this._log(this.levels.YEMOT, msg, data); }
    static gemini(msg, data) { this._log(this.levels.GEMINI, msg, data); }
    static flow(msg, data) { this._log(this.levels.FLOW, msg, data); }
}

// ============================================================================
// 2. מנגנון HTTP מותאם אישית (Custom HTTP Client)
// ============================================================================

/**
 * שגיאה מותאמת אישית עבור קריאות רשת
 */
class NetworkError extends Error {
    constructor(message, statusCode, responseBody) {
        super(message);
        this.name = 'NetworkError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }
}

/**
 * מנהל בקשות HTTP ללא תלויות חיצוניות (No Axios)
 * כולל מנגנון ניסיונות חוזרים (Retry) אוטומטי במקרה של עומס (503, 429)
 * @param {string} url - כתובת ה-URL
 * @param {object} options - הגדרות הבקשה
 * @param {number} maxRetries - מספר ניסיונות מקסימלי
 * @returns {Promise<object>}
 */
async function makeHttpRequest(url, options, maxRetries = 3) {
    return new Promise((resolve, reject) => {
        let attempt = 0;

        const execute = () => {
            attempt++;
            const req = https.request(url, options, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks);
                    const statusCode = res.statusCode;

                    // במקרה של הצלחה
                    if (statusCode >= 200 && statusCode < 300) {
                        return resolve({ statusCode, headers: res.headers, body });
                    }

                    // במקרה של עומס שרת או בקשות רבות מידי - ננסה שוב
                    if ((statusCode === 503 || statusCode === 429 || statusCode >= 500) && attempt < maxRetries) {
                        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500; // Exponential backoff
                        Logger.warn(`HTTP ${statusCode} | ניסיון חוזר בעוד ${Math.round(delay)}ms (ניסיון ${attempt}/${maxRetries})...`, url);
                        return setTimeout(execute, delay);
                    }

                    // שגיאה קבועה
                    let parsedBody = body.toString('utf8');
                    try { parsedBody = JSON.parse(parsedBody); } catch (e) {}
                    return reject(new NetworkError(`HTTP Error ${statusCode} at ${url}`, statusCode, parsedBody));
                });
            });

            req.on('error', (err) => {
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000;
                    Logger.warn(`Network Error: ${err.message} | ניסיון חוזר...`, url);
                    return setTimeout(execute, delay);
                }
                reject(err);
            });

            // שליחת גוף הבקשה אם קיים
            if (options.body) {
                req.write(options.body);
            }
            
            // טיימר ביטול בקשה ארוכה מידי
            req.setTimeout(45000, () => {
                req.destroy();
                if (attempt < maxRetries) {
                    Logger.warn(`Timeout Error | מנסה שוב...`);
                    execute();
                } else {
                    reject(new Error('Request timed out after multiple attempts'));
                }
            });

            req.end();
        };

        execute();
    });
}

// ============================================================================
// 3. מאגרי מידע - קולות וסגנונות דיבור (Gemini Data Structures)
// ============================================================================

/**
 * מאגר מסודר ומתועד של כל הקולות הזמינים ב-Gemini 2.5 Flash TTS
 * מחולק לקטגוריות לממשק משתמש (IVR) נוח.
 */
const GEMINI_VOICES = {
    MALE: [
        { id: "Puck",        desc: "קול גברי קצבי ושמח", promptCue: "Speak in a very happy, upbeat, and energetic tone." },
        { id: "Charon",      desc: "קול גברי רציני ומיידע", promptCue: "Speak in a serious, informative, and professional tone." },
        { id: "Fenrir",      desc: "קול גברי נרגש ודינמי", promptCue: "Speak in an excitable, dynamic, and passionate tone." },
        { id: "Orus",        desc: "קול גברי תקיף ויציב", promptCue: "Speak in a firm, steady, and authoritative tone." },
        { id: "Enceladus",   desc: "קול גברי נושם ורגוע", promptCue: "Speak in a breathy, calm, and relaxing tone." },
        { id: "Iapetus",     desc: "קול גברי צלול וברור", promptCue: "Speak in a clear, crisp, and articulate tone." },
        { id: "Umbriel",     desc: "קול גברי חלק ונעים", promptCue: "Speak in a smooth, pleasant, and friendly tone." },
        { id: "Algieba",     desc: "קול גברי מחוספס", promptCue: "Speak in a rough, gravelly, and textured tone." },
        { id: "Despina",     desc: "קול גברי רך", promptCue: "Speak in a soft, gentle, and quiet tone." },
        { id: "Erinome",     desc: "קול גברי סמכותי", promptCue: "Speak in an authoritative, commanding, and confident tone." },
        { id: "Algenib",     desc: "קול גברי בוגר", promptCue: "Speak in a mature, wise, and experienced tone." },
        { id: "Rasalgethi",  desc: "קול גברי שגרתי", promptCue: "Speak in a casual, conversational, and everyday tone." },
        { id: "Laomedeia",   desc: "קול גברי ידען", promptCue: "Speak in a knowledgeable, scholarly, and academic tone." },
        { id: "Achernar",    desc: "קול גברי עמוק", promptCue: "Speak in a deep, resonant, and booming tone." },
        { id: "Alnilam",     desc: "קול גברי מאוזן", promptCue: "Speak in a balanced, neutral, and objective tone." }
    ],
    FEMALE: [
        { id: "Kore",        desc: "קול נשי רך ומרגיע", promptCue: "Speak in a soft, soothing, and relaxing tone." },
        { id: "Aoede",       desc: "קול נשי בהיר וצלול", promptCue: "Speak in a bright, clear, and bell-like tone." },
        { id: "Leda",        desc: "קול נשי חם ואימהי", promptCue: "Speak in a warm, motherly, and caring tone." },
        { id: "Callirrhoe",  desc: "קול נשי דינמי ואנרגטי", promptCue: "Speak in a dynamic, energetic, and lively tone." },
        { id: "Autonoe",     desc: "קול נשי סמכותי", promptCue: "Speak in an authoritative, professional, and confident tone." },
        { id: "Zephyr",      desc: "קול נשי שמח וקליל", promptCue: "Speak in a happy, lighthearted, and cheerful tone." },
        { id: "Schedar",     desc: "קול נשי מקצועי", promptCue: "Speak in a professional, corporate, and formal tone." },
        { id: "Gacrux",      desc: "קול נשי נלהב", promptCue: "Speak in an enthusiastic, eager, and excited tone." },
        { id: "Pulcherrima", desc: "קול נשי מתנגן", promptCue: "Speak in a melodic, sing-song, and musical tone." },
        { id: "Achird",      desc: "קול נשי עמוק", promptCue: "Speak in a deep, rich, and velvety female tone." },
        { id: "Zubenelgenubi",desc: "קול נשי צרוד מעט", promptCue: "Speak in a slightly husky, textured, and smoky tone." },
        { id: "Vindemiatrix",desc: "קול נשי מהיר", promptCue: "Speak in a fast, hurried, and urgent tone." },
        { id: "Sadachbia",   desc: "קול נשי דרמטי", promptCue: "Speak in a dramatic, theatrical, and expressive tone." },
        { id: "Sadaltager",  desc: "קול נשי איטי וברור", promptCue: "Speak in a slow, measured, and highly articulate tone." },
        { id: "Sulafat",     desc: "קול נשי לוחש", promptCue: "Speak in a quiet, whispery, and conspiratorial tone." }
    ]
};

/**
 * מאגר סגנונות (Styles) אופציונליים הניתנים להלבשה על הקולות
 */
const VOICE_STYLES = [
    { id: "STYLE_NORMAL", desc: "סגנון רגיל", suffix: "" },
    { id: "STYLE_HAPPY",  desc: "סגנון שמח ונלהב", suffix: " Please speak with absolute joy, excitement, and a big smile." },
    { id: "STYLE_SERIOUS",desc: "סגנון רציני", suffix: " Please speak very seriously, gravely, and without any humor." },
    { id: "STYLE_CUSTOM", desc: "התאמה אישית (לפי הוראות בקובץ)", suffix: " Please follow the exact emotional cues written in the text." }
];

// ============================================================================
// 4. מעטפת API למנוע Gemini (Gemini API Wrapper)
// ============================================================================

/**
 * מחלקה לניהול התקשורת מול מודלי Google Gemini
 * מטפלת בהמרת טקסט לדיבור, ניהול מפתחות, ושמירה על פורמט אודיו מתאים לימות המשיח.
 */
class GeminiManager {
    /**
     * אתחול המנהל
     * @param {string[]} apiKeys - מערך של מפתחות API לגיבוי ורוטציה
     */
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new Error("GeminiManager: No API keys provided");
        }
        this.apiKeys = apiKeys;
        this.currentKeyIndex = 0;
        this.baseUrl = 'generativelanguage.googleapis.com';
        this.modelName = 'gemini-2.5-flash-preview-tts';
    }

    /**
     * קבלת המפתח הפעיל (לצורך חלוקת עומסים ומניעת חסימות)
     * @returns {string}
     */
    _getCurrentKey() {
        return this.apiKeys[this.currentKeyIndex];
    }

    /**
     * מעבר למפתח הבא במקרה של שגיאת Quota
     */
    _rotateKey() {
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        Logger.gemini(`Rotating API Key. Now using index ${this.currentKeyIndex}`);
    }

    /**
     * פונקציה ראשית: המרת טקסט לאודיו
     * @param {string} textToSpeak - הטקסט להקראה
     * @param {string} voiceId - שם הקול מתוך הרשימה (לדוגמה 'Kore')
     * @param {string} [promptSuffix] - הנחיות בימוי נוספות למנוע
     * @returns {Promise<Buffer>} חוזר באפר של קובץ WAV מוכן לשידור
     */
    async generateSpeech(textToSpeak, voiceId, promptSuffix = "") {
        Logger.gemini(`מתחיל יצירת שמע. קול: ${voiceId}, אורך טקסט: ${textToSpeak.length} תווים.`);
        
        let attempt = 0;
        const maxAttempts = this.apiKeys.length * 2; // מאפשר סיבוב של כל המפתחות פעמיים

        while (attempt < maxAttempts) {
            attempt++;
            const apiKey = this._getCurrentKey();
            const path = `/v1beta/models/${this.modelName}:generateContent?key=${apiKey}`;

            // חיבור הטקסט יחד עם הוראות הבימוי, כדי לאלץ את המודל לדבר בסגנון המבוקש
            const fullPromptText = `${voiceId}: ${textToSpeak} ${promptSuffix}`.trim();

            const payload = {
                contents: [{
                    role: "user",
                    parts: [{ text: fullPromptText }]
                }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: voiceId
                            }
                        }
                    }
                }
            };

            const options = {
                hostname: this.baseUrl,
                path: path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            };

            try {
                const response = await makeHttpRequest(`https://${this.baseUrl}${path}`, options, 2);
                const data = JSON.parse(response.body.toString('utf8'));

                if (!data.candidates || data.candidates.length === 0) {
                    throw new Error("Gemini API החזיר תשובה ריקה ללא מועמדים.");
                }

                const content = data.candidates[0].content;
                if (!content || !content.parts || content.parts.length === 0) {
                    throw new Error("Gemini API החזיר תשובה ללא תוכן אודיו חוקי.");
                }

                const inlineData = content.parts[0].inlineData;
                if (inlineData && inlineData.data) {
                    // Gemini מחזיר PCM16 גולמי מקודד Base64.
                    // ימות המשיח צריכה קובץ עם Header (WAV) חוקי.
                    const pcmBuffer = Buffer.from(inlineData.data, 'base64');
                    // חילוץ תדר הדגימה מתוך סוג המדיה, או שימוש בברירת המחדל
                    const mimeType = inlineData.mimeType || 'audio/pcm;rate=24000';
                    const rateMatch = mimeType.match(/rate=(\d+)/);
                    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                    
                    const wavBuffer = this._convertPcmToWav(pcmBuffer, sampleRate);
                    Logger.gemini(`אודיו נוצר בהצלחה. גודל סופי: ${wavBuffer.length} bytes`);
                    return wavBuffer;
                } else if (content.parts[0].text) {
                    // מקרה קצה מתועד בהוראות: לפעמים המודל מחזיר טקסט במקום שמע.
                    Logger.warn(`Gemini חזר עם טקסט במקום אודיו! מבצע ניסיון חוזר מיידי...`);
                    throw new Error("Model returned text tokens instead of audio.");
                } else {
                    throw new Error("מבנה תשובה לא מוכר מ-Gemini.");
                }

            } catch (error) {
                Logger.error(`שגיאה ב-Gemini API (ניסיון ${attempt}):`, error.message);
                
                // בדיקה אם זו שגיאת Quota/הרשאות כדי להחליף מפתח
                if (error instanceof NetworkError && (error.statusCode === 429 || error.statusCode === 403)) {
                    this._rotateKey();
                }

                if (attempt >= maxAttempts) {
                    throw new Error(`כל הניסיונות ליצירת שמע מול Gemini נכשלו. השגיאה האחרונה: ${error.message}`);
                }
            }
        }
    }

    /**
     * פונקציה פנימית: הוספת RIFF Header לנתוני PCM גולמיים לקבלת קובץ WAV תקין
     * @param {Buffer} pcmData - הנתונים הגולמיים
     * @param {number} sampleRate - תדר הדגימה (ברירת מחדל 24000)
     * @returns {Buffer}
     */
    _convertPcmToWav(pcmData, sampleRate) {
        const numChannels = 1;      // מונו
        const byteRate = sampleRate * 2; // 16-bit
        const blockAlign = 2;       // 16-bit mono
        const bitsPerSample = 16;
        
        const dataLength = pcmData.length;
        const fileSize = 36 + dataLength;
        
        const header = Buffer.alloc(44);
        
        // "RIFF"
        header.write('RIFF', 0);
        header.writeUInt32LE(fileSize, 4);
        // "WAVE"
        header.write('WAVE', 8);
        // "fmt "
        header.write('fmt ', 12);
        // Subchunk1Size (16 for PCM)
        header.writeUInt32LE(16, 16);
        // AudioFormat (1 for PCM)
        header.writeUInt16LE(1, 20);
        // NumChannels
        header.writeUInt16LE(numChannels, 22);
        // SampleRate
        header.writeUInt32LE(sampleRate, 24);
        // ByteRate
        header.writeUInt32LE(byteRate, 28);
        // BlockAlign
        header.writeUInt16LE(blockAlign, 32);
        // BitsPerSample
        header.writeUInt16LE(bitsPerSample, 34);
        // "data"
        header.write('data', 36);
        // Subchunk2Size
        header.writeUInt32LE(dataLength, 40);
        
        return Buffer.concat([header, pcmData]);
    }
}

// ============================================================================
// 5. מעטפת API למערכת ימות המשיח (Yemot API Wrapper)
// ============================================================================

/**
 * מחלקה מקיפה לניהול תיקיות, קבצים ותקשורת שרת-לשרת מול ימות המשיח
 */
class YemotManager {
    /**
     * אתחול מנהל ימות המשיח
     * @param {string} token - מפתח הגישה שחזר מהמערכת
     */
    constructor(token) {
        if (!token) throw new Error("YemotManager: Token is required");
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
    }

    /**
     * העלאת קובץ שמע (Buffer) לימות המשיח
     * @param {Buffer} fileBuffer - קובץ השמע בבאפר
     * @param {string} targetPath - נתיב היעד (למשל ivr2:/1/000.wav)
     * @returns {Promise<boolean>}
     */
    async uploadAudioFile(fileBuffer, targetPath) {
        Logger.yemot(`מעלה קובץ שמע לנתיב: ${targetPath} (גודל: ${fileBuffer.length} bytes)`);
        return this._uploadFileWithMultipart(fileBuffer, targetPath, 'audio/wav', 'audio.wav');
    }

    /**
     * העלאת קובץ טקסט למערכת (לשמירת העדפות או תיעוד)
     * @param {string} textContent - תוכן הטקסט
     * @param {string} targetPath - נתיב היעד
     * @returns {Promise<boolean>}
     */
    async uploadTextFile(textContent, targetPath) {
        Logger.yemot(`מעלה קובץ טקסט לנתיב: ${targetPath}`);
        const buffer = Buffer.from(textContent, 'utf8');
        return this._uploadFileWithMultipart(buffer, targetPath, 'text/plain', 'text.txt');
    }

    /**
     * מנוע פנימי לבניית בקשת Multipart/form-data להעלאת קבצים
     * חוסך את הצורך בספריית form-data חיצונית
     */
    async _uploadFileWithMultipart(buffer, targetPath, mimeType, filename) {
        const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
        
        // בניית חלקי גוף הבקשה (Payload)
        const parts = [];
        
        // פרמטר Token
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n${this.token}\r\n`);
        
        // פרמטר נתיב
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\n${targetPath}\r\n`);
        
        // פרמטר הקובץ
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
        
        // סגירה
        const closing = `\r\n--${boundary}--\r\n`;
        
        // שילוב הכל יחד לתוך באפר אחד
        const requestBody = Buffer.concat([
            Buffer.from(parts.join(''), 'utf8'),
            buffer,
            Buffer.from(closing, 'utf8')
        ]);

        const options = {
            hostname: this.baseUrl,
            path: '/ym/api/UploadFile',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': requestBody.length
            },
            body: requestBody
        };

        const response = await makeHttpRequest(`https://${this.baseUrl}/ym/api/UploadFile`, options);
        const data = JSON.parse(response.body.toString('utf8'));
        
        if (data.responseStatus !== 'OK') {
            throw new Error(`Yemot API Upload Failed: ${data.message || JSON.stringify(data)}`);
        }
        return true;
    }

    /**
     * הורדת קובץ (כגון הקלטת המשתמש) משרתי ימות המשיח
     * @param {string} sourcePath - נתיב הקובץ במערכת (למשל /Temp/file.wav)
     * @returns {Promise<Buffer>}
     */
    async downloadFile(sourcePath) {
        Logger.yemot(`מוריד קובץ מנתיב: ivr2:${sourcePath}`);
        const url = `https://${this.baseUrl}/ym/api/DownloadFile?token=${this.token}&path=ivr2:${encodeURIComponent(sourcePath)}`;
        const response = await makeHttpRequest(url, { method: 'GET' });
        return response.body;
    }

    /**
     * יצירת תיקייה במערכת
     * @param {string} folderPath - נתיב התיקייה
     */
    async createFolder(folderPath) {
        Logger.yemot(`מוודא/יוצר תיקייה בנתיב: ${folderPath}`);
        const url = `https://${this.baseUrl}/ym/api/CreateDir?token=${this.token}&path=${encodeURIComponent(folderPath)}`;
        const response = await makeHttpRequest(url, { method: 'GET' });
        const data = JSON.parse(response.body.toString('utf8'));
        // Yemot מחזירה שגיאה אם התיקייה כבר קיימת, אנחנו נתעלם ממנה כי המטרה הושגה
        if (data.responseStatus !== 'OK' && !data.message?.includes('already exists')) {
            Logger.warn(`אזהרה ביצירת תיקייה: ${data.message}`);
        }
        return true;
    }

    /**
     * פונקציה חכמה למציאת המספר הפנוי הבא בשלוחה (000, 001, 002...)
     * @param {string} folderPath - השלוחה לסריקה
     * @returns {Promise<string>}
     */
    async getNextSequenceFileName(folderPath) {
        Logger.yemot(`סורק תיקייה למציאת המספר הסידורי הבא: ${folderPath}`);
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(folderPath)}`;
        try {
            const response = await makeHttpRequest(url, { method: 'GET' });
            const data = JSON.parse(response.body.toString('utf8'));
            if (data.responseStatus !== 'OK' || !data.files) return "000";

            let maxNum = -1;
            for (const file of data.files) {
                // מתעלם מקבצים שאינם במבנה של 3 ספרות (למשל קבצי הגדרות)
                const match = file.name.match(/^(\d{3})\.(wav|mp3|ogg|tts)$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
            return (maxNum + 1).toString().padStart(3, '0');
        } catch (error) {
            Logger.warn(`סריקת התיקייה נכשלה, מחזיר ברירת מחדל '000'. שגיאה: ${error.message}`);
            return "000"; // מנגנון כשל בטוח (Fallback)
        }
    }
}

// ============================================================================
// 6. מחולל התגובות עבור מודול API של ימות המשיח (Yemot Response Builder)
// ============================================================================

/**
 * מחלקה לבניית שרשרת הפקודות החוזרות לימות המשיח מתוך מודול API.
 * דואגת לתחביר מדויק ואמין, למניעת שגיאות הקלדה, ומאפשרת שרשור נוח (Method Chaining).
 */
class YemotBuilder {
    constructor(initialIdListMessage = "") {
        this.commands = [];
        this.apiVars = {};
        if (initialIdListMessage) {
            this.idListMessage = initialIdListMessage;
        }
    }

    /**
     * הוספת השמעת טקסט למשתמש
     * @param {string} text - הטקסט להשמעה
     */
    addText(text) {
        this.commands.push(`t-${text}`);
        return this;
    }

    /**
     * הוספת השמעת קובץ קיים
     * @param {string} filePath - נתיב הקובץ במערכת ימות המשיח
     */
    addFile(filePath) {
        this.commands.push(`f-${filePath}`);
        return this;
    }

    /**
     * הוספת השמעת מקש פנימי של המערכת
     * @param {string} number - מספר
     */
    addNumber(number) {
        this.commands.push(`n-${number}`);
        return this;
    }

    /**
     * הוספת פקודת בקשת נתונים מהמשתמש (תפריט/הקשה)
     * מתוקן: הוסרה דרישת האישור (Confirm=no) כפי שהתבקש
     * @param {string} varName - שם המשתנה שיחזור לשרת
     * @param {string} type - סוג הנתון (לרוב 'Digits')
     * @param {number} max - מקסימום ספרות
     * @param {number} min - מינימום ספרות
     * @param {number} timeout - זמן המתנה להקשה בשניות
     */
    addRead(varName, type = 'Digits', max = 1, min = 1, timeout = 7) {
        const textToRead = this.commands.join('.');
        this.commands = []; // מנקה את רשימת ההשמעות כי הם נכנסו ל-read
        // פורמט read בימות המשיח: [טקסט_להשמעה]^[שם_משתנה]>[ערך_ברירת_מחדל]>[סוג]>[מקסימום]>[מינימום]>[שניות_המתנה]>[האם_להקריא_אישור]>[האם_לאשר]
        // דרישת הלקוח 3: "אחרי כל תפריט הוא אומר לאישור הקישו 1!!!!! אשמח שתוריד את זה מייד!!!!"
        // הפתרון: הפרמטר האחרון הוא No.
        const readCommand = `read^${textToRead}^${varName}>no>${type}>${max}>${min}>${timeout}>No>No`;
        this.commands.push(readCommand);
        return this;
    }

    /**
     * הוספת פקודת הקלטה
     * מתוקן: הופעל תפריט ההקלטה המובנה (PlayMenu=yes)
     * @param {string} filePath - נתיב היעד לשמירת ההקלטה (לרוב קובץ זמני)
     * @param {number} maxSeconds - זמן מקסימלי להקלטה
     */
    addRecord(filePath, maxSeconds = 180) {
        const textToRead = this.commands.join('.');
        this.commands = [];
        // פורמט record בימות המשיח: record^[נתיב_שמירה]^[האם_להשמיע_תפריט_הקלטה_רגיל_כן_לא]^[שניות_מקסימום]^[שניות_שקט_לסיום]^[טקסט_השמעה]
        // דרישת הלקוח 4: "אני רוצה שיהיה תפריט מלא (התפריט המובנה של חברת ימות המשיח)..."
        // הפתרון: הפרמטר השני חייב להיות yes.
        const recordCommand = `record^${filePath}^yes^${maxSeconds}^5^${textToRead}`;
        this.commands.push(recordCommand);
        return this;
    }

    /**
     * שמירת משתנה לזיכרון הסשן של ימות המשיח, כך שיחזור בבקשות הבאות
     * @param {string} key - מזהה המשתנה
     * @param {string} value - ערך המשתנה
     */
    addApiVar(key, value) {
        this.apiVars[key] = value;
        return this;
    }

    /**
     * ניתוב לתיקייה אחרת בסיום ביצוע השרשרת
     * @param {string} folder - יעד הניתוב
     */
    addGoToFolder(folder) {
        this.commands.push(`go_to_folder=${folder}`);
        return this;
    }

    /**
     * בניית המחרוזת הסופית שתשלח חזרה לימות המשיח כתשובת HTTP
     * @returns {string}
     */
    build() {
        let response = "";
        if (this.idListMessage) {
            response += `id_list_message=${this.idListMessage}&`;
        } else if (this.commands.length > 0 && !this.commands[0].startsWith('read') && !this.commands[0].startsWith('record') && !this.commands[0].startsWith('go_to_folder')) {
             response += `id_list_message=${this.commands.join('.')}&`;
        } else {
             // שרשור ישיר של פקודות מתקדמות (read, record, go_to)
             response += this.commands.join('&') + '&';
        }

        // הוספת משתני API אם קיימים
        let i = 0;
        for (const [key, value] of Object.entries(this.apiVars)) {
            response += `api_add_${i}=${key}^${value}&`;
            i++;
        }
        
        return response.slice(0, -1); // מסיר את ה-& האחרון
    }
}

// ייצוא המודולים לשימוש בקובץ הראשי
module.exports = {
    Logger,
    NetworkError,
    GEMINI_VOICES,
    VOICE_STYLES,
    GeminiManager,
    YemotManager,
    YemotBuilder
};
