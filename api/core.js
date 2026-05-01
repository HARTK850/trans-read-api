/**
 * @file core.js
 * @description ליבת המערכת - מכילה את כל התשתיות, מחלקות התקשורת מול ימות המשיח, 
 * ניהול מפתחות Gemini API, עבודה מול שרתי Google, חלוקת עומסים, וטיפול בשגיאות.
 * נכתב במיוחד עבור Vercel Serverless.
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// הגדרות קולות Gemini (30 קולות מחולקים לפי מגדר וסגנון)
// ============================================================================
const GEMINI_VOICES = {
    MALE:[
        { id: "Puck", desc: "קול גברי קצבי ושמח (Upbeat)" },
        { id: "Charon", desc: "קול גברי רציני ומיידע (Informative)" },
        { id: "Fenrir", desc: "קול גברי נרגש ודינמי (Excitable)" },
        { id: "Orus", desc: "קול גברי תקיף ויציב (Firm)" },
        { id: "Enceladus", desc: "קול גברי נושם ורגוע (Breathy)" },
        { id: "Iapetus", desc: "קול גברי צלול וברור (Clear)" },
        { id: "Algieba", desc: "קול גברי חלק ונעים (Smooth)" },
        { id: "Algenib", desc: "קול גברי מחוספס (Gravelly)" },
        { id: "Achernar", desc: "קול גברי רך (Soft)" },
        { id: "Alnilam", desc: "קול גברי תקיף וסמכותי (Firm)" },
        { id: "Gacrux", desc: "קול גברי בוגר ובשל (Mature)" },
        { id: "Zubenelgenubi", desc: "קול גברי שגרתי ויומיומי (Gentle/Routine)" },
        { id: "Sadaltager", desc: "קול גברי ידען וחכם (Knowledgeable)" },
        { id: "Rasalgethi", desc: "קול גברי עמוק ומיידע (Informative)" },
        { id: "Schedar", desc: "קול גברי מאוזן ושקול (Even)" }
    ],
    FEMALE:[
        { id: "Zephyr", desc: "קול נשי בהיר ומואר (Bright)" },
        { id: "Kore", desc: "קול נשי תקיף ויציב (Firm)" },
        { id: "Leda", desc: "קול נשי צעיר ורענן" },
        { id: "Aoede", desc: "קול נשי קליל ואוורירי (Breezy)" },
        { id: "Callirrhoe", desc: "קול נשי נינוח ורגוע" },
        { id: "Autonoe", desc: "קול נשי בהיר וברור (Bright)" },
        { id: "Umbriel", desc: "קול נשי זורם וקליל (Easy-going)" },
        { id: "Despina", desc: "קול נשי חלק (Smooth)" },
        { id: "Erinome", desc: "קול נשי צלול (Clear)" },
        { id: "Laomedeia", desc: "קול נשי קצבי (Upbeat)" },
        { id: "Pulcherrima", desc: "קול נשי ישיר ובוטח (Forward)" },
        { id: "Achird", desc: "קול נשי ידידותי" },
        { id: "Vindemiatrix", desc: "קול נשי עדין ורך (Gentle)" },
        { id: "Sadachbia", desc: "קול נשי חי ותוסס (Lively)" },
        { id: "Sulafat", desc: "קול נשי חם ועוטף" }
    ]
};

// ============================================================================
// מחלקת ניהול מפתחות API (Round Robin & Fallback)
// ============================================================================
class ApiKeyManager {
    constructor(keys) {
        if (!keys || keys.length === 0) {
            throw new Error("חובה לספק לפחות מפתח API אחד של Gemini");
        }
        this.keys = keys;
        this.currentIndex = 0;
        this.failedKeys = new Map(); // שומר מתי מפתח נכשל כדי לא להשתמש בו לזמן מה
    }

    /**
     * קבלת המפתח הבא בתור הפנוי לעבודה (Round Robin)
     * @returns {string} מפתח API
     */
    getNextKey() {
        const now = Date.now();
        const startIndex = this.currentIndex;
        
        do {
            const key = this.keys[this.currentIndex];
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;

            // אם המפתח נכשל ב-60 השניות האחרונות בגלל Rate Limit, דלג עליו
            if (this.failedKeys.has(key)) {
                if (now - this.failedKeys.get(key) < 60000) {
                    continue; 
                } else {
                    this.failedKeys.delete(key); // חלף מספיק זמן, נסה שוב
                }
            }
            return key;
        } while (this.currentIndex !== startIndex);

        // אם כולם נכשלו, נחזיר בכל זאת את הראשון ונקווה לטוב
        return this.keys[0];
    }

    /**
     * דיווח על כישלון מפתח (למשל קוד 429)
     * @param {string} key המפתח שנכשל
     */
    reportFailure(key) {
        this.failedKeys.set(key, Date.now());
        console.warn(`[ApiKeyManager] מפתח הושעה זמנית עקב עומס (Rate Limit).`);
    }
}

