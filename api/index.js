/**
 * @file api/index.js
 * @version 16.0.0 (Ultimate Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * 
 * פיצ'רים בגרסה זו:
 * 1. השתקה הרמטית של "לאישור הקישו 1" דרך שימוש מדויק ב-15 הפרמטרים של פקודת read.
 * 2. תפריטי 1 ו-2 (בן/בת, כן/לא) דורשים הקשה בודדת ומזנקים הלאה.
 * 3. תפריט הקולות (30 קולות) דורש 2 ספרות בדיוק (01 עד 30).
 * 4. התפריט המקורי של ימות המשיח לאחר הקלטה ("לשמיעה 1, לאישור 2...") הוחזר באופן מלא!
 * 5. ה-AI מנתח את טון הדיבור לבד, ללא תפריט סגנונות.
 * 6. השרת מעכב תגובה בזמן יצירת ה-TTS - מפעיל אוטומטית מוזיקת המתנה (ztomao).
 * 7. התרת הזנת 0 וכוכבית (עם המרה אוטומטית בשרת ללא שימוש בפרמטר 10 הפגום של ימות).
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות לתקן המחמיר של ימות המשיח (YemotCommandBuilder)
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks = []; 
        this.params =[]; 
        this.nextState = {}; 
        this.goToFolder = null; 
    }

    /**
     * מנקה את הטקסט מתווים שגורמים לימות המשיח לשתוק או לקרוס.
     * משאיר רווחים תקינים כדי שההקראה תהיה טבעית וזורמת.
     */
    cleanYemotText(text) {
        if (!text) return "";
        return text.toString().replace(/[.,-]/g, " ").replace(/\s+/g, " ").trim();
    }

    /** הוספת בלוק הקראת טקסט (t-) */
    addText(text) {
        const cleanStr = this.cleanYemotText(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    /** הוספת בלוק השמעת קובץ אודיו (f-) */
    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    /**
     * הגדרת קלט (Digits) בעזרת 15 הפרמטרים המלאים של ה-API.
     * מיועד להשתיק את ה"לאישור הקישו 1" ולאפשר זרימה חלקה.
     * 
     * @param {string} varName - שם המשתנה שיוחזר לשרת
     * @param {number} maxDigits - מקסימום ספרות
     * @param {number} minDigits - מינימום ספרות 
     * @param {number} timeout - זמן המתנה להקשה בשניות
     * @param {boolean} allowZero - אם true, מתיר שימוש באפס כחלק מהקלט (עבור תיקיות)
     * @param {boolean} allowAsterisk - אם true, מתיר שימוש בכוכבית (עבור תיקיות)
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, allowZero = false, allowAsterisk = false) {
        // כדי להשתיק את ה"לאישור הקישו 1" ואת חזרת הספרות ("הקשתם אחד"),
        // אנו חייבים: 
        // 1. פרמטר 7 (סוג השמעה) = No
        // 2. פרמטר 15 (אישור סופי) = no
        // פרמטר 8: חסימת כוכבית (yes=חסום, no=מותר)
        // פרמטר 9: חסימת אפס (yes=חסום, no=מותר)

        const blockAsterisk = allowAsterisk ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes";

        this.params =[
            varName,               // 1. פרמטר
            "no",                  // 2. להשתמש בקיים
            "Digits",              // 3. סוג
            maxDigits.toString(),  // 4. מקסימום
            minDigits.toString(),  // 5. מינימום
            timeout.toString(),    // 6. זמן המתנה
            "No",                  // 7. ביטול השמעת ההקשה (No)
            blockAsterisk,         // 8. חסימת כוכבית
            blockZero,             // 9. חסימת אפס
            "",                    // 10. החלפת תווים (נשאר ריק למניעת שגיאות מנוע של ימות)
            "",                    // 11. מקשים מורשים
            "",                    // 12. כמות פעמים לפני ניתוק
            "",                    // 13. המשך אם ריק
            "",                    // 14. מודל מקלדת
            "no"                   // 15. אישור הקשה (חובה no למניעת "לאישור הקישו 1")
        ];
        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה (Record).
     * ע"י השארת הפרמטר השישי ריק, אנו מפעילים את תפריט ההקלטה *המקורי* והמלא של ימות!
     */
    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   // 1. שם המשתנה 
            "no",      // 2. להשתמש בקיים? לא
            "record",  // 3. סוג קלט (הקלטה קולית)
            folder,    // 4. תיקיית יעד בימות
            fileName,  // 5. שם קובץ
            "",        // 6. ריק! כדי שימות תפעיל את תפריט האישור הסטנדרטי שלה
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. שרשור לקובץ קודם? לא
        ];
        return this;
    }

    /** הוספת משתנה State ל-URL הבא */
    addState(key, value) {
        this.nextState[key] = value;
        return this;
    }

    /** הגדרת ניתוב לשלוחה בסוף הפעולה */
    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /** הרכבת המחרוזת הסופית על פי חוקי ימות המשיח */
    build() {
        let res = "";
        
        // הצמדת כל ההודעות הקוליות והטקסטואליות עם נקודה
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

        // אם הוגדר ניתוב בסוף וזו לא פקודת go_to_folder, נשרשר
        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// פונקציות עזר עסקיות
// ============================================================================

/**
 * פונקציה חכמה לניקוי משתנים ריקים מהבקשה.
 * אם המאזין התמהמה (Timeout) ימות עשויה לשלוח משתנה ריק. מחיקתו תגרום 
 * ל-State Machine לחזור על השלב ולבקש שוב את הנתון בלי לקרוס.
 */
function cleanupEmptyQueryVariables(query) {
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "TargetFolderDefault", "TargetFolderCopy", "SetDefaultChoice", "WantCopySave"];
    for (const key of keys) {
        if (query[key] === "") {
            delete query[key];
        }
    }
}

