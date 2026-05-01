/**
 * @file core.js
 * @version 3.5.0
 * @description מנוע הליבה של מערכת ה-IVR Gemini.
 * מכיל מנוע DSP לשיפור שמע, ניהול מפתחות בשיטת Round Robin,
 * וטיפול בשגיאות API מתקדם.
 */

const https = require('https');
const crypto = require('crypto');

/**
 * הגדרות קולות Gemini מפורטות
 * כולל הזרקת 'Director Notes' לתוך הטקסט כדי לשלוט בטון ללא systemInstruction
 */
const GEMINI_VOICES = {
    MALE: [
        { id: "Puck", desc: "קול גברי קצבי ושמח", cue: "[Tone: upbeat, cheerful, high energy]" },
        { id: "Charon", desc: "קול גברי רציני ומיידע", cue: "[Tone: serious, professional, informative]" },
        { id: "Fenrir", desc: "קול גברי נרגש ודינמי", cue: "[Tone: excited, dynamic, energetic]" },
        { id: "Orus", desc: "קול גברי תקיף ויציב", cue: "[Tone: firm, stable, confident]" },
        { id: "Enceladus", desc: "קול גברי נושם ורגוע", cue: "[Tone: breathy, calm, relaxing]" },
        { id: "Iapetus", desc: "קול גברי צלול וברור", cue: "[Tone: clear, articulate, crisp]" },
        { id: "Algieba", desc: "קול גברי חלק ונעים", cue: "[Tone: smooth, pleasant, soothing]" },
        { id: "Algenib", desc: "קול גברי מחוספס", cue: "[Tone: gravelly, deep, textured]" },
        { id: "Achernar", desc: "קול גברי רך", cue: "[Tone: soft, gentle, warm]" },
        { id: "Alnilam", desc: "קול גברי סמכותי", cue: "[Tone: authoritative, commanding]" },
        { id: "Gacrux", desc: "קול גברי בוגר", cue: "[Tone: mature, experienced, wise]" },
        { id: "Zubenelgenubi", desc: "קול גברי שגרתי", cue: "[Tone: neutral, common, standard]" },
        { id: "Sadaltager", desc: "קול גברי ידען", cue: "[Tone: knowledgeable, intellectual]" },
        { id: "Rasalgethi", desc: "קול גברי עמוק", cue: "[Tone: deep, resonant]" },
        { id: "Schedar", desc: "קול גברי מאוזן", cue: "[Tone: even, balanced, steady]" }
    ],
    FEMALE: [
        { id: "Zephyr", desc: "קול נשי בהיר ומואר", cue: "[Tone: bright, light, cheerful]" },
        { id: "Kore", desc: "קול נשי תקיף ויציב", cue: "[Tone: firm, confident, assertive]" },
        { id: "Leda", desc: "קול נשי צעיר ורענן", cue: "[Tone: youthful, fresh, lively]" },
        { id: "Aoede", desc: "קול נשי קליל ואוורירי", cue: "[Tone: breezy, airy, light]" },
        { id: "Callirrhoe", desc: "קול נשי נינוח ורגוע", cue: "[Tone: relaxed, peaceful, easygoing]" },
        { id: "Autonoe", desc: "קול נשי ברור", cue: "[Tone: clear, distinct, articulate]" },
        { id: "Umbriel", desc: "קול נשי זורם", cue: "[Tone: flowing, smooth]" },
        { id: "Despina", desc: "קול נשי חלק", cue: "[Tone: smooth, elegant]" },
        { id: "Erinome", desc: "קול נשי צלול", cue: "[Tone: pure, crystal clear]" },
        { id: "Laomedeia", desc: "קול נשי קצבי", cue: "[Tone: rhythmic, upbeat]" },
        { id: "Pulcherrima", desc: "קול נשי בוטח", cue: "[Tone: forward, bold, confident]" },
        { id: "Achird", desc: "קול נשי ידידותי", cue: "[Tone: friendly, warm, inviting]" },
        { id: "Vindemiatrix", desc: "קול נשי עדין", cue: "[Tone: soft, gentle, delicate]" },
        { id: "Sadachbia", desc: "קול נשי תוסס", cue: "[Tone: vibrant, spirited, animated]" },
        { id: "Sulafat", desc: "קול נשי חם ועוטף", cue: "[Tone: warm, comforting, rich]" }
    ]
};

/**
 * מחלקת AudioDSP - עיבוד אותות דיגיטלי לניקוי והגברת שמע
 */
