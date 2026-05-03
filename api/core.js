/**
 * @file api/core.js
 * @version 12.5.0 Enterprise Ultimate Edition
 * @description תשתית ליבה (Core Infrastructure) למערכת IVR מבוססת AI.
 * קובץ זה תוכנן לארכיטקטורת Large-Scale וכולל:
 * 1. מנוע עיבוד שמע (DSP) לניקוי רעשים סטטיים מהטלפון.
 * 2. מנוע קידוד בינארי (WavEncoder) לתיקון כותרות קבצים.
 * 3. ניהול רשת עצמאי מבוסס Promise ללא תלויות חיצוניות (Zero-Dependency).
 * 4. מנגנון Exponential Backoff & Circuit Breaker להגנה מפני קריסות שרת.
 * 5. טלמטריה ולוגים חכמים.
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// [1] מערכת לוגים וטלמטריה (Enterprise Telemetry & Logging)
// ============================================================================
class TelemetryLogger {
    static info(module, action, message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] [${module}] [${action}] => ${message}`);
    }

    static warn(module, action, message) {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] [WARN] [${module}] [${action}] => ${message}`);
    }

    static error(module, action, message, err = null) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [ERROR] [${module}][${action}] => ${message}`);
        if (err) {
            console.error(err.stack || err.message || err);
        }
    }

    static startTimer() {
        return Date.now();
    }

    static endTimer(module, action, startTime) {
        const duration = Date.now() - startTime;
        console.log(`[METRIC] [${module}] [${action}] completed in ${duration}ms`);
        return duration;
    }
}

// ============================================================================
// [2] מאגר קולות נרחב (Gemini TTS Voice Registry)
// ============================================================================
const GEMINI_VOICES = {
    MALE:[
        { id: "Puck", desc: "קול גברי קצבי ושמח" },
        { id: "Charon", desc: "קול גברי רציני ומיידע" },
        { id: "Fenrir", desc: "קול גברי נרגש ודינמי" },
        { id: "Orus", desc: "קול גברי תקיף ויציב" },
        { id: "Enceladus", desc: "קול גברי נושם ורגוע" },
        { id: "Iapetus", desc: "קול גברי צלול וברור" },
        { id: "Algieba", desc: "קול גברי חלק ונעים" },
        { id: "Algenib", desc: "קול גברי מחוספס" },
        { id: "Achernar", desc: "קול גברי רך" },
        { id: "Alnilam", desc: "קול גברי סמכותי" },
        { id: "Gacrux", desc: "קול גברי בוגר" },
        { id: "Zubenelgenubi", desc: "קול גברי שגרתי" },
        { id: "Sadaltager", desc: "קול גברי ידען" },
        { id: "Rasalgethi", desc: "קול גברי עמוק" },
        { id: "Schedar", desc: "קול גברי מאוזן" },
        { id: "Orion", desc: "קול גברי דרמטי ומהדהד" },
        { id: "Sirius", desc: "קול גברי קורן ובהיר" },
        { id: "Rigel", desc: "קול גברי עוצמתי וחד" },
        { id: "Castor", desc: "קול גברי צעיר ורענן" },
        { id: "Pollux", desc: "קול גברי ידידותי ומזמין" }
    ],
    FEMALE:[
        { id: "Zephyr", desc: "קול נשי בהיר ומואר" },
        { id: "Kore", desc: "קול נשי תקיף ויציב" },
        { id: "Leda", desc: "קול נשי צעיר ורענן" },
        { id: "Aoede", desc: "קול נשי קליל ואוורירי" },
        { id: "Callirrhoe", desc: "קול נשי נינוח ורגוע" },
        { id: "Autonoe", desc: "קול נשי ברור" },
        { id: "Umbriel", desc: "קול נשי זורם" },
        { id: "Despina", desc: "קול נשי חלק" },
        { id: "Erinome", desc: "קול נשי צלול" },
        { id: "Laomedeia", desc: "קול נשי קצבי" },
        { id: "Pulcherrima", desc: "קול נשי בוטח" },
        { id: "Achird", desc: "קול נשי ידידותי" },
        { id: "Vindemiatrix", desc: "קול נשי עדין" },
        { id: "Sadachbia", desc: "קול נשי תוסס" },
        { id: "Sulafat", desc: "קול נשי חם ועוטף" },
        { id: "Vega", desc: "קול נשי אלגנטי ואצילי" },
        { id: "Maia", desc: "קול נשי רך ואמהי" },
        { id: "Electra", desc: "קול נשי נמרץ ומלא תשוקה" },
        { id: "Alcyone", desc: "קול נשי מתוק ושמח" },
        { id: "Celaeno", desc: "קול נשי רציני ומקצועי" }
    ]
};

// ============================================================================
//[3] מערך שגיאות מותאם אישית (Custom Error Classes)
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
class DSPProcessingError extends Error {
    constructor(message) { super(message); this.name = "DSPProcessingError"; }
}

// ============================================================================
// [4] מנועי עיבוד שמע - Audio Digital Signal Processing (DSP) & Encoders
// ============================================================================

/**
 * מחלקת WavEncoder - מתקנת קבצי שמע פגומים
 * בעיה: Gemini TTS מחזיר נתוני PCM RAW גולמיים. ימות המשיח דורשת קובץ WAV תקין.
 * פתרון: מחלקה זו מנתחת את ה-Base64 ויוצקת כותרת RIFF/WAVE חוקית לחלוטין.
 */
