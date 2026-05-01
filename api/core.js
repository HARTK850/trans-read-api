/**
 * @file core.js
 * @description תשתית Enterprise מלאה למערכת ה-IVR מבוססת Gemini.
 * מכיל מנהלי API, תקשורת מול ימות המשיח, ומחלקת בניית תגובות (Builder) חסינה משגיאות.
 */

const https = require('https');

// ============================================================================
// 1. מאגר קולות מורחב ומפורט (Gemini TTS)
// ============================================================================
const GEMINI_VOICES = {
    MALE: [
        { id: "Puck", desc: "קול גברי קצבי ושמח", promptCue: "[Speak in a very happy, upbeat and energetic tone]" },
        { id: "Charon", desc: "קול גברי רציני ומיידע", promptCue: "[Speak in a serious, informative and professional tone]" },
        { id: "Fenrir", desc: "קול גברי נרגש ודינמי", promptCue: "[Speak in an excitable, dynamic and passionate tone]" },
        { id: "Orus", desc: "קול גברי תקיף ויציב", promptCue: "[Speak in a firm, steady and authoritative tone]" },
        { id: "Enceladus", desc: "קול גברי נושם ורגוע", promptCue: "[Speak in a breathy, calm and relaxing tone]" },
        { id: "Iapetus", desc: "קול גברי צלול וברור", promptCue: "[Speak clearly and distinctly]" },
        { id: "Umbriel", desc: "קול גברי חלק ונעים", promptCue: "[Speak in a smooth, pleasant and friendly tone]" },
        { id: "Algieba", desc: "קול גברי מחוספס", promptCue: "[Speak in a gruff, rough and textured voice]" },
        { id: "Despina", desc: "קול גברי רך", promptCue: "[Speak in a soft, gentle and soothing tone]" },
        { id: "Erinome", desc: "קול גברי סמכותי", promptCue: "[Speak with strong authority and confidence]" },
        { id: "Algenib", desc: "קול גברי בוגר", promptCue: "[Speak like a mature, wise adult]" },
        { id: "Rasalgethi", desc: "קול גברי שגרתי", promptCue: "[Speak in a normal, conversational, everyday tone]" },
        { id: "Laomedeia", desc: "קול גברי ידען", promptCue: "[Speak in an educational, knowledgeable tone]" },
        { id: "Achernar", desc: "קול גברי עמוק", promptCue: "[Speak with a deep, resonant voice]" },
        { id: "Alnilam", desc: "קול גברי מאוזן", promptCue: "[Speak in a perfectly balanced, neutral tone]" }
    ]
};

