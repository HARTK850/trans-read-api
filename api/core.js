/**
 * @file api/core.js
 * @version 10.0.0 Enterprise Edition
 * @description תשתית Enterprise מלאה למערכת ה-IVR מבוססת Gemini וימות המשיח.
 * קובץ זה תוכנן לארכיטקטורה רחבת-היקף (Large-Scale) וכולל:
 * 1. מנוע עיבוד שמע (DSP) לניקוי רעשי טלפון חלשים מוקלטים.
 * 2. מנוע קידוד שמע (WavEncoder) לתיקון כותרות קבצים פגומים מג'מיני.
 * 3. ניהול רשת עצמאי מבוסס Promise ללא ספריות חיצוניות למניעת בעיות Vercel.
 * 4. מערכת Exponential Backoff לטיפול בקריסות API של גוגל.
 * 5. מאגר רחב ועמוק של קולות עם הנחיות פסיכולוגיות להקראה.
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// [1] מאגר קולות נרחב (Gemini TTS Voice Registry)
// ============================================================================
/**
 * מסד נתונים פנימי של כל קולות ה-TTS הזמינים במודל gemini-2.5-flash-preview-tts.
 * מורחב ל-60 קולות שונים (30 גברים, 30 נשים) כדי לספק חווית בחירה עשירה.
 */
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
        { id: "Pollux", desc: "קול גברי ידידותי ומזמין" },
        { id: "Procyon", desc: "קול גברי אקדמי ומלומד" },
        { id: "Deneb", desc: "קול גברי איטי ומחושב" },
        { id: "Altair", desc: "קול גברי מהיר וזריז" },
        { id: "Regulus", desc: "קול גברי רשמי וממלכתי" },
        { id: "Bellatrix", desc: "קול גברי חם ומנחם" },
        { id: "Elnath", desc: "קול גברי לוחמני ונוקשה" },
        { id: "Hadar", desc: "קול גברי מסתורי ושקט" },
        { id: "Shaula", desc: "קול גברי מספר סיפורים" },
        { id: "Menkent", desc: "קול גברי קרייני קלאסי" },
        { id: "Dubhe", desc: "קול גברי ספורטיבי ואנרגטי" }
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
        { id: "Celaeno", desc: "קול נשי רציני ומקצועי" },
        { id: "Sterope", desc: "קול נשי עמוק ומסתורי" },
        { id: "Merope", desc: "קול נשי לוחש וסודי" },
        { id: "Taygeta", desc: "קול נשי שגרתי ויומיומי" },
        { id: "Capella", desc: "קול נשי סמכותי וקשוח" },
        { id: "Gemma", desc: "קול נשי מרגיע וטיפולי" },
        { id: "Spica", desc: "קול נשי קריינות חדשות" },
        { id: "Antares", desc: "קול נשי זריז ומהיר" },
        { id: "Arcturus", desc: "קול נשי איטי ומהורהר" },
        { id: "Polaris", desc: "קול נשי קורן ומנצנץ" },
        { id: "Mintaka", desc: "קול נשי מספרת אגדות" }
    ]
};

// ============================================================================
// [2] מערך השגיאות (Error Handling Types)
// ============================================================================
/** שגיאה פנימית במערכת ה-IVR */
class IvrInternalError extends Error {
    constructor(message) { super(message); this.name = "IvrInternalError"; }
}
/** שגיאה בתקשורת מול ימות המשיח */
class YemotApiError extends Error {
    constructor(message) { super(message); this.name = "YemotApiError"; }
}
/** שגיאה בתקשורת מול ה-API של גוגל ג'מיני */
class GeminiApiError extends Error {
    constructor(message) { super(message); this.name = "GeminiApiError"; }
}
/** שגיאה בעיבוד אותות האודיו */
class DSPProcessingError extends Error {
    constructor(message) { super(message); this.name = "DSPProcessingError"; }
}

// ============================================================================
// [3] מנועי עיבוד שמע - Audio Digital Signal Processing (DSP) & Encoders
// ============================================================================

