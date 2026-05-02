/**
 * @file api/core.js
 * @description תשתית Enterprise מלאה למערכת ה-IVR מבוססת Gemini וימות המשיח.
 * קובץ זה מכיל מחלקות תקשורת עצמאיות, ניהול שגיאות (Exponential Backoff), מנוע DSP לניקוי והגברת שמע,
 * ומאגר קולות נרחב. ללא תלויות חיצוניות (Zero Dependencies מלבד ספריות מובנות של Node.js).
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// 1. מאגר הקולות הרשמי של Gemini TTS
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
        { id: "Schedar", desc: "קול גברי מאוזן" }
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
        { id: "Sulafat", desc: "קול נשי חם ועוטף" }
    ]
};

// ============================================================================
// 2. מנוע עיבוד שמע - Audio Digital Signal Processing (DSP)
// ============================================================================
/**
 * מערכת ימות המשיח מקליטה פעמים רבות בווליום נמוך עם רעשי רקע של רשת סלולרית.
 * מחלקה זו מנקה את רעשי הרקע ומגבירה את האודיו כדי ש-Gemini STT יבין אותו בצורה מושלמת.
 */
class AudioProcessor {
    /**
     * @param {Buffer} buffer - קובץ ה-WAV הגולמי
     * @param {number} gainMultiplier - מכפיל העוצמה (כמה להגביר)
     * @param {number} noiseGateThreshold - סף רעש (Gate) להסרת רחשים סטטיים
     * @returns {Buffer} קובץ מוגבר ונקי
     */
    static enhanceWavAudio(buffer, gainMultiplier = 4.0, noiseGateThreshold = 400) {
        try {
            // מוודא שאכן מדובר בקובץ RIFF/WAV סטנדרטי
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                console.warn("[DSP Warning] קובץ אינו בפורמט WAV תקין, מדלג על עיבוד.");
                return buffer;
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; // תחילת המידע הקולי בקובץ WAV נקי

            for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
                let sample = newBuffer.readInt16LE(i);
                
                // Noise Gate - השתקת רעש לבן (Hiss)
                if (Math.abs(sample) < noiseGateThreshold) {
                    sample = 0;
                } else {
                    // הגברת עוצמה (Gain Amplification)
                    sample = Math.round(sample * gainMultiplier);
                    
                    // מניעת עיוות (Hard Clipping)
                    if (sample > 32767) sample = 32767;
                    if (sample < -32768) sample = -32768;
                }
                newBuffer.writeInt16LE(sample, i);
            }
            
            console.log(`[DSP Success] קובץ האודיו הוגבר בהצלחה (x${gainMultiplier}) ונוקה מרעשים.`);
            return newBuffer;
        } catch (error) {
            console.error("[DSP Error] שגיאה פנימית בתהליך ה-DSP:", error);
            return buffer; 
        }
    }
}

// ============================================================================
// 3. תשתית HTTP פנימית מבוססת Promises
// ============================================================================
/**
 * פונקציה לבצוע בקשות HTTP/HTTPS בצורה טהורה ואסינכרונית.
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

        req.on('error', (e) => reject(e));
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

// ============================================================================
// 4. מנהל שגיאות וניסיונות חוזרים (Exponential Backoff)
// ============================================================================
class RetryHandler {
    static async executeWithBackoff(fn, maxRetries = 3) {
        let retries = 0;
        let delay = 1500; 

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                // נזהה אם השרת החזיר שגיאת עומס 429 או שגיאת 5xx
                const isRateLimitOrServer = error.statusCode === 429 || error.statusCode >= 500;
                
                if (isRateLimitOrServer && retries < maxRetries - 1) {
                    console.warn(`[Retry] שגיאת שרת ${error.statusCode}. מנסה שוב בעוד ${delay}ms...`);
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
// 5. מחלקת תקשורת מול Gemini AI
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
     * מחלק מפתחות בשיטת Round Robin למניעת הגעה ל-Rate Limit.
     */
    getRotateKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * STT: תמלול הקלטה פלוס ניתוח רגש/סגנון והוספת הערות בסוגריים עגולים.
     */
    async transcribeAudio(audioBuffer) {
        console.log("[Gemini STT] מפעיל זיהוי קול ואינטליגנציה רגשית...");
        
        // הגברה וניקוי שמע לפני שליחה
        const enhancedBuffer = AudioProcessor.enhanceWavAudio(audioBuffer, 4.5, 350);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this.getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            // פרומפט מיוחד: תמלול + הסקת טון דיבור
            const postData = JSON.stringify({
                contents: [{
                    parts:[
                        { text: "תמלל את קובץ האודיו הבא (שהוא בעברית). נתח את טון הדיבור והרגש של הדובר, והוסף בתחילת כל משפט (או קטע) את סגנון ההקראה המתאים בתוך סוגריים עגולים בלבד (למשל: '(בשמחה ובהתלהבות) שלום לכולם!'). החזר אך ורק את הטקסט הסופי עם הסוגריים העגולים, ללא שום מרכאות, הסברים או מילות פתיחה משלך." },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            });

            const response = await makeHttpRequest(url, options, postData);
            return JSON.parse(response.body.toString('utf8'));
        };

        const result = await RetryHandler.executeWithBackoff(operation);
        
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            return result.candidates[0].content.parts[0].text.trim();
        }
        throw new Error("Gemini returned invalid STT structure.");
    }

    /**
     * TTS: הפקת אודיו מהטקסט (שכולל כבר את הסוגריים העגולים).
     * מודל TTS יתעלם לרוב מקריאת הסוגריים וישנה טון דיבור לפיהן.
     */
    async generateTTS(text, voiceName) {
        console.log(`[Gemini TTS] יוצר הקראה עם הקול: ${voiceName}...`);
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this.getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            // תצורה סטנדרטית נקייה של TTS ללא System Instructions
            const payload = {
                contents: [{ parts: [{ text: text }] }],
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
// 6. מנהל ימות המשיח (הורדה, העלאה, וניהול קבצים)
// ============================================================================
class YemotManager {
    constructor(token) {
        if (!token) throw new Error("YemotManager requires a valid token.");
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
    }

    async downloadFile(path) {
        console.log(`[Yemot Download] מוריד מהנתיב: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/DownloadFile?token=${this.token}&path=${encodeURIComponent(path)}`;
        const response = await makeHttpRequest(url, { method: 'GET' });
        return response.body;
    }

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

    async uploadFile(path, buffer) {
        console.log(`[Yemot Upload] מעלה קובץ שמע לנתיב: ${path}`);
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
        if (resJson.responseStatus !== 'OK') throw new Error("Yemot API failed to save file.");
        return resJson;
    }

    async uploadTextFile(path, text) {
        console.log(`[Yemot Storage] שומר טקסט בנתיב: ${path}`);
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
     * פונקציה חכמה למציאת המספר הסידורי הבא הפנוי בתיקייה
     */
    async getNextSequenceFileName(folderPath) {
        console.log(`[Yemot Auto-Number] מחפש מספר פנוי בתיקייה: ${folderPath}`);
        // ימות דורשת path=/ אם זו תיקיית השורש.
        const cleanPath = (folderPath === "" || folderPath === "/") ? "/" : folderPath;
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(cleanPath)}`;
        
        try {
            const response = await makeHttpRequest(url, { method: 'GET' });
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
            console.warn(`[Yemot Warn] כשל בקריאת תיקייה ${cleanPath}, יוצר קובץ 000.`);
            return "000";
        }
    }
}

module.exports = { GeminiManager, YemotManager, GEMINI_VOICES, AudioProcessor };
