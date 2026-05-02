/**
 * @file api/core.js
 * @description תשתית Enterprise מלאה למערכת ה-IVR מבוססת Gemini וימות המשיח.
 * קובץ זה מכיל מחלקות תקשורת, ניהול שגיאות, מנועי עיבוד שמע (DSP ו-WAV Encoding), 
 * ומאגר קולות נרחב. הכל ללא תלויות חיצוניות (Zero Dependencies).
 * @version 3.0.0 Enterprise Edition
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
// 2. מנוע עיבוד שמע - WAV Encoder & DSP
// ============================================================================
/**
 * מחלקת WavEncoder - פותרת את בעיית ה"קובץ הפגום".
 * Gemini TTS מחזיר נתוני PCM RAW גולמיים. ימות המשיח דורשת קובץ WAV תקין עם כותרת (Header).
 * מחלקה זו לוקחת את ה-Base64 מ-Gemini ומרכיבה עליו כותרת RIFF/WAVE חוקית לחלוטין.
 */
class WavEncoder {
    /**
     * @param {string} base64PCM - נתוני ה-PCM הגולמיים בפורמט Base64
     * @param {number} sampleRate - תדר הדגימה (ברירת מחדל של ג'מיני היא 24000)
     * @returns {Buffer} - באפר בינארי של קובץ WAV מושלם
     */
    static encodeFromBase64(base64PCM, sampleRate = 24000) {
        console.log(`[WavEncoder] מתחיל קידוד כותרת WAV לקובץ. תדר: ${sampleRate}Hz`);
        
        // 1. המרת Base64 למערך בינארי גולמי
        const pcmBuffer = Buffer.from(base64PCM, 'base64');
        
        // 2. יצירת כותרת WAV באורך 44 בתים (Standard RIFF Header)
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
        // NumChannels (1 for Mono)
        header.writeUInt16LE(1, 22);
        // SampleRate
        header.writeUInt32LE(sampleRate, 24);
        // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
        header.writeUInt32LE(sampleRate * 2, 28);
        // BlockAlign (NumChannels * BitsPerSample/8)
        header.writeUInt16LE(2, 32);
        // BitsPerSample (16-bit)
        header.writeUInt16LE(16, 34);
        
        // Subchunk2ID "data"
        header.write('data', 36);
        // Subchunk2Size (length of PCM data)
        header.writeUInt32LE(pcmBuffer.length, 40);
        
        // 3. חיבור הכותרת והנתונים לקובץ אחד
        const finalWavBuffer = Buffer.concat([header, pcmBuffer]);
        console.log(`[WavEncoder] קובץ ה-WAV נוצר בהצלחה. גודל סופי: ${finalWavBuffer.length} bytes`);
        
        return finalWavBuffer;
    }
}

/**
 * מחלקת AudioProcessor - עיבוד שמע והגברה להקלטות מהטלפון (STT)
 */
class AudioProcessor {
    /**
     * מנקה רעשי רקע של רשת סלולרית ומגביר את עוצמת השמע כדי שג'מיני יבין את המילים במדויק.
     */
    static enhanceWavAudio(buffer, gainMultiplier = 4.0, noiseGateThreshold = 400) {
        try {
            if (buffer.length < 44 || buffer.toString('utf8', 0, 4) !== 'RIFF') {
                return buffer; 
            }

            const newBuffer = Buffer.from(buffer);
            const dataOffset = 44; 

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
    static async executeWithBackoff(fn, maxRetries = 3) {
        let retries = 0;
        let delay = 1500; 

        while (retries < maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const isRateLimitOrServer = error.statusCode === 429 || error.statusCode >= 500;
                
                if (isRateLimitOrServer && retries < maxRetries - 1) {
                    console.warn(`[RetryHandler] עומס שרת (${error.statusCode}). מנסה שוב בעוד ${delay}ms...`);
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

    getRotateKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }

    /**
     * Speech to Text - המרת קובץ שמע לטקסט
     * כולל אינטליגנציה רגשית (ניתוח טון והוספת הערות בסוגריים עגולים)
     */
    async transcribeAudio(audioBuffer) {
        console.log("[Gemini] פתיחת תהליך תמלול STT והסקת טון דיבור...");
        
        const enhancedBuffer = AudioProcessor.enhanceWavAudio(audioBuffer, 4.5, 350);
        const base64Audio = enhancedBuffer.toString('base64');
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this.getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            // פרומפט מיוחד: תמלול + הסקת טון דיבור בתוך סוגריים עגולים
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
        throw new Error("Gemini returned an invalid STT response structure.");
    }

    /**
     * Text to Speech - יצירת אודיו מטקסט דרך Gemini
     * עושה שימוש ב-WavEncoder כדי להבטיח קובץ חוקי שיתנגן בימות המשיח.
     */
    async generateTTS(text, voiceName) {
        console.log(`[Gemini TTS] יוצר הקראה TTS. קול: ${voiceName}...`);
        
        const operation = async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this.getRotateKey()}`;
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            
            const payload = {
                contents:[{ parts: [{ text: text }] }],
                // שים לב: systemInstruction הוסר מכאן לחלוטין למניעת שגיאת 400.
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
            // הנתונים שחוזרים מכאן הם PCM גולמי ללא כותרת
            const base64Data = result.candidates[0].content.parts[0].inlineData.data;
            
            // קוראים למחלקה שיצרנו כדי להלביש כותרת WAV תקנית על ה-PCM
            const finalWavBuffer = WavEncoder.encodeFromBase64(base64Data, 24000);
            
            return finalWavBuffer;
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

    async getNextSequenceFileName(folderPath) {
        console.log(`[Yemot Auto-Number] מחפש מספר פנוי בתיקייה: ${folderPath}`);
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

module.exports = { GeminiManager, YemotManager, GEMINI_VOICES, AudioProcessor, WavEncoder };