/**
 * מנקה נתיב שלוחה שהתקבל מהמאזין ומכין אותו לשמירה בטוחה.
 * אנו ממירים כוכביות לסלשים בשרת במקום להשתמש בפונקציה הפגומה של ימות המשיח.
 */
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; 
    return rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

// ============================================================================
// הליבה: Serverless Request Handler
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // הגנת ניתוק - עצירה מיידית מונעת כניסה ללולאת שגיאות
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
        
        // --- ניהול שלבים (State Machine) חכם מבוסס Presence ---
        // אנו בודקים מה הנתון האחרון שהצטבר ב-URL וכך יודעים באיזה שלב הלקוח נמצא.
        let state = 0;
        if (query.SetDefaultChoice !== undefined) state = 6;
        else if (query.TargetFolderCopy !== undefined) state = 55;
        else if (query.WantCopySave !== undefined) state = 4;
        else if (query.TargetFolderDefault !== undefined) state = 3;
        else if (query.VoiceIndex !== undefined) state = 2;
        else if (query.VoiceGender !== undefined) state = 1;

        TelemetryLogger.info("FlowController", "StateDetection", `שלב מזוהה: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת ובקשת הקלטה. 
                // שימוש בתפריט ההקלטה הסטנדרטי של ימות המשיח (לשמיעה 1, לאישור 2...)
                // ====================================================================
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 1:
                // ====================================================================
                // שלב 1: STT חכם (עם ניתוח טון) ומעבר לתפריט בחירת גבר/אישה (ספרה 1 בלבד)
                // ====================================================================
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                // ההקלטה מתומללת ע"י ה-AI, שמזהה לבד את טון הדיבור ומוסיף סוגריים עגולים לטקסט!
                const transcribedTextWithEmotion = await gemini.transcribeAudioWithEmotion(mainAudioBuffer);
                TelemetryLogger.info("MainHandler", "STT", `תומלל (כולל רגש אוטומטי): ${transcribedTextWithEmotion}`);

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
                    // מקסימום 1, מינימום 1. ללא אישור (AskNo מופעל). הלקוח מקיש 1 או 2 ומזנק.
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false); 
                break;

            case 2:
                // ====================================================================
                // שלב 2: תפריט הקולות הייעודי (30 קולות סך הכל, מחולק ל-15 בכל מגדר).
                // דורש בדיוק 2 ספרות (למשל 01). מקריא "אפס אחד".
                // ====================================================================
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false); 
                    break;
                }

                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
                
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; // הקראת "אפס אחד", "אפס שתיים"
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }
                
                // מקסימום 2, מינימום 2. AskNo מופעל. הלקוח מקיש "01" ועף ישר לשלב הבא!
                responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false);
                break;

            case 3:
                // ====================================================================
                // שלב 3: הלקוח בחר קול (למשל 05) - יצירת ה-TTS המיידי!
                // * אין תפריט סגנון! ה-AI כבר זיהה את הסגנון בשלב 1 ושתל בסוגריים.
                // * השרת ממתין כמה שניות, וימות המשיח תנגן את ztomao שמוגדר ב-ext.ini!
                // ====================================================================
                const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                
                // הגנה במקרה של הקשת קול מחוץ לטווח
                if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false);
                    break;
                }

                const selectedVoiceId = voiceListCheck[checkIdx].id;
                
                // משיכת הטקסט (הכולל את הנחיות הטון שה-AI סיק) משלב 1
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // --- הפקת האודיו ---
                // פעולה זו נמשכת בממוצע 3-5 שניות. השרת של Vercel פשוט ממתין ל-Promise.
                // בזמן הזה ימות תנגן את ztomao המוגדר!
                const ttsBuffer = await gemini.generateTTS(mainTextForTTS, selectedVoiceId);
                
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsBuffer);

                // ניתוב לשמירה בהתאם להעדפות שמורות
                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileNum = await yemot.getNextSequenceFileName(folder);
                    const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
                    
                    await yemot.uploadFile(finalPath, ttsBuffer);

                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // משמיע את התוצאה
                        .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
                        .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        // ספרה 1 בלבד, מתקדם מיד בלי "לאישור הקישו 1"
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                } else {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                        .addText("נא הקישו את מספר השלוחה לשמירה. למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        // מתיר אפס, מתיר כוכבית. מנקה את ההקלטה בשרת ולא סומך על ימות.
                        .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true);
                }
                break;

            case 4:
                // ====================================================================
                // שלב 4: (ללקוח וותיק) הלקוח נשאל האם הוא מעוניין בעותק נוסף (ספרה 1)
                // ====================================================================
                if (query.WantCopySave === "1") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        // מאפשר אפס (1) וכוכביות
                        .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, true, true);
                } else if (query.WantCopySave === "2") {
                    responseBuilder = new YemotCommandBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                } else {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית לאישור עותק הקישו 1 לביטול הקישו 2")
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                }
                break;

            case 5:  // שמירה רגילה
            case 55: // שמירת עותק
                // ====================================================================
                // שלב 5 + 55: תיוק הקובץ בשלוחת היעד 
                // ====================================================================
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                
                if (targetFolder === undefined) { 
                    responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/"); 
                    break; 
                }
                
                // הלקוח הקיש '0' לציון שורש המערכת
                if (targetFolder === "0") {
                    targetFolder = "";
                }
                
                // השרת שלנו ממיר את הכוכביות לסלשים בבטחה במקום מנוע ימות
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
                    // פעם ראשונה ששומר - מציעים להפוך לברירת מחדל (דורש 1 או 2 בלבד)
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו 1 לסיום הקישו 2")
                        .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false);
                }
                break;

            case 6:
                // ====================================================================
                // שלב 6: עדכון מועדפים במסד הנתונים של ימות (קבצי txt) ופרידה
                // ====================================================================
                if (query.SetDefaultChoice === "1" && query.TargetFolderDefault !== undefined) {
                    const prefPathTxt = `ivr2:/Preferences/${ApiPhone}.txt`;
                    // כותבים קובץ טקסט ששמו מספר הטלפון ובתוכו היעד לשמירה (מומר לסלשים)
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

        // שרשור משתני ה-yemot_token שיעברו איתנו לכל אורך הדרך
        yemotFinalResponse = responseBuilder.build();
        if (yemotFinalResponse.includes("read=") || yemotFinalResponse.includes("id_list_message=")) {
            yemotFinalResponse += `&api_add_99=yemot_token=${encodeURIComponent(YEMOT_TOKEN)}`;
            
            // שימור משתני העזר לטובת מניעת איבוד State ב-Vercel
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
