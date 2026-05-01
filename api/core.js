/**
 * @file core.js
 * @description ליבת המערכת - תקשורת מול ימות המשיח, Gemini API ועיבוד שמע (DSP).
 */

const https = require('https');
const crypto = require('crypto');

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
// מנוע עיבוד שמע - מגביר ווליום ומסיר רעשי רקע מקובץ ה-WAV של ימות המשיח
// ============================================================================
function enhanceWavAudio(buffer, gainMultiplier = 3.5, noiseGateThreshold = 300) {
    if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
        return buffer; // מחזיר כמות שהוא אם זה לא קובץ WAV תקין
    }

    const newBuffer = Buffer.from(buffer);
    const dataOffset = 44;

    for (let i = dataOffset; i < newBuffer.length - 1; i += 2) {
        let sample = newBuffer.readInt16LE(i);
        
        // Noise Gate: איפוס רעשי רקע חלשים (רעש סטטי של הטלפון)
        if (Math.abs(sample) < noiseGateThreshold) {
            sample = 0;
        } else {
            // הגברת ווליום
            sample = Math.round(sample * gainMultiplier);
            
            // מניעת צרימה (Clipping)
            if (sample > 32767) sample = 32767;
            if (sample < -32768) sample = -32768;
        }
        newBuffer.writeInt16LE(sample, i);
    }
    return newBuffer;
}

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
        if (postData) req.write(postData);
        req.end();
    });
}

class GeminiManager {
    constructor(apiKeys) {
        this.keys = apiKeys;
        this.currentIndex = 0;
    }

    getKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    async transcribeAudio(audioBuffer) {
        console.log("[Gemini] מתחיל תמלול קובץ אודיו (STT)...");
        
        // הפעלת פילטר סאונד לפני שליחה לג'מיני!
        const enhancedBuffer = enhanceWavAudio(audioBuffer);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this.getKey()}`;
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        const postData = JSON.stringify({
            contents:[{
                parts:[
                    { text: "תמלל את קובץ האודיו הבא במדויק. החזר אך ורק את הטקסט בעברית ללא תוספות, מרכאות או הסברים." },
                    { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                ]
            }]
        });

        const response = await makeHttpRequest(url, options, postData);
        const result = JSON.parse(response.body.toString('utf8'));
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            return result.candidates[0].content.parts[0].text.trim();
        }
        throw new Error("כישלון בפענוח תגובת STT");
    }

    async generateTTS(text, voiceName, systemInstruction = null) {
        console.log(`[Gemini] מתחיל יצירת הקראה (TTS). קול: ${voiceName}...`);
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this.getKey()}`;
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        
        const payload = {
            contents: [{ parts:[{ text: text }] }],
            // התיקון הקריטי: generationConfig במקום config
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName }
                    }
                }
            }
        };

        if (systemInstruction) {
            payload.systemInstruction = {
                parts:[{ text: `הנחיות במאי לסגנון ההקראה: ${systemInstruction}. הקרא את הטקסט בטון זה, אך אל תקריא את ההנחיות עצמן.` }]
            };
        }

        const response = await makeHttpRequest(url, options, JSON.stringify(payload));
        const result = JSON.parse(response.body.toString('utf8'));
        
        try {
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            return Buffer.from(base64Data, 'base64');
        } catch (e) {
            console.error("[Gemini] שגיאה בשליפת המידע הקולי:", JSON.stringify(result));
            throw new Error("כישלון ביצירת קובץ השמע (TTS)");
        }
    }
}

class YemotManager {
    constructor(token) {
        this.token = token;
        this.baseUrl = 'www.call2all.co.il';
    }

    async downloadFile(path) {
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
        return JSON.parse(response.body.toString('utf8'));
    }

    async uploadTextFile(path, text) {
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

    async getNextSequenceFileName(folderPath) {
        const url = `https://${this.baseUrl}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(folderPath)}`;
        try {
            const response = await makeHttpRequest(url, { method: 'GET' });
            const data = JSON.parse(response.body.toString('utf8'));
            if (data.responseStatus !== 'OK' || !data.files) return "000";

            let maxNum = -1;
            for (const file of data.files) {
                const match = file.name.match(/^(\d{3})\.(wav|mp3|ogg)$/);
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

module.exports = { GeminiManager, YemotManager, GEMINI_VOICES };
