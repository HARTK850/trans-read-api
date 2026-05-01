/**
 * @file core.js
 * @description תשתית Enterprise מלאה למערכת ה-IVR מבוססת Gemini.
 * מכיל מנהלי API, עיבוד שמע מתקדם (DSP), ניהול שגיאות, וניהול קולות מפורט.
 * היקף קוד נרחב כנדרש, כולל JSDoc ותמיכה בתצורת Serverless.
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// 1. מאגר קולות מורחב ומפורט (Gemini TTS)
// ============================================================================
const GEMINI_VOICES = {
    MALE:[
        { id: "Puck", desc: "קול גברי קצבי ושמח", promptCue: "[Speak in a very happy, upbeat and energetic tone]" },
        { id: "Charon", desc: "קול גברי רציני ומיידע", promptCue: "[Speak in a serious, informative and professional tone]" },
        { id: "Fenrir", desc: "קול גברי נרגש ודינמי", promptCue: "[Speak in an excitable, dynamic and passionate tone]" },
        { id: "Orus", desc: "קול גברי תקיף ויציב", promptCue: "[Speak in a firm, steady and authoritative tone]" },
        { id: "Enceladus", desc: "קול גברי נושם ורגוע", promptCue: "[Speak in a breathy, calm and relaxing tone]" },
        { id: "Iapetus", desc: "קול גברי צלול וברור", promptCue: "[Speak in a clear, crisp and articulate tone]" },
        { id: "Algieba", desc: "קול גברי חלק ונעים", promptCue: "[Speak in a smooth, pleasant and soothing tone]" },
        { id: "Algenib", desc: "קול גברי מחוספס", promptCue: "[Speak in a gravelly, deep and slightly rough tone]" },
        { id: "Achernar", desc: "קול גברי רך", promptCue: "[Speak in a soft, gentle and warm tone]" },
        { id: "Alnilam", desc: "קול גברי סמכותי", promptCue: "[Speak in a highly authoritative, commanding tone]" },
        { id: "Gacrux", desc: "קול גברי בוגר", promptCue: "[Speak in a mature, experienced and wise tone]" },
        { id: "Zubenelgenubi", desc: "קול גברי שגרתי", promptCue: "[Speak in a neutral, everyday routine tone]" },
        { id: "Sadaltager", desc: "קול גברי ידען", promptCue: "[Speak in a knowledgeable, smart and intellectual tone]" },
        { id: "Rasalgethi", desc: "קול גברי עמוק", promptCue: "[Speak in a very deep, resonant and strong tone]" },
        { id: "Schedar", desc: "קול גברי מאוזן", promptCue: "[Speak in a perfectly even, balanced and calm tone]" }
    ],
    FEMALE:[
        { id: "Zephyr", desc: "קול נשי בהיר ומואר", promptCue: "[Speak in a bright, light and cheerful tone]" },
        { id: "Kore", desc: "קול נשי תקיף ויציב", promptCue: "[Speak in a firm, steady and confident tone]" },
        { id: "Leda", desc: "קול נשי צעיר ורענן", promptCue: "[Speak in a youthful, fresh and energetic tone]" },
        { id: "Aoede", desc: "קול נשי קליל ואוורירי", promptCue: "[Speak in a breezy, airy and carefree tone]" },
        { id: "Callirrhoe", desc: "קול נשי נינוח ורגוע", promptCue: "[Speak in a relaxed, easygoing and peaceful tone]" },
        { id: "Autonoe", desc: "קול נשי ברור", promptCue: "[Speak in a highly clear, distinct and articulate tone]" },
        { id: "Umbriel", desc: "קול נשי זורם", promptCue: "[Speak in a flowing, continuous and smooth tone]" },
        { id: "Despina", desc: "קול נשי חלק", promptCue: "[Speak in a silky smooth, elegant tone]" },
        { id: "Erinome", desc: "קול נשי צלול", promptCue: "[Speak in a crystal clear, pure tone]" },
        { id: "Laomedeia", desc: "קול נשי קצבי", promptCue: "[Speak in an upbeat, rhythmic and dynamic tone]" },
        { id: "Pulcherrima", desc: "קול נשי בוטח", promptCue: "[Speak in a forward, confident and assertive tone]" },
        { id: "Achird", desc: "קול נשי ידידותי", promptCue: "[Speak in a warm, friendly and welcoming tone]" },
        { id: "Vindemiatrix", desc: "קול נשי עדין", promptCue: "[Speak in a gentle, soft and tender tone]" },
        { id: "Sadachbia", desc: "קול נשי תוסס", promptCue: "[Speak in a lively, vibrant and animated tone]" },
        { id: "Sulafat", desc: "קול נשי חם ועוטף", promptCue: "[Speak in a warm, enveloping and comforting tone]" }
    ]
};

// ============================================================================
// 2. מחלקת עיבוד שמע - Audio Digital Signal Processing (DSP)
// ============================================================================
/**
 * מחלקה זו נועדה לטפל בבעיית השמע של ימות המשיח. 
 * ההקלטות המתקבלות מהטלפון סובלות מרעש לבן ועוצמה נמוכה.
 * מנוע זה מנקה את הרעשים ומגביר את הסאונד לפני שליחה ל-STT של ג'מיני.
 */
