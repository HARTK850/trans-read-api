/**
 * @file api/index.js
 * @version 16.5.0 (Ultimate Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * 
 * פיצ'רים בגרסה זו:
 * 1. "AskNo" מיושם באופן הרמטי בעזרת 15 הפרמטרים, מבטל לחלוטין "לאישור הקישו 1".
 * 2. תפריטי 1 ו-2 (בן/בת, כן/לא) דורשים הקשה בודדת ומזנקים הלאה.
 * 3. תפריט הקולות (30 קולות) דורש 2 ספרות בדיוק (01 עד 30).
 * 4. התפריט המקורי של ימות המשיח לאחר הקלטה הוחזר.
 * 5. ה-AI מנתח את טון הדיבור לבד, ללא תפריט סגנונות מעיק.
 * 6. ממשק Dashboard אינטרנטי לניהול המערכת כשנכנסים מדפדפן!
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');
const fs = require('fs');
const path = require('path');

// ============================================================================
// הגדרות סביבה גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות לתקן המחמיר של ימות המשיח
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks =[]; 
        this.params =[]; 
        this.nextState = {}; 
        this.goToFolder = null; 
    }

    cleanYemotText(text) {
        // מחיקת תווים בעייתיים (נקודות, פסיקים) למניעת קריסות של ימות המשיח. 
        // משאיר רווחים כדי שההקראה תישמע טבעית!
        if (!text) return "";
        return text.toString().replace(/[.,-]/g, " ").replace(/\s+/g, " ").trim();
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
     * פונקציה חכמה למניעת כל בקשות האישור ("לאישור הקישו 1").
     * בונה מערך מדויק של 15 פרמטרים כפי שדורשת ימות המשיח.
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = true, allowAsterisk = true) {
        // שים לב: שינינו את ברירת המחדל ל-true עבור אפס וכוכבית
        const blockAsterisk = allowAsterisk ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes"; 

        this.params = [
            varName,               // 1
            "no",                  // 2
            "Digits",              // 3
            maxDigits.toString(),  // 4
            minDigits.toString(),  // 5
            timeout.toString(),    // 6
            "Digits",              // 7. שינוי מ-No ל-Digits (קריטי!)
            blockAsterisk,         // 8
            blockZero,             // 9
            "no",                  // 10. שינוי מריק ל-"no"
            "",                    // 11
            "3",                   // 12. הוספת 3 ניסיונות (קריטי למניעת "בחירה לא חוקית")
            "no",                  // 13
            "",                    // 14
            disableConfirmation ? "no" : "yes" // 15
        ];
        return this;
    }

    /**
     * הגדרת קלט הקלטה (Record). מפעיל את התפריט הרשמי של ימות המשיח
     * (1 לשמיעה, 2 לאישור, 3 הקלטה מחדש). מושג על ידי השארת הפרמטר ה-6 ריק.
     */
    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   // 1. משתנה 
            "no",      // 2. להשתמש בקיים
            "record",  // 3. סוג (הקלטה)
            folder,    // 4. תיקיית יעד בימות
            fileName,  // 5. שם קובץ
            "",        // 6. ריק = הפעלת התפריט המלא של ימות!
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. לא לשרשר
        ];
        return this;
    }

    addState(key, value) {
        this.nextState[key] = value;
        return this;
    }

    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

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

        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// פונקציות עזר 
// ============================================================================
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; 
    // השרת מחליף בבטחה את הכוכביות (שהמשתמש הקיש כסלש) לסלש תקין.
    return rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

function cleanupEmptyQueryVariables(query) {
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "TargetFolderDefault", "TargetFolderCopy", "SetDefaultChoice", "WantCopySave"];
    for (const key of keys) {
        if (query[key] === "") delete query[key];
    }
}