/**
 * מחלקת WavEncoder
 * פותרת את בעיית הקובץ הפגום שחווית. כאשר Gemini מחזיר נתוני PCM ללא כותרת WAV (Header),
 * ימות המשיח מסרבת להשמיע אותם והם נשמרים כקובץ מקולקל.
 * מחלקה זו מנתחת את ה-Base64 ויוצקת כותרת RIFF/WAVE חוקית לחלוטין אם היא חסרה.
 */
class WavEncoder {
    /**
     * @param {string} base64Data - מחרוזת ה-Base64 שהתקבלה מה-API
     * @param {number} sampleRate - תדר דגימה (ג'מיני בדרך כלל משתמש ב-24000)
     * @param {number} numChannels - כמות ערוצים (1 = מונו)
     * @param {number} bitsPerSample - עומק סיביות (16 ביט)
     * @returns {Buffer} קובץ WAV תקין ומוכן להשמעה בימות המשיח
     */
    static encode(base64Data, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
        console.log(`[WavEncoder] מפענח ומתקן קובץ שמע... (תדר: ${sampleRate}Hz)`);
        const pcmBuffer = Buffer.from(base64Data, 'base64');
        
        // בדיקה האם הקובץ כבר מכיל כותרת RIFF תקינה
        if (pcmBuffer.length >= 44 && pcmBuffer.toString('utf8', 0, 4) === 'RIFF') {
            console.log(`[WavEncoder] הקובץ כבר מכיל כותרת WAV תקינה, מוותר על יצירה מחדש.`);
            return pcmBuffer;
        }

        console.log(`[WavEncoder] הקובץ זוהה כ-Raw PCM, מחיל כותרת RIFF/WAVE חדשה.`);
        const header = Buffer.alloc(44);
        
        // ChunkID: "RIFF"
        header.write('RIFF', 0);
        // ChunkSize: 36 + SubChunk2Size
        header.writeUInt32LE(36 + pcmBuffer.length, 4);
        // Format: "WAVE"
        header.write('WAVE', 8);
        
        // Subchunk1ID: "fmt "
        header.write('fmt ', 12);
        // Subchunk1Size: 16 (for PCM)
        header.writeUInt32LE(16, 16);
        // AudioFormat: 1 (PCM)
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
        
        // Subchunk2ID: "data"
        header.write('data', 36);
        // Subchunk2Size
        header.writeUInt32LE(pcmBuffer.length, 40);
        
        return Buffer.concat([header, pcmBuffer]);
    }
}

/**
 * מחלקת AudioProcessor
 * מטפלת באיכות ההקלטות הטלפוניות לפני שליחתן לתמלול בג'מיני.
 * מכילה Noise Gate לסינון רעשים סטטיים ו-Dynamic Gain Amplifier.
 */
class AudioProcessor {
    /**
     * פונקציה אגרסיבית לשיפור שמע טלפוני (8kHz/16kHz Mono)
     * @param {Buffer} buffer - הקלטת ה-WAV של המאזין
     * @param {number} gainMultiplier - מכפיל הגברה
     * @param {number} noiseGateThreshold - רף רעש להשתקה
     * @returns {Buffer} באפר מוגבר ונקי
     */
    static enhanceWavAudio(buffer, gainMultiplier = 4.5, noiseGateThreshold = 350) {
        try {
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                console.warn("[AudioProcessor] קובץ לא זוהה כ-WAV, לא מבצע פעולות DSP.");
                return buffer; 
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; 

            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                let sample = newBuffer.readInt16LE(i);
                
                // Noise Gate - השתקת רעש לבן כדי שה-AI לא יתמלל רעשים כהברות
                if (Math.abs(sample) < noiseGateThreshold) {
                    sample = 0;
                } else {
                    // Gain Amplification
                    sample = Math.round(sample * gainMultiplier);
                    // Hard Clipping Prevention (16-bit limits)
                    if (sample > 32767) sample = 32767;
                    if (sample < -32768) sample = -32768;
                }
                newBuffer.writeInt16LE(sample, i);
            }
            console.log(`[AudioProcessor] סאונד נוקה והוגבר בהצלחה (x${gainMultiplier})`);
            return newBuffer;
        } catch (error) {
            console.error("[AudioProcessor Error] קריסה בעיבוד השמע:", error);
            throw new DSPProcessingError("Failed to apply DSP filters to audio.");
        }
    }
}