class AudioDSP {
    /**
     * מגביר עוצמה ומנקה רעשי רקע מקובץ WAV 16-bit
     */
    static process(buffer, gain = 4.0, gate = 350) {
        if (buffer.length < 44) return buffer;
        const out = Buffer.from(buffer);
        // PCM Data מתחיל בבייט 44
        for (let i = 44; i < out.length - 1; i += 2) {
            let val = out.readInt16LE(i);
            // Noise Gate: משתיק רעשי רקע חלשים (סטטי)
            if (Math.abs(val) < gate) {
                val = 0;
            } else {
                // הגברה
                val = Math.max(-32768, Math.min(32767, Math.round(val * gain)));
            }
            out.writeInt16LE(val, i);
        }
        return out;
    }
}

/**
 * ביצוע בקשות HTTP בצורה טבעית (Native)
 */
function request(url, options, data = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let chunks = [];
            res.on('data', d => chunks.push(data instanceof Buffer ? d : d));
            res.on('end', () => {
                const body = Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c)));
                if (res.statusCode >= 200 && res.statusCode < 300) resolve({ body, status: res.statusCode });
                else reject({ status: res.statusCode, body: body.toString() });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

/**
 * ניהול Gemini API - תמלול ויצירת קול
 */
class GeminiClient {
    constructor(keys) {
        this.keys = keys;
        this.cursor = 0;
    }

    get key() {
        const k = this.keys[this.cursor];
        this.cursor = (this.cursor + 1) % this.keys.length;
        return k;
    }

    async stt(audio) {
        console.log("[Gemini] תמלול (STT) עם הגברת DSP...");
        const cleanAudio = AudioDSP.process(audio);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${this.key}`;
        const payload = {
            contents: [{
                parts: [
                    { text: "תמלל את האודיו הבא לעברית מדויקת. החזר רק את הטקסט." },
                    { inlineData: { mimeType: "audio/wav", data: cleanAudio.toString('base64') } }
                ]
            }]
        };
        const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify(payload));
        const json = JSON.parse(res.body.toString());
        return json.candidates[0].content.parts[0].text.trim();
    }

    async tts(text, voiceId, styleCue = "") {
        console.log(`[Gemini] יצירת קול (TTS) | קול: ${voiceId}`);
        // הזרקת סגנון לתוך הטקסט (כך המודל משנה טון בלי לקרוס)
        const fullText = styleCue ? `${styleCue}\n${text}` : text;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this.key}`;
        const payload = {
            contents: [{ parts: [{ text: fullText }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } }
            }
        };
        const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify(payload));
        const json = JSON.parse(res.body.toString());
        return Buffer.from(json.candidates[0].content.parts[0].inlineData.data, 'base64');
    }
}

/**
 * ניהול מערכת ימות המשיח
 */
class YemotClient {
    constructor(token) {
        this.token = token;
        this.host = 'www.call2all.co.il';
    }

    async download(path) {
        const url = `https://${this.host}/ym/api/DownloadFile?token=${this.token}&path=${encodeURIComponent(path)}`;
        const res = await request(url, { method: 'GET' });
        return res.body;
    }

    async upload(path, buffer) {
        const boundary = '----YemotBoundary' + crypto.randomBytes(8).toString('hex');
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\n${path}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;
        const payload = Buffer.concat([Buffer.from(header), buffer, Buffer.from(footer)]);
        const opts = {
            hostname: this.host,
            path: `/ym/api/UploadFile?token=${this.token}`,
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length }
        };
        const res = await request(`https://${this.host}${opts.path}`, opts, payload);
        return JSON.parse(res.body.toString());
    }

    async saveText(path, text) {
        const url = `https://${this.host}/ym/api/UploadTextFile?token=${this.token}`;
        const data = `what=${encodeURIComponent(path)}&contents=${encodeURIComponent(text)}`;
        const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, data);
        return JSON.parse(res.body.toString());
    }

    async getNextFile(folder) {
        const url = `https://${this.host}/ym/api/GetIVR2Dir?token=${this.token}&path=${encodeURIComponent(folder)}`;
        try {
            const res = await request(url, { method: 'GET' });
            const data = JSON.parse(res.body.toString());
            let max = -1;
            (data.files || []).forEach(f => {
                const m = f.name.match(/^(\d{3})\./);
                if (m) max = Math.max(max, parseInt(m[1]));
            });
            return (max + 1).toString().padStart(3, '0');
        } catch (e) { return "000"; }
    }
}

module.exports = { GeminiClient, YemotClient, GEMINI_VOICES };
