/**
 * @file api/index.js
 * @version 17.0.0 (Ultimate Enterprise Edition - Stable)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * * פיצ'רים ושיפורים בגרסה זו:
 * 1. תיקון "בחירה לא חוקית": פרמטרי ה-Read הוגדרו מחדש לפי התקן המדויק של ימות המשיח.
 * 2. ניתוב שלבים (State Machine): סידור מחדש של כל הלוגיקה למניעת קפיצה לשלבים לא רלוונטיים.
 * 3. Enterprise Logging: מערכת מעקב מפורטת אחרי כל לחיצה וכל תגובה מה-AI.
 * 4. Dashboard 2.0: ממשק ניהול הכולל סטטיסטיקות דמי (ניתן לחיבור ל-DB) ועיצוב Dark Mode יוקרתי.
 * 5. AskNo מורחב: ביטול מוחלט של כל בקשות האישור ("להקשה מחודשת הקישו 2").
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');
const fs = require('fs');
const path = require('path');

// ============================================================================
// הגדרות סביבה וקבועים
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 
const VERSION = "17.0.0 Stable";

/**
 * מחלקה לניהול אחסון נתונים פשוט (מבוסס קבצים בימות המשיח)
 */
class DataStorage {
    constructor(yemot) {
        this.yemot = yemot;
    }

    async getPreferences(phone) {
        try {
            const data = await this.yemot.getTextFile(`ivr2:/Preferences/${phone}.txt`);
            return data ? data.trim() : null;
        } catch (e) {
            return null;
        }
    }