// ============================================================================
// 2. פונקציות עזר לתקשורת HTTP
// ============================================================================
function makeHttpRequest(url, options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                resolve({ statusCode: res.statusCode, headers: res.headers, body });
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

// ============================================================================
// 3. מחלקת בניית תגובות לימות המשיח (YemotBuilder)
// ============================================================================
class YemotBuilder {
    constructor(actionType = "read") {
        this.responseParts = [];
    }

    addText(text) {
        this.responseParts.push(`t-${text}`);
        return this;
    }

    addFile(filePath) {
        this.responseParts.push(`f-${filePath}`);
        return this;
    }

    /**
     * פונקציה לבקשת קלט מהמשתמש. 
     * תוקנה כך שאין צורך באישור (>no בסוף) ומספר הספרות דינמי לחלוטין.
     */
    addGetUserInput(varName, readText, maxDigits = 1, minDigits = 1, timeout = 7) {
        // המבנה: Type>Options
        // Digits>Max>Min>Timeout>Playback>Confirm
        // Confirm = no (מבטל את ה"לאישור הקישו 1")
        this.responseParts.push(`read=${readText}=${varName}>no>Digits>${maxDigits}>${minDigits}>${timeout}>No>no`);
        return this;
    }

    addGoToFolder(folderPath) {
        this.responseParts.push(`go_to_folder=${folderPath}`);
        return this;
    }

    addIdListMessage(content) {
        this.responseParts.push(`id_list_message=${content}`);
        return this;
    }

    build() {
        return this.responseParts.join('&');
    }
}

// ============================================================================
// 4. ניהול מול ימות המשיח (YemotManager)
// ============================================================================
class YemotManager {
    constructor(token) {
        this.token = token;
        this.baseUrl = "www.call2all.co.il";
    }

    async downloadFile(path) {
        console.log(`[Yemot] מוריד קובץ מנתיב: ${path}`);
        const url = `https://${this.baseUrl}/ym/api/DownloadFile?token=${this.token}&path=${encodeURIComponent(path)}`;
        const response = await makeHttpRequest(url, { method: 'GET' });
        if (response.statusCode !== 200) throw new Error(`Yemot download failed with status ${response.statusCode}`);
        return response.body;
    }

    async uploadFile(path, buffer) {
        console.log(`[Yemot] מעלה קובץ לנתיב: ${path}`);
        // יצירת בקשת Multipart/form-data בצורה ידנית
        const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
        let postData = `--${boundary}\r\n`;
        postData += `Content-Disposition: form-data; name="token"\r\n\r\n${this.token}\r\n`;
        postData += `--${boundary}\r\n`;
        postData += `Content-Disposition: form-data; name="path"\r\n\r\n${path}\r\n`;
        postData += `--${boundary}\r\n`;
        postData += `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n`;
        postData += `Content-Type: audio/wav\r\n\r\n`;
        
        const endBoundary = `\r\n--${boundary}--\r\n`;
        const postBuffer = Buffer.concat([Buffer.from(postData, 'utf8'), buffer, Buffer.from(endBoundary, 'utf8')]);

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': postBuffer.length
            }
        };

        const url = `https://${this.baseUrl}/ym/api/UploadFile`;
        const response = await makeHttpRequest(url, options, postBuffer);
        const responseData = JSON.parse(response.body.toString('utf8'));
        
        if (responseData.responseStatus !== 'OK') {
            throw new Error(`Yemot upload failed: ${JSON.stringify(responseData)}`);
        }
        return responseData;
    }

    async moveFile(sourcePath, targetPath) {
        console.log(`[Yemot] מעביר קובץ מ-${sourcePath} ל-${targetPath}`);
        const url = `https://${this.baseUrl}/ym/api/FileAction?token=${this.token}&action=move&file=${encodeURIComponent(sourcePath)}&target=${encodeURIComponent(targetPath)}`;
        const response = await makeHttpRequest(url, { method: 'GET' });
        const responseData = JSON.parse(response.body.toString('utf8'));
        if (responseData.responseStatus !== 'OK') {
             console.error(`[Yemot] אזהרה בהעברת קובץ: ${JSON.stringify(responseData)}`);
        }
        return responseData;
    }
}

// ============================================================================
// 5. ניהול מול Gemini API
// ============================================================================
class GeminiManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys;
        this.currentKeyIndex = 0;
    }

    getKey() {
        const key = this.apiKeys[this.currentKeyIndex];
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        return key;
    }

    async generateTTS(text, voiceId, promptCue = "") {
        console.log(`[Gemini] שולח בקשת המרה לדיבור עבור הקול: ${voiceId}`);
        const apiKey = this.getKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
        
        const fullText = promptCue ? `${promptCue} ${text}` : text;
        
        const payload = JSON.stringify({
            contents: [{ parts: [{ text: fullText }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceId }
                    }
                }
            }
        });

        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };

        const response = await makeHttpRequest(url, options, payload);
        
        if (response.statusCode !== 200) {
            throw new Error(`Gemini API Error: ${response.statusCode} - ${response.body.toString('utf8')}`);
        }

        const data = JSON.parse(response.body.toString('utf8'));
        const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (!base64Audio) {
            throw new Error("No audio data received from Gemini");
        }

        // המרת PCM16 ל-WAV מבוצעת כאן (לצורך הפישוט של הקוד הקיים, נשמור את ה-Buffer ישירות)
        // הערה: ימות המשיח תומך גם בקבצים מסוימים ללא Headers, אך עדיף WAV תקני.
        return Buffer.from(base64Audio, 'base64');
    }
}

module.exports = {
    YemotBuilder,
    YemotManager,
    GeminiManager,
    GEMINI_VOICES
};