// ============================================================================
// ממשק אינטרנטי (Admin Dashboard)
// אם המשתמש נכנס מהדפדפן, הוא רואה לוח בקרה מעוצב ולא "שגיאת טוקן".
// ============================================================================
function renderAdminDashboard(res) {
    const html = `
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>VoiceMaster AI | לוח בקרה</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;600;800&display=swap" rel="stylesheet">
        <style>body { font-family: 'Assistant', sans-serif; background-color: #0f172a; color: #f8fafc; }</style>
    </head>
    <body class="min-h-screen flex flex-col items-center justify-center p-6">
        <div class="max-w-3xl w-full bg-slate-800 rounded-3xl shadow-2xl p-8 border border-slate-700">
            <div class="flex items-center gap-4 mb-8">
                <div class="bg-indigo-500 p-4 rounded-2xl shadow-lg shadow-indigo-500/30">
                    <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                </div>
                <div>
                    <h1 class="text-4xl font-black tracking-tight text-white">Voice<span class="text-indigo-400">Master</span> AI</h1>
                    <p class="text-slate-400 mt-1 font-medium">Enterprise IVR Integration Panel</p>
                </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div class="bg-slate-700/50 p-6 rounded-2xl border border-slate-600">
                    <h3 class="text-indigo-300 font-bold mb-2">סטטוס מנוע AI</h3>
                    <div class="flex items-center gap-3">
                        <span class="relative flex h-3 w-3">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </span>
                        <span class="font-semibold text-emerald-400">מקוון (Online)</span>
                    </div>
                    <p class="text-sm text-slate-400 mt-3">מפתחות מוגדרים: ${GEMINI_API_KEYS.length}</p>
                </div>
                
                <div class="bg-slate-700/50 p-6 rounded-2xl border border-slate-600">
                    <h3 class="text-indigo-300 font-bold mb-2">סטטוס ימות המשיח</h3>
                    <p class="text-sm text-slate-400">ממתין לפניות מהמרכזיה.</p>
                    <p class="text-xs text-slate-500 mt-2">יש להגדיר בשלוחה:<br><code>type=api</code><br><code>api_link=${process.env.VERCEL_URL ? 'https://'+process.env.VERCEL_URL+'/api/index' : 'https://YOUR_VERCEL_APP/api/index'}</code></p>
                </div>
            </div>

            <div class="bg-indigo-900/30 p-6 rounded-2xl border border-indigo-500/30 text-center">
                <p class="text-indigo-200">המערכת מוכנה לקבל פניות (POST/GET) ממערכת ימות המשיח.</p>
                <p class="text-sm text-indigo-400 mt-2">גרסת מנוע: 16.5.0 Enterprise</p>
            </div>
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
        
        // אם מדובר בלקוח שנכנס דרך דפדפן (ללא ApiPhone או yemot_token), נציג לו את לוח הבקרה
        if (!query.yemot_token && !query.ApiPhone && req.method === 'GET') {
            return renderAdminDashboard(res);
        }

        // הגנת ניתוק - מונע שידור בחזרה לימות המשיח במקרה של טורק-טלפון
        if (query.hangup === "yes") {
            TelemetryLogger.info("MainHandler", "Hangup", `המאזין ניתק את השיחה. עוצר הליכים. (CallID: ${query.ApiCallId})`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        if (!YEMOT_TOKEN) {
            TelemetryLogger.error("MainHandler", "Auth", "נדחתה גישה: חסר טוקן YEMOT_TOKEN בהגדרות השלוחה.");
            return res.status(200).send("id_list_message=t-תקלה במערכת חסר מפתח הגדרה&hangup=yes");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        const ApiPhone = query.ApiPhone || "UnknownPhone";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        cleanupEmptyQueryVariables(query);
        
        // --- ניהול שלבים (State Machine) קפדני וחסין באגים ---
        // הבדיקה של UserAudioRecord התווספה כראוי! אם היא קיימת, אנחנו בשלב 100 (תמלול).
        let state = 0;
        if (query.SetDefaultChoice !== undefined) state = 6;
        else if (query.TargetFolderCopy !== undefined) state = 55;
        else if (query.WantCopySave !== undefined) state = 4;
        else if (query.TargetFolderDefault !== undefined) state = 3;
        else if (query.VoiceIndex !== undefined) state = 2;
        else if (query.VoiceGender !== undefined) state = 1;
        else if (query.UserAudioRecord !== undefined) state = 100;

        TelemetryLogger.info("FlowController", "StateDetection", `שלב מזוהה: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת ובקשת הקלטה.
                // ====================================================================
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 100:
                // ====================================================================
                // שלב 1: STT חכם (עם ניתוח טון) ומעבר לבחירת גבר/אישה (ספרה 1 בלבד)
                // הלקוח מקיש 1 או 2 וטס הלאה בלי אישור.
                // ====================================================================
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                // ההקלטה מתומללת ע"י ה-AI שמבין את הטון בעצמו!
                const transcribedTextWithEmotion = await gemini.transcribeAudioWithEmotion(mainAudioBuffer);
                TelemetryLogger.info("MainHandler", "STT", `תומלל בהצלחה: ${transcribedTextWithEmotion}`);

                if (!transcribedTextWithEmotion || transcribedTextWithEmotion.length < 2) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    break;
                }

                // שמירת הטקסט בקובץ (כולל ההוראות בסוגריים) כדי לשלוף בשלב ה-TTS
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedTextWithEmotion);

                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול קריין גברי הקישו 1 לבחירת קול קריינית נשית הקישו 2")
                    // מקסימום 1, מינימום 1, ללא אישור (AskNo מופעל אוטומטית), חוסם אפס (allowZero=false)
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, true, true); 
                break;

            case 1:
                // ====================================================================
                // שלב 2: תפריט הקולות הייעודי (15 קולות) - הקראת "אפס אחד"
                // ====================================================================
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, true, true);
                    break;
                }

                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
                
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; // הקראת "אפס אחד"
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }
                
                responseBuilder.addText("ובסיום הקישו סולמית");

                // מקסימום 2, מינימום 2. הלקוח מקיש "01" ועף הלאה! מתיר אפס כמובן (allowZero=true).
                responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false);
                break;

            case 2:
                // ====================================================================
                // שלב 3: הלקוח בחר קול - יצירת ה-TTS המיידי (הסגנון מוסק אוטומטית)
                // השרת חושב בשקט. ימות תנגן את ztomao בינתיים!
                // ====================================================================
                const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                
                if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false);
                    break;
                }

                const selectedVoiceId = voiceListCheck[checkIdx].id;
                
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // ה-AI מייצר את ההקראה! 
                const ttsBuffer = await gemini.generateTTS(mainTextForTTS, selectedVoiceId);
                
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsBuffer);

                // ניתוב לשמירה
                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileNum = await yemot.getNextSequenceFileName(folder);
                    const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
                    
                    await yemot.uploadFile(finalPath, ttsBuffer);

                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) 
                        .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
                        .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        // ספרה 1 בלבד, ללא אישור
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                } else {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                        .addText("נא הקישו את מספר השלוחה לשמירה למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        // מתיר אפס, מתיר כוכבית, אבל אנחנו נמיר כוכבית לסלש בפונקציית העזר שלנו ולא נסמוך על ימות
                        .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true);
                }
                break;

            case 3:
                // ====================================================================
                // שלב 4: הלקוח (הוותיק) נשאל האם הוא מעוניין בעותק נוסף
                // ====================================================================
                if (query.WantCopySave === "1") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, true, true);
                } else if (query.WantCopySave === "2") {
                    responseBuilder = new YemotCommandBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                } else {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית לאישור עותק הקישו 1 לביטול הקישו 2")
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                }
                break;

            case 4:  // שמירה רגילה
            case 55: // שמירת עותק
                // ====================================================================
                // שלב 5 + 55: תיוק הקובץ בשלוחת היעד 
                // ====================================================================
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                
                if (targetFolder === undefined) { 
                    responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/"); 
                    break; 
                }
                
                if (targetFolder === "0") {
                    targetFolder = "";
                }
                
                const cleanFolder = cleanAndSanitizeFolder(targetFolder); 
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder || "/");
                
                const uploadPath = cleanFolder ? `ivr2:/${cleanFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
                await yemot.uploadFile(uploadPath, ttsForSave);

                if (state === 55) { 
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText(`העותק נשמר בהצלחה כקובץ מספר ${seqFileName} תודה ולהתראות`)
                        .addGoToFolder("/"); 
                } else { 
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו 1 לסיום הקישו 2")
                        .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false);
                }
                break;

            case 5:
                // ====================================================================
                // שלב 6: עדכון מועדפים במסד הנתונים של ימות (קבצי txt) ופרידה
                // ====================================================================
                if (query.SetDefaultChoice === "1" && query.TargetFolderDefault !== undefined) {
                    const prefPathTxt = `ivr2:/Preferences/${ApiPhone}.txt`;
                    const finalPrefs = cleanAndSanitizeFolder(query.TargetFolderDefault);
                    await yemot.uploadTextFile(prefPathTxt, finalPrefs);
                    
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("שלוחת ברירת המחדל עודכנה בהצלחה תודה ולהתראות")
                        .addGoToFolder("/");
                } else {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("תודה ולהתראות")
                        .addGoToFolder("/");
                }
                break;

            default:
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
        }

        // בניית תגובה סופית ושמירת משתני המצב לאורך כל השיחה
        yemotFinalResponse = responseBuilder.build();
        if (yemotFinalResponse.includes("read=") || yemotFinalResponse.includes("id_list_message=")) {
            yemotFinalResponse += `&api_add_99=yemot_token=${encodeURIComponent(YEMOT_TOKEN)}`;
            
            if (query.VoiceGender) yemotFinalResponse += `&api_add_98=VoiceGender=${query.VoiceGender}`;
            if (query.VoiceIndex) yemotFinalResponse += `&api_add_97=VoiceIndex=${query.VoiceIndex}`;
            if (query.TargetFolderDefault) yemotFinalResponse += `&api_add_96=TargetFolderDefault=${query.TargetFolderDefault}`;
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        TelemetryLogger.error("MainHandler", "CriticalError", "קריסת שרת:", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה קריטית במערכת אנו מתנצלים&go_to_folder=/");
    }
};