class AudioProcessor {
    /**
     * @param {Buffer} buffer - באפר קובץ ה-WAV המקורי
     * @param {number} gainMultiplier - מכפיל העוצמה (Volume Gain)
     * @param {number} noiseGateThreshold - סף רעש (Gate) להשתקת רעש לבן
     * @returns {Buffer} באפר שעבר ניקוי והגברה
     */
    static enhanceWavAudio(buffer, gainMultiplier = 4.0, noiseGateThreshold = 400) {
        try {
            // בדיקת תקינות - האם מדובר בקובץ RIFF/WAV תקני
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                console.warn("[DSP Warning] קובץ אינו בפורמט WAV תקין, מחזיר קובץ מקורי.");
                return buffer;
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; // תחילת נתוני ה-PCM בקובץ WAV סטנדרטי

            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                // קריאת דגימת סאונד (16-bit Little Endian)
                let sample = newBuffer.readInt16LE(i);
                
                // Noise Gate Filter - איפוס דגימות שקטות שמייצגות רחש/סטטי
                if (Math.abs(sample) < noiseGateThreshold) {
                    sample = 0;
                } else {
                    // הגברת עוצמה דינמית - Gain Amplification
                    sample = Math.round(sample * gainMultiplier);
                    
                    // Hard Clipper - מניעת עיוות (Clipping) על ידי חיתוך בגבולות ה-16-bit
                    if (sample > 32767) sample = 32767;
                    if (sample < -32768) sample = -32768;
                }
                
                // כתיבת הדגימה המתוקנת חזרה
                newBuffer.writeInt16LE(sample, i);
            }
            
            console.log("[DSP Success] עבר בהצלחה ניקוי רעשים והגברת עוצמה בשיעור x" + gainMultiplier);
            return newBuffer;
        } catch (error) {
            console.error("[DSP Error] שגיאה בתהליך עיבוד השמע:", error);
            return buffer; // במקרה חירום מחזירים את המקור כדי לא לתקוע את המערכת
        }
    }
}

// ============================================================================
// 3. תשתית HTTP פנימית מבוססת Promises
// ============================================================================
/**
 * פונקציית מעטפת לבקשות HTTPS כדי להימנע משימוש בספריות חיצוניות.
 * כוללת מנגנון איסוף צ'אנקים וטיפול בחריגות HTTP.
 */