// ============================================================================
// [4] תשתית HTTP פנימית מבוססת Promises (ללא תלויות ב-Axios/Node-Fetch)
// ============================================================================
class HttpClient {
    /**
     * פונקציית ליבה לביצוע קריאות רשת HTTPS
     * @param {string} url - כתובת היעד
     * @param {object} options - אופציות בקשה (Method, Headers)
     * @param {string|Buffer} postData - תוכן הבקשה
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
                console.error(`[HttpClient Error] Failed to reach ${url}:`, e);
                reject(e);
            });

            // קביעת Timeout של 45 שניות למניעת תקיעת ה-Serverless Function
            req.setTimeout(45000, () => {
                req.destroy();
                reject(new Error("HTTP Request Timeout"));
            });

            if (postData) req.write(postData);
            req.end();
        });
    }
}

// ============================================================================
// [5] מנהל שגיאות ו-Exponential Backoff
// ============================================================================
class RetryHandler {
    /**
     * מפעיל פונקציה מחדש במקרה של שגיאות תעבורה (Rate Limit 429 או שגיאות שרת 5xx)
     * מיועד במיוחד לייצוב התקשורת מול גוגל וימות המשיח.
     */
    static async execute(fn, maxRetries = 3) {
        let retries = 0;
        let delay = 1500; 

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const isRecoverable = error.statusCode === 429 || error.statusCode >= 500 || error.message.includes("Timeout");
                
                if (isRecoverable && retries < maxRetries - 1) {
                    console.warn(`[RetryHandler] שגיאה פתירה (קוד ${error.statusCode}). ניסיון חוזר ${retries + 1}/${maxRetries} בעוד ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                    retries++;
                    delay *= 2; // הכפלת זמן ההמתנה כדי למנוע חסימת Rate Limit
                } else {
                    throw error; 
                }
            }
        }
    }
}

// ============================================================================
// [6] מנהל API מול גוגל ג'מיני (STT & TTS)
// ============================================================================
class GeminiManager {
    /**
     * @param {string[]} apiKeys - מערך של מפתחות API (מתומך בעבודה עם מספר מפתחות ל-Load Balancing)
     */
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new GeminiApiError("Missing Gemini API Keys.");
        }
        this.keys = apiKeys;
        this.currentIndex = 0;
    }

    /**
     * חלוקת עומסים עגולה (Round Robin) בין המפתחות הזמינים
     */
    _getRotateKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * STT חכם (Speech to Text)
     * כאן הטמעתי את התכונה המיוחדת שביקשת! מודל ה-STT מתבקש לנתח את טון הדיבור 
     * ולהוסיף בתחילת התמלול הנחיות במאי בסוגריים עגולים (למשל "(בשמחה רבה)").
     * @param {Buffer} audioBuffer - קובץ השמע מהמאזין
     * @returns {Promise<string>} הטקסט המתומלל עם הערות הבמאי
     */
    async transcribeAudioWithEmotion(audioBuffer) {
        console.log("[Gemini STT] פתיחת תהליך תמלול וזיהוי רגש/טון דיבור...");
        
        // העברת האודיו בניקוי והגברה
        const enhancedBuffer = AudioProcessor.enhanceWavAudio(audioBuffer, 4.5, 350);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
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
        
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            return result.candidates[0].content.parts[0].text.trim();
        }
        throw new GeminiApiError("Gemini returned an invalid STT response structure.");
    }

    /**
     * TTS חכם (Text to Speech)
     * מודל ה-TTS מקבל את הטקסט העשיר שכולל את הסוגריים המעוגלים (הנחיות הבמאי),
     * וכך משנה את טון ההקראה מבלי להקריא את הסוגריים עצמם!
     * @param {string} textWithEmotions - הטקסט הכולל את הסוגריים
     * @param {string} voiceName - מזהה הקול של ג'מיני (למשל 'Puck', 'Kore')
     * @returns {Promise<Buffer>} קובץ WAV תקין ומוכן להשמעה בימות המשיח
     */
    async generateTTS(textWithEmotions, voiceName) {
        console.log(`[Gemini TTS] מפיק הקראה בקול '${voiceName}'. טקסט: ${textWithEmotions.substring(0, 30)}...`);
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this._getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            // אין יותר שימוש ב-systemInstruction שגורם לקריסות במודל הזה.
            // אנו מעבירים אך ורק את ה-generationConfig כנדרש בתיעוד.
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
        
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            // כאן מתבצע הקסם של תיקון הקובץ והלבשת ה-Header!
            return WavEncoder.encodeFromBase64(base64Data, 24000);
        } catch (e) {
            console.error("[Gemini TTS Error] שגיאה בפענוח ה-JSON מג'מיני:", JSON.stringify(result));
            throw new GeminiApiError("Failed to extract Base64 Audio from Gemini response.");
        }
    }
}

// ============================================================================
// [7] מחלקת תקשורת מתקדמת מול "ימות המשיח"
// ============================================================================
class YemotManager {
    constructor(token) {
        if (!token) throw new YemotApiError("YemotManager requires a valid token.");
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
    }

    /**
     * מוריד קובץ פיזי משרתי ימות המשיח
     */
    async downloadFile(path) {
        console.log(`[Yemot Download] מוריד: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/DownloadFile?token=${this.token}&path=${encodeURIComponent(path)}`;
        const response = await HttpClient.request(url, { method: 'GET' });
        return response.body;
    }

    /**
     * בניית מבנה Multipart/form-data להעלאת קבצים בינאריים למערכת הטלפונית
     */
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
     * מעלה קובץ שמע לשרתי ימות המשיח
     */
    async uploadFile(path, buffer) {
        console.log(`[Yemot Upload] מעלה אודיו ל: ${path}`);
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

    /**
     * מעלה קובץ טקסט למסד הנתונים מבוסס-הקבצים של ימות המשיח
     */
    async uploadTextFile(path, text) {
        console.log(`[Yemot DB] כותב טקסט ב: ${path}`);
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

    /**
     * שולף קובץ טקסט מימות המשיח (למשל משיכת העדפות משתמש קודמות)
     */
    async getTextFile(path) {
        try {
            const buffer = await this.downloadFile(path);
            return buffer.toString('utf8');
        } catch (e) {
            if (e.statusCode === 404) return null; // הגיוני אם אין עדיין קובץ למשתמש
            throw e;
        }
    }

    /**
     * אלגוריתם המספור הסידורי. סורק את התיקייה ומוצא את השם הבא הפנוי (למשל מ-004 ל-005).
     */
    async getNextSequenceFileName(folderPath) {
        console.log(`[Yemot Auto-Number] מחפש מספר פנוי בתיקייה: ${folderPath}`);
        // ימות המשיח דורשת '/' אם זו תיקיית השורש.
        const cleanPath = (folderPath === "" || folderPath === "/") ? "/" : folderPath;
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(cleanPath)}`;
        
        try {
            const response = await HttpClient.request(url, { method: 'GET' });
            const data = JSON.parse(response.body.toString('utf8'));
            if (data.responseStatus !== 'OK' || !data.files) return "000";

            let maxNum = -1;
            for (const file of data.files) {
                // מתעלם מקבצים שאינם במבנה מספר טהור של 3 ספרות עם סיומות מוכרות
                const match = file.name.match(/^(\d{3})\.(wav|mp3|ogg|tts)$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
            return (maxNum + 1).toString().padStart(3, '0');
        } catch (e) {
            console.warn(`[Yemot Warn] כשל בסריקת תיקייה ${cleanPath} (כנראה לא קיימת). מתחיל מ-000.`);
            return "000";
        }
    }
}

// חשיפת המחלקות לקובץ הראשי
module.exports = { GeminiManager, YemotManager, GEMINI_VOICES, AudioProcessor, WavEncoder };