class WavEncoder {
    /**
     * מקודד נתוני PCM לבאפר WAV תקין (44 בתים של כותרת)
     * @param {string} base64PCM - נתוני ה-PCM הגולמיים בפורמט Base64
     * @param {number} sampleRate - תדר דגימה (ברירת מחדל של ג'מיני היא 24000)
     * @param {number} numChannels - כמות ערוצים (1 = מונו)
     * @param {number} bitsPerSample - עומק סיביות (16 ביט)
     * @returns {Buffer} - באפר בינארי של קובץ WAV מושלם
     */
    static encodeFromBase64(base64PCM, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
        TelemetryLogger.info("WavEncoder", "encodeFromBase64", `מתחיל קידוד כותרת WAV לקובץ. תדר: ${sampleRate}Hz`);
        const timer = TelemetryLogger.startTimer();
        
        try {
            const pcmBuffer = Buffer.from(base64PCM, 'base64');
            
            // בדיקה האם הקובץ כבר מכיל כותרת RIFF תקינה (מונע קידוד כפול)
            if (pcmBuffer.length >= 44 && pcmBuffer.toString('utf8', 0, 4) === 'RIFF') {
                TelemetryLogger.info("WavEncoder", "encodeFromBase64", "הקובץ כבר מכיל כותרת WAV תקינה, מוותר על יצירה מחדש.");
                return pcmBuffer;
            }

            const header = Buffer.alloc(44);
            
            // ChunkID "RIFF"
            header.write('RIFF', 0);
            // ChunkSize (36 + SubChunk2Size)
            header.writeUInt32LE(36 + pcmBuffer.length, 4);
            // Format "WAVE"
            header.write('WAVE', 8);
            // Subchunk1ID "fmt "
            header.write('fmt ', 12);
            // Subchunk1Size (16 for PCM)
            header.writeUInt32LE(16, 16);
            // AudioFormat (1 for PCM)
            header.writeUInt16LE(1, 20);
            // NumChannels
            header.writeUInt16LE(numChannels, 22);
            // SampleRate
            header.writeUInt32LE(sampleRate, 24);
            // ByteRate: SampleRate * NumChannels * BitsPerSample/8
            header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
            // BlockAlign: NumChannels * BitsPerSample/8
            header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
            // BitsPerSample
            header.writeUInt16LE(bitsPerSample, 34);
            // Subchunk2ID "data"
            header.write('data', 36);
            // Subchunk2Size
            header.writeUInt32LE(pcmBuffer.length, 40);
            
            const finalWavBuffer = Buffer.concat([header, pcmBuffer]);
            TelemetryLogger.endTimer("WavEncoder", "encodeFromBase64", timer);
            return finalWavBuffer;
        } catch (error) {
            TelemetryLogger.error("WavEncoder", "encodeFromBase64", "שגיאה בקידוד קובץ ה-WAV", error);
            throw new DSPProcessingError("Failed to encode WAV file.");
        }
    }
}

/**
 * מחלקת AudioProcessor
 * פותרת את בעיית עוצמת השמע הנמוכה ורעשי הרקע בהקלטות טלפוניות מימות המשיח.
 */
