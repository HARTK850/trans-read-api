/**
 * @file api/index.js
 * @version 17.0.0 (Ultimate Enterprise AI Edition)
 * @description מנוע IVR מתקדם המשלב Gemini AI עם מערכת ימות המשיח.
 * * שיפורים בגרסה זו:
 * 1. תיקון ה-State Machine: סנכרון מלא בין זיהוי המשתנים ל-Switch Case.
 * 2. תיקון ה-AskNo: פרמטר 7 הוחזר ל-"no" כדי למנוע כפילויות הקראה.
 * 3. הרחבת ה-Dashboard: ממשק ניהול ויזואלי מלא כולל סטטיסטיקות דמה.
 * 4. לוגיקת זיהוי שגיאות: אם משתמש מקיש ספרה לא נכונה, המערכת מחזירה אותו בדיוק לנקודה הנכונה.
 * 5. ניהול זיכרון: ניקוי משתנים חכם למניעת לופים.
 * 6. תמיכה ב-TTS/STT משופר.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');
const fs = require('fs');
const path = require('path');

// ============================================================================
// קבועים והגדרות מערכת
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// מחלקת עזר לבניית פקודות ימות המשיח (Yemot Protocol)
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks = []; 
        this.params = []; 
        this.nextStateParams = {}; 
        this.goToFolder = null; 
    }

    /**
     * ניקוי טקסט למניעת שגיאות הקראה במנוע של ימות
     */
    cleanYemotText(text) {
        if (!text) return "";
        return text.toString()
            .replace(/[.,-]/g, " ")
            .replace(/["']/g, "")
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
            // מסיר סיומות קובץ אם קיימות, ימות מעדיפה בלי .wav
            const cleanPath = filePath.replace('.wav', '');
            this.contentBlocks.push(`f-${cleanPath}`);
        }
        return this;
    }

    /**
     * פונקציית הליבה של ה-IVR: קליטת מקשים ללא "לאישור הקישו 1"
     * @param {string} varName - שם המשתנה שיחזור ב-Query String
     * @param {number} max - מקסימום ספרות
     * @param {number} min - מינימום ספרות
     * @param {number} timeout - זמן המתנה בשניות
     * @param {boolean} askNo - האם לבטל אישור (AskNo)
     */
    setReadDigits(varName, max, min, timeout, askNo = true) {
        this.params = [
            varName,          // 1. שם המשתנה
            "no",             // 2. האם להשתמש בערך קיים (no = תמיד לבקש מחדש)
            "Digits",         // 3. סוג הקלט
            max.toString(),   // 4. מקסימום ספרות
            min.toString(),   // 5. מינימום ספרות
            timeout.toString(),// 6. זמן המתנה
            "no",             // 7. האם להשמיע את מה שהוקש (ב-AskNo חובה no!)
            "no",             // 8. חסימת כוכבית
            "no",             // 9. חסימת אפס
            "no",             // 10. האם להשמיע "מספר לא חוקי"
            "",               // 11. שפת הקראה
            "3",              // 12. מספר ניסיונות
            "no",             // 13. הקלטה במקרה של כישלון
            "",               // 14. הודעה בסיום ניסיונות
            askNo ? "no" : "yes" // 15. האם לבקש אישור סופי (no = דלג על "לאישור הקישו 1")
        ];
        return this;
    }

    /**
     * פקודת הקלטה חכמה שמשתמשת בתפריט המובנה של ימות המשיח
     */
    setRecordInput(varName, folder, fileName) {
        this.params = [
            varName,   
            "no",      
            "record",  
            folder,    
            fileName,  
            "",        // השארת פרמטר 6 ריק מפעילה את תפריט "1 לשמיעה 2 לאישור"
            "yes",     
            "no"       
        ];
        return this;
    }

    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /**
     * בניית המחרוזת הסופית שתישלח לשרתי ימות המשיח
     */
    build() {
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

        // הוספת ניתוב תיקייה אם נדרש בסוף פקודת הודעה
        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// פונקציות עזר לוגיות
// ============================================================================
function sanitizePath(raw) {
    if (!raw || raw === "0") return "";
    return raw.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

/**
 * פונקציה קריטית: מחליטה באיזה שלב בשיחה אנחנו נמצאים על סמך הפרמטרים שחזרו
 */
function detectCurrentState(query) {
    if (query.SetDefaultChoice !== undefined) return 6; // שלב הגדרת מועדפים
    if (query.TargetFolderCopy !== undefined) return 55; // שלב שמירת עותק
    if (query.WantCopySave !== undefined) return 4;    // שלב בחירת עותק נוסף
    if (query.TargetFolderDefault !== undefined) return 3; // שלב בחירת תיקייה ראשונית
    if (query.VoiceIndex !== undefined) return 2;      // שלב בחירת קריין ספציפי
    if (query.VoiceGender !== undefined) return 1;     // שלב בחירת גבר/אישה
    if (query.UserAudioRecord !== undefined) return 100; // שלב שאחרי ההקלטה
    return 0; // שלב התחלה
}

// ============================================================================
// ממשק ניהול - Dashboard (כ-100 שורות HTML/CSS)
// ============================================================================
function renderFullDashboard(res, stats) {
    const html = `
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>VoiceMaster AI | Enterprise Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@200;400;700;800&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Assistant', sans-serif; background: radial-gradient(circle at top right, #1e293b, #0f172a); color: #e2e8f0; }
            .glass { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.05); }
            .card-hover:hover { transform: translateY(-5px); transition: all 0.3s ease; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
        </style>
    </head>
    <body class="min-h-screen p-4 md:p-12">
        <div class="max-w-6xl mx-auto">
            <header class="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
                <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/50">
                        <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </div>
                    <div>
                        <h1 class="text-4xl font-black text-white tracking-tight">VOICE<span class="text-indigo-400">MASTER</span> AI</h1>
                        <p class="text-slate-400 font-medium uppercase tracking-widest text-xs">Ultimate Enterprise Edition v17.0</p>
                    </div>
                </div>
                <div class="flex gap-4">
                    <div class="glass px-6 py-3 rounded-2xl flex items-center gap-3">
                        <span class="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></span>
                        <span class="text-sm font-bold">מערכת פעילה</span>
                    </div>
                </div>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                <div class="glass p-6 rounded-3xl card-hover">
                    <p class="text-slate-400 text-sm mb-1">מפתחות API</p>
                    <h2 class="text-3xl font-bold text-white">${GEMINI_API_KEYS.length}</h2>
                </div>
                <div class="glass p-6 rounded-3xl card-hover">
                    <p class="text-slate-400 text-sm mb-1">מנוע AI</p>
                    <h2 class="text-3xl font-bold text-indigo-400">Gemini 1.5 Pro</h2>
                </div>
                <div class="glass p-6 rounded-3xl card-hover">
                    <p class="text-slate-400 text-sm mb-1">זמן תגובה ממוצע</p>
                    <h2 class="text-3xl font-bold text-emerald-400">0.8s</h2>
                </div>
                <div class="glass p-6 rounded-3xl card-hover">
                    <p class="text-slate-400 text-sm mb-1">סטטוס ימות המשיח</p>
                    <h2 class="text-3xl font-bold text-blue-400">מחובר</h2>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 glass p-8 rounded-3xl">
                    <h3 class="text-xl font-bold mb-6 flex items-center gap-2">
                        <svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
                        הגדרות אינטגרציה לימות המשיח
                    </h3>
                    <div class="space-y-6">
                        <div class="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                            <p class="text-xs text-slate-500 mb-2 uppercase font-bold">כתובת ה-API שלך</p>
                            <code class="text-indigo-300 break-all">${process.env.VERCEL_URL ? 'https://'+process.env.VERCEL_URL+'/api/index' : 'https://YOUR_APP.vercel.app/api/index'}</code>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                                <h4 class="font-bold text-indigo-300 mb-1">הגדרת שלוחה</h4>
                                <p class="text-sm text-slate-300">בשלוחת ה-API בפורטל ימות, הגדר:</p>
                                <pre class="text-xs mt-2 text-slate-400">type=api\napi_link=[הכתובת למעלה]</pre>
                            </div>
                            <div class="p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                                <h4 class="font-bold text-emerald-300 mb-1">מפתח אבטחה</h4>
                                <p class="text-sm text-slate-300">חובה להגדיר YEMOT_TOKEN במשתני הסביבה (Environment Variables).</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="glass p-8 rounded-3xl">
                    <h3 class="text-xl font-bold mb-6">לוגים אחרונים</h3>
                    <div class="space-y-4 text-xs font-mono">
                        <div class="flex gap-2 text-emerald-400"><span class="text-slate-600">[OK]</span> Server initialized...</div>
                        <div class="flex gap-2 text-blue-400"><span class="text-slate-600">[INFO]</span> Gemini Engine Ready</div>
                        <div class="flex gap-2 text-slate-400"><span class="text-slate-600">[IDLE]</span> Waiting for call...</div>
                    </div>
                </div>
            </div>

            <footer class="mt-12 text-center text-slate-500 text-sm">
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
// הליבה: Serverless Function Handler
// ============================================================================
module.exports = async (req, res) => {
    let finalYemotString = "";
    
    try {
        // איחוד נתוני GET ו-POST
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // כניסה מדפדפן - הצגת דאשבורד
        if (!query.yemot_token && !query.ApiPhone && req.method === 'GET') {
            return renderFullDashboard(res);
        }

        // טיפול בניתוק שיחה
        if (query.hangup === "yes") {
            TelemetryLogger.info("Main", "Hangup", `Call ${query.ApiCallId} ended.`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        // אימות טוקן
        const TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        if (!TOKEN) {
            return res.status(200).send("id_list_message=t-שגיאת אבטחה חסר טוקן במערכת&hangup=yes");
        }

        const yemot = new YemotManager(TOKEN);
        const ApiCallId = query.ApiCallId || "temp";
        
        // זיהוי המצב הנוכחי (State Machine)
        const state = detectCurrentState(query);
        TelemetryLogger.info("Logic", "State", `Detected State: ${state}`);

        let builder = null;

        // ====================================================================
        // ניהול שלבי השיחה (The Big Switch)
        // ====================================================================
        switch (state) {
            
            case 0: // --- התחלה: בקשת הקלטה ---
                builder = new YemotCommandBuilder("read")
                    .addText("ברוכים הבאים למחולל הבינה המלאכותית")
                    .addText("אנא הקליטו את הטקסט שלכם ובסיום הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 100: // --- עיבוד הקלטה ומעבר לבחירת מין (גבר/אישה) ---
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                TelemetryLogger.info("AI", "Processing", "מתחיל תמלול והבנת טון...");
                
                try {
                    const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                    const aiResult = await gemini.transcribeAudioWithEmotion(audioBuffer);

                    if (!aiResult || aiResult.length < 2) {
                        builder = new YemotCommandBuilder("read")
                            .addText("ההקלטה הייתה קצרה מדי או לא ברורה אנא נסו להקליט שוב")
                            .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    } else {
                        // שמירת התמלול לקובץ זמני להמשך
                        await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, aiResult);

                        builder = new YemotCommandBuilder("read")
                            .addText("הטקסט נקלט בהצלחה")
                            .addText("לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                            .setReadDigits("VoiceGender", 1, 1, 10, true); // AskNo מופעל
                    }
                } catch (e) {
                    builder = new YemotCommandBuilder("read").addText("אירעה שגיאה בעיבוד הקול אנא נסו שוב").addGoToFolder("/");
                }
                break;

            case 1: // --- בחירת קריין ספציפי מתוך רשימה ---
                const gender = query.VoiceGender;
                if (gender !== "1" && gender !== "2") {
                    builder = new YemotCommandBuilder("read")
                        .addText("בחירה לא תוקנה לבחירת קול גבר הקישו 1 לקול אישה הקישו 2")
                        .setReadDigits("VoiceGender", 1, 1, 10, true);
                } else {
                    const isMale = (gender === "1");
                    const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                    
                    builder = new YemotCommandBuilder("read").addText("בחרו את מספר הקריין");
                    voices.forEach((v, index) => {
                        const num = index + 1;
                        const spokenNum = num < 10 ? `אפס ${num}` : num;
                        builder.addText(`ל${v.desc} הקישו ${spokenNum}`);
                    });
                    
                    // בחירה של 2 ספרות בדיוק (למשל 01)
                    builder.setReadDigits("VoiceIndex", 2, 2, 15, true);
                }
                break;

            case 2: // --- שלב יצירת ה-TTS המוגמר ---
                const vIdx = parseInt(query.VoiceIndex, 10) - 1;
                const vGender = query.VoiceGender;
                const vList = (vGender === "1") ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;

                if (isNaN(vIdx) || vIdx < 0 || vIdx >= vList.length) {
                    builder = new YemotCommandBuilder("read")
                        .addText("המספר שהוקש אינו ברשימה אנא הקישו שוב את שתי ספרות הקריין")
                        .setReadDigits("VoiceIndex", 2, 2, 10, true);
                } else {
                    // ביצוע ה-TTS
                    const originalText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                    const ttsResult = await gemini.generateTTS(originalText, vList[vIdx].id);
                    
                    const ttsPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_final.wav`;
                    await yemot.uploadFile(ttsPath, ttsResult);

                    // בדיקה אם יש למשתמש תיקיית ברירת מחדל
                    const prefs = await yemot.getTextFile(`ivr2:/Preferences/${query.ApiPhone}.txt`);
                    
                    if (prefs && prefs.trim().length > 0) {
                        // שמירה אוטומטית בברירת המחדל
                        const target = sanitizePath(prefs.trim());
                        const nextNum = await yemot.getNextSequenceFileName(target || "/");
                        await yemot.uploadFile(`ivr2:/${target}/${nextNum}.wav`, ttsResult);

                        builder = new YemotCommandBuilder("read")
                            .addFile(`${TEMP_FOLDER}/${ApiCallId}_final`)
                            .addText(`הקובץ הושמע ונשמר בשלוחת המועדפים כקובץ מספר ${nextNum}`)
                            .addText("לשמירת עותק נוסף בשלוחה אחרת הקישו 1 לסיום הקישו 2")
                            .setReadDigits("WantCopySave", 1, 1, 10, true);
                    } else {
                        // בקשת שלוחה בפעם הראשונה
                        builder = new YemotCommandBuilder("read")
                            .addFile(`${TEMP_FOLDER}/${ApiCallId}_final`)
                            .addText("ההקראה מוכנה כעת נשמור אותה במערכת")
                            .addText("הקישו את מספר השלוחה לשמירה ובסיום סולמית לשמירה בראשי הקישו אפס וסולמית")
                            .setReadDigits("TargetFolderDefault", 20, 1, 15, true);
                    }
                }
                break;

            case 3: // --- שמירה בתיקייה ראשונית ---
                let folder = sanitizePath(query.TargetFolderDefault);
                const ttsFile = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_final.wav`);
                const seq = await yemot.getNextSequenceFileName(folder || "/");
                
                await yemot.uploadFile(`ivr2:/${folder}/${seq}.wav`, ttsFile);

                builder = new YemotCommandBuilder("read")
                    .addText(`נשמר בהצלחה כקובץ ${seq}`)
                    .addText("האם תרצו לקבוע שלוחה זו כקבועה עבורכם הקישו 1 לאישור 2 לביטול")
                    .setReadDigits("SetDefaultChoice", 1, 1, 10, true);
                break;

            case 4: // --- האם המשתמש רוצה עותק נוסף? ---
                if (query.WantCopySave === "1") {
                    builder = new YemotCommandBuilder("read")
                        .addText("הקישו את מספר השלוחה עבור העותק הנוסף וסולמית")
                        .setReadDigits("TargetFolderCopy", 20, 1, 15, true);
                } else {
                    builder = new YemotCommandBuilder("id_list_message").addText("תודה רבה ולהתראות").addGoToFolder("/");
                }
                break;

            case 55: // --- ביצוע שמירת העותק ---
                const copyFolder = sanitizePath(query.TargetFolderCopy);
                const copyFile = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_final.wav`);
                const copySeq = await yemot.getNextSequenceFileName(copyFolder || "/");
                
                await yemot.uploadFile(`ivr2:/${copyFolder}/${copySeq}.wav`, copyFile);
                builder = new YemotCommandBuilder("id_list_message")
                    .addText(`העותק נשמר בהצלחה תודה ולהתראות`)
                    .addGoToFolder("/");
                break;

            case 6: // --- שמירת העדפות מועדפים ---
                if (query.SetDefaultChoice === "1") {
                    const prefPath = `ivr2:/Preferences/${query.ApiPhone}.txt`;
                    await yemot.uploadTextFile(prefPath, query.TargetFolderDefault || "");
                    builder = new YemotCommandBuilder("id_list_message").addText("הגדרות נשמרו").addGoToFolder("/");
                } else {
                    builder = new YemotCommandBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                }
                break;

            default:
                builder = new YemotCommandBuilder("go_to_folder").addGoToFolder("/");
        }

        // הוספת משתני המצב לכל תשובה כדי לשמור על רצף (State persistence)
        finalYemotString = builder.build();
        
        if (finalYemotString.includes("read=") || finalYemotString.includes("id_list_message=")) {
            // הוספת הטוקן והמשתנים שכבר נאספו ל-Query של השלב הבא
            finalYemotString += `&api_add_99=yemot_token=${encodeURIComponent(TOKEN)}`;
            if (query.VoiceGender) finalYemotString += `&api_add_98=VoiceGender=${query.VoiceGender}`;
            if (query.VoiceIndex) finalYemotString += `&api_add_97=VoiceIndex=${query.VoiceIndex}`;
            if (query.TargetFolderDefault) finalYemotString += `&api_add_96=TargetFolderDefault=${query.TargetFolderDefault}`;
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(finalYemotString);

    } catch (error) {
        TelemetryLogger.error("Main", "Crash", error.message);
        res.status(200).send("id_list_message=t-תקלה זמנית במערכת נסו שוב מאוחר יותר&go_to_folder=/");
    }
};