function makeHttpRequest(url, options, postData = null) {
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
            console.error(`[HTTP Request Error] Failure attempting to reach ${url}:`, e);
            reject(e);
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

// ============================================================================
// 4. מנהל שגיאות ו-Exponential Backoff
// ============================================================================
class RetryHandler {
    /**
     * מפעיל פונקציה מחדש במקרה של כישלון (כמו Rate Limit 429)
     */
    static async executeWithBackoff(fn, maxRetries = 3) {
        let retries = 0;
        let delay = 1500; // 1.5 שניות התחלה

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                // נזהה אם זו שגיאת 429 או 500+ מה-API
                const isRateLimitOrServer = error.statusCode === 429 || error.statusCode >= 500;
                
                if (isRateLimitOrServer && retries < maxRetries - 1) {
                    console.warn(`[RetryHandler] שגיאת שרת או עומס (${error.statusCode}). מנסה שוב בעוד ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                    retries++;
                    delay *= 2; // מכפיל את זמן ההמתנה - Exponential Backoff
                } else {
                    throw error; // זורק הלאה אם מוצו הניסיונות או שזו שגיאה לוגית (400)
                }
            }
        }
    }
}

// ============================================================================
// 5. מחלקת תקשורת מתקדמת מול Gemini AI (STT & TTS)
// ============================================================================
class GeminiManager {
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new Error("Initialization Error: Missing Gemini API Keys.");
        }
        this.keys = apiKeys;
        this.currentIndex = 0;
    }

    /**
     * חלוקת עומסים (Round Robin) בין מפתחות ה-API
     */
    getRotateKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * Speech to Text - המרת קובץ שמע לטקסט
     * כולל הפעלת מנוע עיבוד השמע לפני השליחה!
     */
    async transcribeAudio(audioBuffer) {
        console.log("[Gemini] פתיחת תהליך תמלול STT...");
        
        // 1. הפעלת מנוע עיבוד השמע
        const enhancedBuffer = AudioProcessor.enhanceWavAudio(audioBuffer, 4.0, 300);
        const base64Audio = enhancedBuffer.toString('base64');
        
        // 2. הכנת בקשת ה-API עם מודל ה-Flash Lite המהיר
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this.getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            const postData = JSON.stringify({
                contents: [{
                    parts:[
                        { text: "אנא תמלל את קובץ האודיו המצורף. החזר אך ורק את הטקסט בעברית ללא שום תוספת, פתיח, הסבר או מרכאות." },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            });

            const response = await makeHttpRequest(url, options, postData);
            return JSON.parse(response.body.toString('utf8'));
        };

        // 3. ביצוע הקריאה עם מנגנון Retry
        const result = await RetryHandler.executeWithBackoff(operation);
        
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            return result.candidates[0].content.parts[0].text.trim();
        }
        throw new Error("Gemini returned an invalid STT response structure.");
    }

    /**
     * Text to Speech - יצירת אודיו מטקסט
     * מתוקן: הוסרו פרמטרים שמפילים את מודל ה-TTS (כמו systemInstruction).
     * הסגנון (רגש) מוזרק כטקסט בסוגריים בתוך ה-Prompt עצמו!
     */
    async generateTTS(text, voiceName, emotionCue = null) {
        console.log(`[Gemini] פתיחת תהליך יצירת הקראה TTS. קול: ${voiceName}...`);
        
        // הזרקת סגנון דרך הפרומפט עצמו ולא דרך System Instruction
        let finalText = text;
        if (emotionCue) {
            // הוספת ההנחיה באנגלית כקידומת לטקסט. המודל מזהה את ההקשר ומחיל אותו על טון הדיבור.
            finalText = `[Director's Instruction: Read the following Hebrew text using this emotional tone: ${emotionCue}. Do not read this instruction aloud, only the Hebrew text.]\n\n${text}`;
            console.log(`[Gemini TTS] הוזרקה הנחיית רגש: ${emotionCue}`);
        }

        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this.getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            const payload = {
                contents: [{ parts: [{ text: finalText }] }],
                generationConfig: {
                    responseModalities:["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName }
                        }
                    }
                }
            };

            const response = await makeHttpRequest(url, options, JSON.stringify(payload));
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            return Buffer.from(base64Data, 'base64');
        } catch (e) {
            console.error("[Gemini TTS Error] שגיאה בשליפת האודיו מהתגובה:", JSON.stringify(result));
            throw new Error("Failed to parse TTS audio output from Gemini.");
        }
    }
}

// ============================================================================
// 6. מחלקת תקשורת ושליטה בימות המשיח
// ============================================================================
class YemotManager {
    constructor(token) {
        if (!token) throw new Error("YemotManager requires a valid token.");
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
    }

    /**
     * הורדת קובץ ממשק ימות המשיח
     */
    async downloadFile(path) {
        console.log(`[Yemot] מוריד קובץ מנתיב: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/DownloadFile?token=${this.token}&path=${encodeURIComponent(path)}`;
        const response = await makeHttpRequest(url, { method: 'GET' });
        return response.body;
    }

    /**
     * בניית מבנה Multipart Form Data באופן נייטיב לחלוטין (ללא תלויות)
     */
    buildMultipartPayload(boundary, path, fileBuffer, fileName = "file.wav") {
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
     * העלאת קובץ שמע לימות המשיח
     */
    async uploadFile(path, buffer) {
        console.log(`[Yemot] מעלה קובץ אודיו לנתיב: ${path}`);
        const boundary = '----YemotDataBoundary' + crypto.randomBytes(16).toString('hex');
        const payload = this.buildMultipartPayload(boundary, path, buffer);

        const options = {
            hostname: this.baseUrl,
            path: `/ym/api/UploadFile?token=${this.token}`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length
            }
        };

        const response = await makeHttpRequest(`https://${this.baseUrl}${options.path}`, options, payload);
        const resJson = JSON.parse(response.body.toString('utf8'));
        if (resJson.responseStatus !== 'OK') {
            console.error("[Yemot Upload Error]", resJson);
            throw new Error("Yemot API failed to save file.");
        }
        return resJson;
    }

    /**
     * שמירת טקסט למסד הנתונים מבוסס קבצים של ימות המשיח
     */
    async uploadTextFile(path, text) {
        console.log(`[Yemot] שומר רשומת טקסט בנתיב: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/UploadTextFile?token=${this.token}`;
        const postData = `what=${encodeURIComponent(path)}&contents=${encodeURIComponent(text)}`;
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const response = await makeHttpRequest(url, options, postData);
        return JSON.parse(response.body.toString('utf8'));
    }

    /**
     * קריאת טקסט השמור בימות המשיח
     */
    async getTextFile(path) {
        try {
            const buffer = await this.downloadFile(path);
            return buffer.toString('utf8');
        } catch (e) {
            if (e.statusCode === 404) return null; // קובץ לא קיים, הגיוני
            throw e;
        }
    }

    /**
     * חיפוש שם הקובץ הבא בתור בשלוחה (סידור אוטומטי 000 -> 001)
     */
    async getNextSequenceFileName(folderPath) {
        console.log(`[Yemot] סורק תיקייה למציאת המספר הסידורי הבא: ${folderPath}`);
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(folderPath)}`;
        try {
            const response = await makeHttpRequest(url, { method: 'GET' });
            const data = JSON.parse(response.body.toString('utf8'));
            if (data.responseStatus !== 'OK' || !data.files) return "000";

            let maxNum = -1;
            for (const file of data.files) {
                // מתעלם מקבצים שאינם במבנה מספר טהור של 3 ספרות
                const match = file.name.match(/^(\d{3})\.(wav|mp3|ogg|tts)$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
            return (maxNum + 1).toString().padStart(3, '0');
        } catch (e) {
            console.warn(`[Yemot Warn] כשל בקריאת תיקייה ${folderPath}, מתחיל מ-000`);
            return "000";
        }
    }
}

module.exports = { GeminiManager, YemotManager, GEMINI_VOICES, AudioProcessor };