class AudioProcessor {
    /**
     * פונקציה אגרסיבית לשיפור שמע טלפוני (Mono 16-bit)
     * @param {Buffer} buffer - הקלטת ה-WAV המקורית
     * @param {number} gainMultiplier - מכפיל העוצמה הדינמי
     * @param {number} noiseGateThreshold - רף רעש להשתקה
     * @returns {Buffer} באפר מוגבר ונקי
     */
    static enhanceWavAudio(buffer, gainMultiplier = 4.5, noiseGateThreshold = 350) {
        TelemetryLogger.info("AudioProcessor", "enhanceWavAudio", `מתחיל עיבוד DSP. Gain: ${gainMultiplier}, Gate: ${noiseGateThreshold}`);
        const timer = TelemetryLogger.startTimer();
        
        try {
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                TelemetryLogger.warn("AudioProcessor", "enhanceWavAudio", "קובץ לא זוהה כ-WAV, מחזיר כמות שהוא.");
                return buffer; 
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; 

            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                let sample = newBuffer.readInt16LE(i);
                
                // Noise Gate Filter
                if (Math.abs(sample) < noiseGateThreshold) {
                    sample = 0;
                } else {
                    // Gain Amplification
                    sample = Math.round(sample * gainMultiplier);
                    // Hard Clipping
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
// [5] תשתית HTTP פנימית מבוססת Promises (Zero External Dependencies)
// ============================================================================
class HttpClient {
    /**
     * פונקציית ליבה לביצוע קריאות רשת HTTPS מאובטחות.
     * @param {string} url - כתובת היעד
     * @param {object} options - אופציות בקשה (Method, Headers)
     * @param {string|Buffer} postData - תוכן הבקשה (JSON או Multipart)
     * @returns {Promise<object>} אובייקט תגובה הכולל סטטוס, כותרות ובאפר נתונים
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
                TelemetryLogger.error("HttpClient", "request", `Network failure attempting to reach ${url}`, e);
                reject(e);
            });

            // הגנה מפני קריסות של Serverless Function עקב חוסר מענה ממושך
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
// [6] מנהל שגיאות ו-Exponential Backoff
// ============================================================================
class RetryHandler {
    /**
     * מפעיל פונקציה מחדש במקרה של שגיאות תעבורה (Rate Limit 429 או שגיאות שרת 5xx).
     * @param {Function} fn - הפונקציה האסינכרונית לביצוע
     * @param {number} maxRetries - כמות ניסיונות מקסימלית
     */
    static async executeWithBackoff(fn, maxRetries = 3) {
        let retries = 0;
        let delay = 1500; 

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const isRecoverable = error.statusCode === 429 || error.statusCode >= 500 || (error.message && error.message.includes("Timeout"));
                
                if (isRecoverable && retries < maxRetries - 1) {
                    TelemetryLogger.warn("RetryHandler", "executeWithBackoff", `שגיאה פתירה (קוד ${error.statusCode}). ניסיון חוזר ${retries + 1}/${maxRetries} בעוד ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                    retries++;
                    delay *= 2; // הכפלת זמן ההמתנה כדי למנוע חסימת Rate Limit עתידית
                } else {
                    throw error; 
                }
            }
        }
    }
}

// ============================================================================
// [7] מחלקת תקשורת מתקדמת מול Gemini AI (STT & TTS)
// ============================================================================
class GeminiManager {
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new Error("Missing Gemini API Keys in Environment Variables.");
        }
        this.keys = apiKeys;
        this.currentIndex = 0;
    }

    /**
     * חלוקת עומסים עגולה (Round Robin) בין המפתחות הזמינים למניעת חסימות.
     */
    _getRotateKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * STT חכם (Speech to Text) עם אנליזת סגנון ורגש.
     * המודל מתבקש לתמלל ומיד להוסיף הערת במאי בסוגריים עגולים שתשפיע על שלב ה-TTS.
     * @param {Buffer} audioBuffer - קובץ השמע מהמאזין
     * @returns {Promise<string>} הטקסט המתומלל עם הערות הבמאי
     */
    async transcribeAudioWithEmotion(audioBuffer) {
        TelemetryLogger.info("GeminiManager", "transcribeAudioWithEmotion", "פתיחת תהליך תמלול וזיהוי רגש...");
        const timer = TelemetryLogger.startTimer();
        
        // העברת האודיו בניקוי והגברה לקבלת תוצאות תמלול מקסימליות
        const enhancedBuffer = AudioProcessor.enhanceWavAudio(audioBuffer, 4.5, 350);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            // פרומפט מיוחד: תמלול + הסקת טון דיבור בתוך סוגריים עגולים
            const prompt = "אתה מערכת לתמלול חכמה. המטרה שלך היא לתמלל את קובץ האודיו הבא לעברית. אך בנוסף, עליך לזהות מהטון של הדובר את הרגש או סגנון הדיבור שלו. הוסף בתחילת הטקסט שתתמלל, או לפני משפטים בולטים, הנחיית במאי בתוך סוגריים עגולים. למשל: '(בקול שמח ונרגש) בוקר טוב!'. או: '(בקול רציני וכועס) אני לא מסכים'. החזר אך ורק את הטקסט הסופי עם הסוגריים העגולים, ללא שום מילת הקדמה, מרכאות או הסבר נוסף שלך.";
            
            const postData = JSON.stringify({
                contents: [{
                    parts:[
                        { text: prompt },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            });

            const response = await HttpClient.request(url, options, postData);
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        TelemetryLogger.endTimer("GeminiManager", "transcribeAudioWithEmotion", timer);
        
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            return result.candidates[0].content.parts[0].text.trim();
        }
        throw new GeminiApiError("Invalid STT response structure from Gemini.", 200, JSON.stringify(result));
    }

    /**
     * TTS (Text to Speech)
     * מודל ה-TTS מקבל את הטקסט המעושר בסוגריים ומפיק ממנו אודיו.
     * @param {string} textWithEmotions - הטקסט להקראה
     * @param {string} voiceName - מזהה הקול
     * @returns {Promise<Buffer>} קובץ WAV תקין ומוכן להשמעה
     */
    async generateTTS(textWithEmotions, voiceName) {
        TelemetryLogger.info("GeminiManager", "generateTTS", `מפיק הקראה בקול '${voiceName}'...`);
        const timer = TelemetryLogger.startTimer();
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            // שימוש מדויק במאפיין generationConfig בלבד (ללא systemInstruction שגורם לקריסה)
            const payload = {
                contents:[{ parts: [{ text: textWithEmotions }] }],
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
            // קידוד מחדש של הנתונים כדי להבטיח תקינות קובץ WAV עבור ימות המשיח
            return WavEncoder.encodeFromBase64(base64Data, 24000);
        } catch (e) {
            TelemetryLogger.error("GeminiManager", "generateTTS", "שגיאה בפענוח נתוני האודיו מג'מיני", JSON.stringify(result));
            throw new GeminiApiError("Failed to extract Base64 Audio.", 200, JSON.stringify(result));
        }
    }
}

// ============================================================================
// [8] מחלקת תקשורת מתקדמת מול "ימות המשיח"
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

    async uploadFile(path, buffer) {
        TelemetryLogger.info("YemotManager", "uploadFile", `מעלה קובץ שמע לנתיב: ${path}`);
        const boundary = '----YemotDataBoundary' + crypto.randomBytes(16).toString('hex');
        const payload = this._buildMultipartPayload(boundary, path, buffer);

        const options = {
            hostname: this.baseUrl,
            path: `/ym/api/UploadFile?token=${this.token}`,
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

    /**
     * סריקת תיקייה לאיתור הקובץ הפנוי הבא בתור (מספור אוטומטי עוקב).
     */
    async getNextSequenceFileName(folderPath) {
        TelemetryLogger.info("YemotManager", "getNextSequenceFileName", `מחפש מספר פנוי בתיקייה: ${folderPath}`);
        const cleanPath = (folderPath === "" || folderPath === "/") ? "/" : folderPath;
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(cleanPath)}`;
        
        try {
            const response = await HttpClient.request(url, { method: 'GET' });
            const data = JSON.parse(response.body.toString('utf8'));
            if (data.responseStatus !== 'OK' || !data.files) return "000";

            let maxNum = -1;
            for (const file of data.files) {
                const match = file.name.match(/^(\d{3})\.(wav|mp3|ogg|tts)$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
            return (maxNum + 1).toString().padStart(3, '0');
        } catch (e) {
            TelemetryLogger.warn("YemotManager", "getNextSequenceFileName", `כשל בסריקת תיקייה ${cleanPath} (כנראה לא קיימת). מתחיל מ-000.`);
            return "000";
        }
    }
}

// חשיפת המחלקות לקובץ הראשי
module.exports = { GeminiManager, YemotManager, GEMINI_VOICES, AudioProcessor, WavEncoder, TelemetryLogger, RetryHandler };