// ============================================================================
// פונקציות HTTP בסיסיות מבוססות Node.js Native (ללא ספריות חיצוניות)
// ============================================================================

/**
 * פונקציה לביצוע בקשות HTTP מורכבות, תומכת ב-JSON וב-Buffer
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
// מחלקת התקשורת מול Gemini AI (STT & TTS) עם Exponential Backoff
// ============================================================================
class GeminiManager {
    constructor(apiKeys) {
        this.keyManager = new ApiKeyManager(apiKeys);
    }

    /**
     * מנגנון Exponential Backoff לטיפול בקריאות שנכשלות עקב עומס
     */
    async requestWithBackoff(urlFn, optionsFn, postDataFn, maxRetries = 3) {
        let retries = 0;
        let delay = 1000; // התחלה בשנייה אחת

        while (retries < maxRetries) {
            const currentKey = this.keyManager.getNextKey();
            const url = urlFn(currentKey);
            const options = optionsFn();
            const postData = postDataFn();

            try {
                const response = await makeHttpRequest(url, options, postData);
                return JSON.parse(response.body.toString('utf8'));
            } catch (error) {
                if (error.statusCode === 429) {
                    this.keyManager.reportFailure(currentKey);
                    console.log(`[Gemini Backoff] שגיאת 429. ניסיון ${retries + 1} מתוך ${maxRetries}. ממתין ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    retries++;
                    delay *= 2; // הכפלת זמן ההמתנה
                } else {
                    console.error("[Gemini API Error]", error);
                    throw error;
                }
            }
        }
        throw new Error("Gemini API נכשל לאחר מספר ניסיונות מקסימלי (Rate Limit).");
    }

    /**
     * תמלול אודיו לטקסט (Speech to Text)
     * מודל: gemini-3.1-flash-lite-preview
     * @param {Buffer} audioBuffer באפר של קובץ האודיו (wav)
     * @returns {Promise<string>} הטקסט המתומלל
     */
    async transcribeAudio(audioBuffer) {
        console.log("[Gemini] מתחיל תמלול קובץ אודיו (STT)...");
        const base64Audio = audioBuffer.toString('base64');
        
        const urlFn = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`;
        const optionsFn = () => ({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const postDataFn = () => JSON.stringify({
            contents:[{
                parts:[
                    { text: "תמלל את קובץ האודיו הבא במדויק. החזר אך ורק את הטקסט בעברית ללא תוספות, מרכאות או הסברים." },
                    {
                        inlineData: {
                            mimeType: "audio/wav",
                            data: base64Audio
                        }
                    }
                ]
            }]
        });

        const result = await this.requestWithBackoff(urlFn, optionsFn, postDataFn);
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            return result.candidates[0].content.parts[0].text.trim();
        }
        throw new Error("כישלון בפענוח תגובת STT מ-Gemini");
    }

    /**
     * המרת טקסט לקול (Text to Speech)
     * מודל: gemini-2.5-flash-preview-tts
     * @param {string} text הטקסט להקראה
     * @param {string} voiceName שם הקול (למשל 'Kore', 'Puck')
     * @param {string} systemInstruction הנחיות סגנון מותאמות אישית למודל
     * @returns {Promise<Buffer>} באפר של קובץ ה-wav המיוצר
     */
    async generateTTS(text, voiceName, systemInstruction = null) {
        console.log(`[Gemini] מתחיל יצירת הקראה (TTS). קול: ${voiceName}...`);
        
        const urlFn = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`;
        const optionsFn = () => ({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const postDataFn = () => {
            const payload = {
                contents: [{ parts:[{ text: text }] }],
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName }
                        }
                    }
                }
            };

            // אם הוזן סגנון מותאם אישית, אנו מכניסים אותו כהנחיית מערכת שתשפיע על טון הדיבור
            // על פי התיעוד של Gemini, ניתן להעביר הנחיות מערכת
            if (systemInstruction) {
                payload.systemInstruction = {
                    parts:[{ text: `הנחיות במאי לסגנון ההקראה: ${systemInstruction}. הקרא את הטקסט בטון זה, אך אל תקריא את ההנחיות עצמן.` }]
                };
            }

            return JSON.stringify(payload);
        };

        const result = await this.requestWithBackoff(urlFn, optionsFn, postDataFn);
        
        // שליפת נתוני ה-AUDIO מהתגובה (Base64)
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            return Buffer.from(base64Data, 'base64');
        } catch (e) {
            console.error("[Gemini] שגיאה בשליפת המידע הקולי מהתגובה:", JSON.stringify(result));
            throw new Error("כישלון ביצירת קובץ השמע (TTS)");
        }
    }
}

// ============================================================================
// מחלקת תקשורת מול מערכת ימות המשיח (הורדה, העלאה, וניהול קבצים)
// ============================================================================
class YemotManager {
    /**
     * @param {string} token טוקן ההתחברות לימות המשיח (למשל '0773137770:1234')
     */
    constructor(token) {
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
    }

    /**
     * הורדת קובץ משלוחה בימות המשיח
     * @param {string} path נתיב הקובץ (למשל 'ivr2:/1/000.wav')
     * @returns {Promise<Buffer>} באפר הקובץ
     */
    async downloadFile(path) {
        console.log(`[Yemot] מוריד קובץ מנתיב: ${path}`);
        const pathEncoded = encodeURIComponent(path);
        const url = `https://${this.baseUrl}/ym/api/DownloadFile?token=${this.token}&path=${pathEncoded}`;
        
        const response = await makeHttpRequest(url, { method: 'GET' });
        return response.body;
    }

    /**
     * פונקציה פנימית ליצירת Multipart Form Data באופן טהור ב-Node.js
     * מונעת את הצורך בספריית 'form-data' החיצונית.
     */
    buildMultipartPayload(boundary, path, fileBuffer, fileName = "file.wav") {
        const crlf = "\r\n";
        let payload = Buffer.alloc(0);

        // שדה path
        let part1 = `--${boundary}${crlf}`;
        part1 += `Content-Disposition: form-data; name="path"${crlf}${crlf}`;
        part1 += `${path}${crlf}`;
        payload = Buffer.concat([payload, Buffer.from(part1, 'utf8')]);

        // שדה file
        let part2 = `--${boundary}${crlf}`;
        part2 += `Content-Disposition: form-data; name="file"; filename="${fileName}"${crlf}`;
        part2 += `Content-Type: audio/wav${crlf}${crlf}`;
        payload = Buffer.concat([payload, Buffer.from(part2, 'utf8'), Buffer.from(crlf, 'utf8')]);

        // סיום
        const endPart = `--${boundary}--${crlf}`;
        payload = Buffer.concat([payload, Buffer.from(endPart, 'utf8')]);

        return payload;
    }

    /**
     * העלאת קובץ שמע לימות המשיח
     * @param {string} path נתיב היעד (למשל 'ivr2:/2/005.wav')
     * @param {Buffer} buffer באפר הקובץ
     */
    async uploadFile(path, buffer) {
        console.log(`[Yemot] מעלה קובץ לנתיב: ${path}`);
        const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
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
            throw new Error(`שגיאה בהעלאת קובץ לימות המשיח: ${JSON.stringify(resJson)}`);
        }
        return resJson;
    }

    /**
     * העלאת קובץ טקסט למערכת ימות המשיח (לשמירת העדפות משתמש)
     * @param {string} path נתיב מלא (למשל 'ivr2:/Preferences/0501234567.txt')
     * @param {string} text תוכן הטקסט
     */
    async uploadTextFile(path, text) {
        console.log(`[Yemot] שומר טקסט בנתיב: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/UploadTextFile?token=${this.token}`;
        
        // שימוש ב-URL Encoded Data עבור UploadTextFile כפי שמוגדר בתיעוד
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
     * קריאת קובץ טקסט מימות המשיח (משיכת העדפות)
     * @param {string} path נתיב מלא
     * @returns {Promise<string|null>} התוכן או null אם לא קיים
     */
    async getTextFile(path) {
        try {
            const buffer = await this.downloadFile(path);
            return buffer.toString('utf8');
        } catch (e) {
            if (e.statusCode === 404) return null; // קובץ לא קיים
            throw e;
        }
    }

    /**
     * מציאת המספר הסידורי הבא הפנוי בתיקייה (000, 001, -> 002)
     * נעשה על ידי קריאה ל-GetIVR2Dir וחישוב הקובץ הגדול ביותר.
     * @param {string} folderPath נתיב התיקייה ללא 'ivr2:/' (למשל '1/2')
     * @returns {Promise<string>} שם הקובץ הבא (למשל '002')
     */
    async getNextSequenceFileName(folderPath) {
        console.log(`[Yemot] מאתר את המספר הסידורי הבא בתיקייה: ${folderPath}`);
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(folderPath)}`;
        
        try {
            const response = await makeHttpRequest(url, { method: 'GET' });
            const data = JSON.parse(response.body.toString('utf8'));
            
            if (data.responseStatus !== 'OK' || !data.files) {
                return "000"; // תיקייה חדשה או שגיאה כלשהי שמאפשרת יצירה
            }

            let maxNum = -1;
            // עובר על כל הקבצים ומחפש קבצי שמע עם שם מספרי טהור של 3 ספרות
            for (const file of data.files) {
                const match = file.name.match(/^(\d{3})\.(wav|mp3|ogg)$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }

            const nextNum = maxNum + 1;
            return nextNum.toString().padStart(3, '0');

        } catch (e) {
            console.error("[Yemot] שגיאה בקבלת תוכן התיקייה (אולי אינה קיימת עדיין):", e.message);
            // אם התיקייה לא קיימת, נתחיל מ-000
            return "000";
        }
    }
}

module.exports = {
    GeminiManager,
    YemotManager,
    GEMINI_VOICES
};