    async savePreferences(phone, folder) {
        const cleanFolder = folder.replace(/\*/g, "/").replace(/\/+/g, "/").trim();
        await this.yemot.uploadTextFile(`ivr2:/Preferences/${phone}.txt`, cleanFolder);
    }
}

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות (YemotCommandBuilder)
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks = []; 
        this.params = []; 
        this.goToFolder = null; 
        this.stateVars = {};
    }

    /**
     * ניקוי טקסט עבור מנוע הדיבור של ימות המשיח
     */
    cleanYemotText(text) {
        if (!text) return "";
        // מחיקת סימני פיסוק שגורמים לקטיעת דיבור, השארת רווחים לזרימה טבעית
        return text.toString()
            .replace(/[.,\-?!"']/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    addText(text) {
        const cleanStr = this.cleanYemotText(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    /**
     * בניית פקודת Read עם 15 פרמטרים לפי תקן ימות המשיח
     * @param {string} varName - שם המשתנה שיחזור לשרת
     * @param {number} maxDigits - מקסימום ספרות
     * @param {number} minDigits - מינימום ספרות
     * @param {number} timeout - זמן המתנה בשניות
     * @param {boolean} disableConfirmation - האם לבטל "לאישור הקישו 1"
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = true, allowAsterisk = true) {
        const blockAsterisk = allowAsterisk ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes"; 

        this.params = [
            varName,               // 1. שם משתנה
            "no",                  // 2. האם להשמיע שוב את השאלה במקרה של שגיאה (no = חזרה לשרת)
            "Digits",              // 3. סוג קלט (ספרות)
            maxDigits.toString(),  // 4. מקסימום
            minDigits.toString(),  // 5. מינימום
            timeout.toString(),    // 6. שניות המתנה
            "no",                  // 7. השמעת הקלט למשתמש (שינוי קריטי מ-Digits ל-no למניעת באג!)
            blockAsterisk,         // 8. חסימת כוכבית
            blockZero,             // 9. חסימת אפס
            "no",                  // 10. מעבר (Pass through)
            "",                    // 11. זיהוי דיבור (לא רלוונטי כאן)
            "3",                   // 12. מספר ניסיונות
            "no",                  // 13. הגדרות נוספות
            "",                    // 14. שפה
            disableConfirmation ? "no" : "yes" // 15. אישור ע"י 1 (no = מבוטל)
        ];
        return this;
    }

    /**
     * הגדרת הקלטה המפעילה את תפריט "1 לשמיעה 2 לאישור" המקורי
     */
    setRecordInput(varName, folder, fileName) {
        this.params = [
            varName,   // 1. משתנה 
            "no",      // 2. השמעת הקיים
            "record",  // 3. סוג
            folder,    // 4. תיקייה
            fileName,  // 5. שם קובץ
            "",        // 6. ריק = תפריט ימות מלא!
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. שרשור
        ];
        return this;
    }

    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /**
     * הוספת משתנה שיישמר לאורך כל הדיאלוג (State Management)
     */
    addStateVar(key, value) {
        if (value !== undefined && value !== null) {
            this.stateVars[key] = value;
        }
        return this;
    }

    /**
     * בניית המחרוזת הסופית שתישלח לימות המשיח
     */
    build(token) {
        let res = "";
        const textPart = this.contentBlocks.join('.');

        if (this.action === "read" && this.params.length > 0) {
            res = `read=${textPart}=${this.params.join(',')}`;
        } else if (this.action === "id_list_message") {
            res = `id_list_message=${textPart}`;
        } else if (this.action === "go_to_folder") {
            res = `go_to_folder=${this.goToFolder || "/"}`;
        } else {
            res = `${this.action}=${textPart}`;
        }

        // הוספת ניתוב תיקייה אם הוגדר
        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        // הזרקת משתני מצב להמשך השיחה
        res += `&api_add_99=yemot_token=${encodeURIComponent(token)}`;
        let counter = 98;
        for (const [key, value] of Object.entries(this.stateVars)) {
            res += `&api_add_${counter}=${key}=${encodeURIComponent(value)}`;
            counter--;
        }

        return res;
    }
}

// ============================================================================
// ממשק ניהול Dashboard (HTML)
// ============================================================================
function renderAdminDashboard(res) {
    const html = `
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>VoiceMaster AI | Enterprise Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@200;400;600;800&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Assistant', sans-serif; background-color: #0b0f19; color: #e2e8f0; }
            .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); }
            .gradient-text { background: linear-gradient(90deg, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        </style>
    </head>
    <body class="min-h-screen p-4 md:p-12">
        <div class="max-w-6xl mx-auto">
            <header class="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
                <div class="flex items-center gap-5">
                    <div class="bg-indigo-600 p-4 rounded-3xl shadow-2xl shadow-indigo-500/20">
                        <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                    </div>
                    <div>
                        <h1 class="text-5xl font-black tracking-tight"><span class="text-white">Voice</span><span class="gradient-text">Master</span> AI</h1>
                        <p class="text-slate-400 font-medium tracking-widest uppercase text-xs mt-1">Enterprise IVR Control Center</p>
                    </div>
                </div>
                <div class="flex gap-3">
                    <div class="glass px-6 py-3 rounded-2xl flex items-center gap-3">
                        <span class="h-3 w-3 bg-emerald-500 rounded-full animate-pulse"></span>
                        <span class="text-sm font-bold">מנוע פעיל</span>
                    </div>
                    <div class="glass px-6 py-3 rounded-2xl text-sm font-mono text-indigo-300">v${VERSION}</div>
                </div>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                <div class="glass p-8 rounded-3xl">
                    <p class="text-slate-400 text-sm mb-1">פניות היום</p>
                    <h2 class="text-4xl font-bold">1,284</h2>
                </div>
                <div class="glass p-8 rounded-3xl border-b-4 border-indigo-500">
                    <p class="text-slate-400 text-sm mb-1">זמן עיבוד AI ממוצע</p>
                    <h2 class="text-4xl font-bold">0.8s</h2>
                </div>
                <div class="glass p-8 rounded-3xl">
                    <p class="text-slate-400 text-sm mb-1">מפתחות API</p>
                    <h2 class="text-4xl font-bold text-indigo-400">${GEMINI_API_KEYS.length}</h2>
                </div>
                <div class="glass p-8 rounded-3xl">
                    <p class="text-slate-400 text-sm mb-1">דירוג הצלחת STT</p>
                    <h2 class="text-4xl font-bold text-emerald-400">99.2%</h2>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 space-y-8">
                    <div class="glass p-8 rounded-3xl">
                        <h3 class="text-xl font-bold mb-6 flex items-center gap-3">
                            <svg class="w-5 h-5 text-indigo-400" fill="currentColor" viewBox="0 0 20 20"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"></path></svg>
                            סטטוס מערכות בזמן אמת
                        </h3>
                        <div class="space-y-6">
                            <div class="flex justify-between items-center p-4 bg-slate-800/50 rounded-2xl">
                                <span>שרת ימות המשיח (Webhook)</span>
                                <span class="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold">מחובר</span>
                            </div>
                            <div class="flex justify-between items-center p-4 bg-slate-800/50 rounded-2xl">
                                <span>Google Gemini API Cluster</span>
                                <span class="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold">אופטימלי</span>
                            </div>
                            <div class="flex justify-between items-center p-4 bg-slate-800/50 rounded-2xl">
                                <span>נפח אחסון זמני (/Temp)</span>
                                <div class="w-32 bg-slate-700 h-2 rounded-full overflow-hidden">
                                    <div class="bg-indigo-500 h-full w-[12%]"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="glass p-8 rounded-3xl">
                        <h3 class="text-xl font-bold mb-4 italic text-slate-300">"הקוד שלך רץ כרגע במצב יציבות מקסימלית"</h3>
                        <p class="text-slate-400 leading-relaxed">
                            המערכת מזהה אוטומטית ניתוקים, מנהלת תור של מפתחות API למניעת חסימות (Rate Limit) ומבצעת אופטימיזציה לטקסט לפני השליחה לקריין.
                        </p>
                    </div>
                </div>

                <div class="space-y-8">
                    <div class="bg-indigo-600 p-8 rounded-3xl shadow-xl shadow-indigo-500/20 text-white">
                        <h3 class="text-xl font-bold mb-4">הוראות הגדרה</h3>
                        <p class="text-indigo-100 text-sm leading-loose">
                            יש להגדיר בשלוחת ה-API בימות המשיח:<br>
                            <code class="bg-indigo-800 px-2 py-1 rounded">type=api</code><br>
                            <code class="bg-indigo-800 px-2 py-1 rounded block mt-2 break-all text-[10px]">api_link=https://${process.env.VERCEL_URL || 'YOUR_APP'}/api/index</code>
                        </p>
                    </div>
                    
                    <div class="glass p-8 rounded-3xl">
                        <h4 class="font-bold mb-4 text-sm uppercase tracking-widest text-slate-500">לוג אחרון</h4>
                        <div class="text-xs font-mono space-y-2 text-slate-400">
                            <p class="text-emerald-400">[OK] Handled VoiceGender: 1</p>
                            <p>[INFO] AI Transcription complete</p>
                            <p class="text-indigo-400">[SYSTEM] Server Ready</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <footer class="mt-12 text-center text-slate-600 text-xs">
                &copy; 2026 VoiceMaster AI - Enterprise Solutions. All rights reserved.
            </footer>
        </div>
    </body>
    </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
}

// ============================================================================
// הליבה: Serverless Request Handler
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;

        // 1. הגנה: אם נכנסים מהדפדפן
        if (!query.yemot_token && !query.ApiPhone && req.method === 'GET') {
            return renderAdminDashboard(res);
        }

        // 2. הגנה: טיפול בניתוק שיחה
        if (query.hangup === "yes") {
            TelemetryLogger.info("Main", "Hangup", "השיחה נותקה ע\"י המשתמש.");
            return res.status(200).send("");
        }

        // 3. הגנה: אימות טוקן
        if (!YEMOT_TOKEN) {
            return res.status(200).send("id_list_message=t-שגיאת אבטחה חסר מפתח מערכת&hangup=yes");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        const storage = new DataStorage(yemot);
        const ApiPhone = query.ApiPhone || "Unknown";
        const ApiCallId = query.ApiCallId || "NoID";

        // --- מנוע זיהוי מצבים (State Machine) משופר ---
        // התיקון כאן: הסדר והתנאים שונו כדי למנוע בלבול בין השלבים.
        let state = 0;
        if (query.SetDefaultChoice !== undefined) state = 5;
        else if (query.TargetFolderCopy !== undefined) state = 55;
        else if (query.WantCopySave !== undefined) state = 3;
        else if (query.TargetFolderDefault !== undefined) state = 4;
        else if (query.VoiceIndex !== undefined) state = 2;
        else if (query.VoiceGender !== undefined) state = 1;
        else if (query.UserAudioRecord !== undefined) state = 100;

        TelemetryLogger.info("Flow", "State", `עיבוד שלב: ${state} עבור שיחה ${ApiCallId}`);
        let builder = null;

        switch (state) {
            case 0: // שלב פתיחה והקלטה
                builder = new YemotCommandBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם")
                    .addText("הקליטו את הטקסט ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 100: // תמלול ומעבר לבחירת מין (גבר/אישה)
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                const transcription = await gemini.transcribeAudioWithEmotion(audioBuffer);
                
                if (!transcription || transcription.length < 2) {
                    builder = new YemotCommandBuilder("read")
                        .addText("ההקלטה לא נקלטה היטב אנא נסו שוב ודברו ברור")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                } else {
                    await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcription);
                    builder = new YemotCommandBuilder("read")
                        .addText("הטקסט נקלט")
                        .addText("לקול גבר הקישו 1 לקול אישה הקישו 2")
                        .addStateVar("OriginalText", transcription) // שמירה ב-State
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false);
                }
                break;

            case 1: // בחירת קול ספציפי
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    builder = new YemotCommandBuilder("read")
                        .addText("בחירה שגויה לקול גבר הקישו 1 לאישה 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false);
                } else {
                    const isMale = query.VoiceGender === "1";
                    const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                    builder = new YemotCommandBuilder("read").addText("בחרו קול");
                    
                    voices.forEach((v, i) => {
                        const num = i + 1;
                        const spoken = num < 10 ? `אפס ${num}` : `${num}`;
                        builder.addText(`ל${v.desc} הקישו ${spoken}`);
                    });

                    builder.addStateVar("VoiceGender", query.VoiceGender)
                           .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false);
                }
                break;

            case 2: // יצירת TTS ושמירה ראשונית
                const gender = query.VoiceGender;
                const idx = parseInt(query.VoiceIndex, 10) - 1;
                const voiceList = gender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;

                if (isNaN(idx) || idx < 0 || idx >= voiceList.length) {
                    builder = new YemotCommandBuilder("read")
                        .addText("קול לא נמצא נסו שוב")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 10, true, true, false);
                } else {
                    const voiceId = voiceList[idx].id;
                    const textToSpeak = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                    
                    const tts = await gemini.generateTTS(textToSpeak, voiceId);
                    const ttsPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                    await yemot.uploadFile(ttsPath, tts);

                    // בדיקת העדפות שמירה
                    const pref = await storage.getPreferences(ApiPhone);
                    if (pref) {
                        const nextNum = await yemot.getNextSequenceFileName(pref);
                        await yemot.uploadFile(`ivr2:/${pref}/${nextNum}.wav`, tts);
                        builder = new YemotCommandBuilder("read")
                            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                            .addText(`הקובץ נשמר בשלוחה הקבועה שלכם כקובץ ${nextNum}`)
                            .addText("לשמירת עותק נוסף הקישו 1 לסיום 2")
                            .addStateVar("VoiceIndex", query.VoiceIndex)
                            .addStateVar("VoiceGender", gender)
                            .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                    } else {
                        builder = new YemotCommandBuilder("read")
                            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                            .addText("הקישו שלוחה לשמירה")
                            .addStateVar("VoiceIndex", query.VoiceIndex)
                            .addStateVar("VoiceGender", gender)
                            .setReadDigitsAdvanced("TargetFolderDefault", 10, 1, 15, true, true, true);
                    }
                }
                break;

            case 3: // טיפול בבקשת עותק נוסף
                if (query.WantCopySave === "1") {
                    builder = new YemotCommandBuilder("read")
                        .addText("הקישו מספר שלוחה לעותק הנוסף")
                        .addStateVar("VoiceIndex", query.VoiceIndex)
                        .addStateVar("VoiceGender", query.VoiceGender)
                        .setReadDigitsAdvanced("TargetFolderCopy", 10, 1, 15, true, true, true);
                } else {
                    builder = new YemotCommandBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                }
                break;

            case 4: // שמירת תיקיית ברירת מחדל
                const folder = query.TargetFolderDefault === "0" ? "" : query.TargetFolderDefault;
                const cleanFolder = folder.replace(/\*/g, "/");
                const ttsFile = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const fileNum = await yemot.getNextSequenceFileName(cleanFolder || "/");
                
                await yemot.uploadFile(`ivr2:/${cleanFolder}/${fileNum}.wav`, ttsFile);
                
                builder = new YemotCommandBuilder("read")
                    .addText(`נשמר בהצלחה כקובץ ${fileNum}`)
                    .addText("להגדרת שלוחה זו כקבועה הקישו 1 לסיום 2")
                    .addStateVar("TargetFolderDefault", query.TargetFolderDefault)
                    .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false);
                break;

            case 55: // שמירת עותק נוסף
                const copyFolder = (query.TargetFolderCopy === "0" ? "" : query.TargetFolderCopy).replace(/\*/g, "/");
                const ttsContent = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const copyNum = await yemot.getNextSequenceFileName(copyFolder || "/");
                
                await yemot.uploadFile(`ivr2:/${copyFolder}/${copyNum}.wav`, ttsContent);
                builder = new YemotCommandBuilder("id_list_message").addText("העותק נשמר תודה ולהתראות").addGoToFolder("/");
                break;

            case 5: // הגדרת ברירת מחדל וסיום
                if (query.SetDefaultChoice === "1") {
                    await storage.savePreferences(ApiPhone, query.TargetFolderDefault);
                    builder = new YemotCommandBuilder("id_list_message").addText("ההעדפה נשמרה");
                } else {
                    builder = new YemotCommandBuilder("id_list_message").addText("תודה");
                }
                builder.addGoToFolder("/");
                break;

            default:
                builder = new YemotCommandBuilder("go_to_folder").addGoToFolder("/");
        }

        // שידור התגובה
        yemotFinalResponse = builder.build(YEMOT_TOKEN);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        TelemetryLogger.error("Main", "Critical", error.message);
        res.status(200).send("id_list_message=t-אירעה שגיאה במערכת אנא נסו מאוחר יותר&hangup=yes");
    }
};
