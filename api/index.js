/**
 * @file api/index.js
 * @version 4.0.0 (Enterprise Edition)
 * @description נקודת הכניסה המרכזית (Serverless Endpoint) למערכת ה-IVR החכמה.
 * המערכת משלבת המרת דיבור לטקסט (STT) ויצירת שמע מטקסט (TTS) תוך שימוש במודלים
 * המתקדמים ביותר של Gemini, בהתממשקות ישירה למערכות "ימות המשיח".
 * * פיצ'רים בגרסה זו:
 * 1. שליטה מוחלטת על אישורי הקשה (AskNo / ביטול "לאישור הקישו 1").
 * 2. תמיכה בנתיבי שלוחות עמוקים (לדוגמה 1*2*3 מתורגם אוטומטית ל- 1/2/3).
 * 3. ניהול State Machine חכם המאפשר ניווט בטוח בין שלבי השיחה.
 * 4. מערכת לוגים פנימית מורחבת (RequestLogger) למעקב תקלות.
 * 5. פונקציונליות "שלוחת ברירת מחדל" הנשמרת במסד הנתונים של ימות המשיח.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות סביבה (Environment Variables) ותצורת מערכת
// ============================================================================
// מפתחות ה-API של גוגל מופרדים בפסיק. המערכת תחלק את העומס ביניהם.
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_FALLBACK_API_KEY"];

// יצירת מופע גלובלי של מנהל ה-AI לטובת חסכון בזיכרון (Cold Start)
const gemini = new GeminiManager(GEMINI_API_KEYS);

// נתיב זמני במערכת הטלפונית בו נשמרות הקלטות ותוצרים בטרם סיווגם הסופי
const TEMP_FOLDER = "/Temp_Gemini_App";

// ============================================================================
// מחלקות עזר: Logger
// ============================================================================
/**
 * מחלקה לניהול והדפסת לוגים בצורה קריאה ומסודרת במסוף של Vercel.
 */
class RequestLogger {
    static info(callId, phone, step, message) {
        console.log(`[INFO] | Call: ${callId} | Phone: ${phone} | Step: ${step} | ${message}`);
    }

    static warn(callId, phone, step, message) {
        console.warn(`[WARN] | Call: ${callId} | Phone: ${phone} | Step: ${step} | ${message}`);
    }

    static error(callId, phone, step, message, err = null) {
        console.error(`[ERROR] | Call: ${callId} | Phone: ${phone} | Step: ${step} | ${message}`);
        if (err) console.error(err);
    }
}

// ============================================================================
// מנוע אובייקט-אוריינטד ליצירת תחביר API של ימות המשיח (YemotBuilder Enterprise)
// ============================================================================
/**
 * מחלקת YemotBuilder
 * תפקידה להרכיב בצורה בטוחה, מובנית ומדויקת את המחרוזות שהשרת מחזיר לימות המשיח.
 * היא מונעת שגיאות תחביר (Syntax Errors) ומאפשרת שימוש בפרמטרים מתקדמים (כמו 15 הערכים של פקודת Read).
 */
class YemotBuilder {
    constructor(action) {
        this.action = action; // לדוגמה: 'read', 'id_list_message', 'go_to_folder'
        this.contentBlocks = [];
        this.params = [];
        this.nextState = {};
        this.goToFolder = null; 
    }

    /**
     * פונקציה פנימית לניקוי טקסט מתווים שעלולים לשבש את מנוע ה-TTS של ימות המשיח
     * @param {string} text - הטקסט הגולמי
     * @returns {string} - טקסט מנוקה מתווים שמורים
     */
    _cleanYemotText(text) {
        if (!text) return "";
        // מוחק נקודות, פסיקים, מינוסים וסוגריים שמשמשים כתווי בקרה בימות
        return text.replace(/[-.(),=]/g, "").replace(/\s+/g, "_"); 
    }

    /**
     * הוספת בלוק טקסט להקראה במנוע הדיבור (TTS) הסטנדרטי של ימות המשיח.
     * @param {string} text - הטקסט להקראה בעברית
     */
    addText(text) {
        const clean = this._cleanYemotText(text);
        if (clean.length > 0) {
            this.contentBlocks.push(`t-${clean}`);
        }
        return this;
    }

    /**
     * הוספת בלוק המפנה לקובץ שמע קיים במערכת ימות המשיח.
     * @param {string} filePath - נתיב הקובץ ללא הקידומת f- וללא סיומת
     */
    addFile(filePath) {
        this.contentBlocks.push(`f-${filePath}`);
        return this;
    }

    /**
     * הגדרת קלט מסוג הקשה (Digits/Number) - תומך ב-15 הפרמטרים המלאים של ה-API.
     * שיטה זו פותרת את בעיית ה"לאישור הקישו 1" ואת בעיית הקשת "9*2*3".
     * * @param {string} varName - שם המשתנה שיחזור ב-Query String.
     * @param {string} type - 'Digits' (מקריא ספרה-ספרה) או 'Number' (מקריא כמספר שלם) או 'No' (לא מקריא).
     * @param {number|string} maxDigits - מקסימום ספרות המותרות להקשה.
     * @param {number|string} minDigits - מינימום ספרות (מונע שגיאת "לא הקשתם מינימום").
     * @param {number|string} timeout - זמן המתנה בשניות להקשת המאזין.
     * @param {boolean} disableConfirmation - אם true, מכבה לחלוטין את בקשת האישור.
     * @param {boolean} allowAsterisk - אם true, מתיר הקשת כוכבית (*).
     * @param {boolean} allowZero - אם true, מתיר הקשת כמות אפס (0).
     * @param {boolean} autoReplaceAsteriskWithSlash - אם true, מתרגם אוטומטית * ל- /.
     */
    setReadConfigAdvanced(varName, type, maxDigits, minDigits, timeout, disableConfirmation = true, allowAsterisk = false, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        
        // ימות המשיח: ערך שישי (צורת השמעה). אם לא מבקשים אישור, עדיף לא להשמיע כלל (No).
        const playType = disableConfirmation ? "No" : type;
        
        // ימות המשיח: ערך שביעי (חסימת כוכבית). yes = חסום, no = מותר.
        const param7_blockAsterisk = allowAsterisk ? "no" : "yes";
        
        // ימות המשיח: ערך שמיני (חסימת כמות אפס). yes = חסום, no = מותר.
        const param8_blockZero = allowZero ? "no" : "yes";
        
        // ימות המשיח: ערך תשיעי (החלפת תווים). מאפשר להמיר * ל- /.
        const param9_replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";
        
        // ימות המשיח: ערך חמישה-עשר (בקשת אישור). "no" מכבה את "לאישור הקישו 1".
        const param15_askConfirm = disableConfirmation ? "no" : "";

        // הרכבת מערך 15 הפרמטרים
        this.params = [
            varName,                // 1. משתנה לשמירה
            "no",                   // 2. האם להשתמש בקיים (תמיד לא)
            "Digits",               // 3. סוג הקלט
            maxDigits || "15",      // 4. מקסימום ספרות
            minDigits || "1",       // 5. מינימום ספרות
            playType,               // 6. צורת השמעת הנתון שהוקש
            param7_blockAsterisk,   // 7. חסימת כוכבית
            param8_blockZero,       // 8. חסימת כמות אפס
            param9_replaceChar,     // 9. החלפת תווים (קסם הנתיבים)
            "",                     // 10. מקשים מאופשרים (ריק = הכל)
            "",                     // 11. מספר ניסיונות (ריק = ברירת מחדל 5)
            "",                     // 12. אפשרות להקשה ריקה
            "",                     // 13. טקסט להקשה ריקה
            "",                     // 14. סוג מקלדת
            param15_askConfirm      // 15. אישור הקשה
        ];

        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה קולית (Record).
     * @param {string} varName - שם המשתנה שיוחזר לשרת.
     * @param {string} folder - התיקייה בימות המשיח בה תישמר ההקלטה.
     * @param {string} fileName - השם שיינתן לקובץ ההקלטה.
     */
    setRecordConfig(varName, folder, fileName) {
        this.params = [
            varName,   // 1. משתנה
            "no",      // 2. האם להשתמש בקיים
            "record",  // 3. סוג קלט: הקלטה
            folder,    // 4. תיקיית יעד
            fileName,  // 5. שם קובץ
            "no",      // 6. סיום ואישור מיידי (no = מפעיל את תפריט ימות הסטנדרטי 1 לשמיעה 2 לאישור)
            "yes",     // 7. האם לשמור את הקובץ גם אם הלקוח ניתק את השיחה
            "no",      // 8. האם לשרשר לקובץ קיים
            "1",       // 9. אורך מינימלי בשניות
            "300"      // 10. אורך מקסימלי בשניות
        ];
        return this;
    }

    /**
     * שרשור משתנים (State) שיחזרו בסבב הבא של פניית ה-API.
     * @param {string} key - מפתח.
     * @param {string|number} value - ערך.
     */
    addState(key, value) {
        if (value !== undefined && value !== null) {
            this.nextState[key] = value;
        }
        return this;
    }

    /**
     * הוספת הוראת ניתוב לשלוחה אחרת בסיום הפעולה.
     * @param {string} folderPath - נתיב השלוחה (למשל "/").
     */
    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /**
     * בניית מחרוזת הפקודה הסופית הנשלחת למנוע של ימות המשיח.
     * @returns {string} הפקודה המפורמטת.
     */
    build() {
        let res = `${this.action}=`;
        
        // שרשור הודעות שמע/טקסט
        if (this.contentBlocks.length > 0) {
            res += this.contentBlocks.join('.');
        }

        // שרשור פרמטרי קלט
        if (this.params.length > 0) {
            res += "=" + this.params.join(',');
        }

        // הזרקת ה-State באמצעות api_add_X
        let index = 0;
        for (const [key, value] of Object.entries(this.nextState)) {
            res += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
            index++;
        }

        // הוספת ניתוב סופי אם קיים
        if (this.goToFolder) {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// פונקציות לוגיקה עסקיות (Business Logic Helpers)
// ============================================================================

/**
 * בודקת האם הנתיב שהוזן חוקי לשמירה בימות המשיח.
 * מתקן נתיבים שגויים או ממיר אפס לנתיב שורש.
 * @param {string} rawPath - נתיב גולמי
 * @returns {string} נתיב נקי
 */
function sanitizeFolderPath(rawPath) {
    if (!rawPath || rawPath === "0") return ""; // שורש המערכת
    // מסיר סלשים כפולים או סלשים בהתחלה/סוף שיכולים לשבור את ה-API
    let clean = rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
    return clean;
}

// ============================================================================
// פונקציית העיבוד הראשית (Main Flow Controller)
// ============================================================================

async function handleIvrFlow(query, yemot, ApiPhone, ApiCallId, YEMOT_TOKEN) {
    let yemotRes = "";
    let responseBuilder = null;

    // איתור השלב הנוכחי על פי המשתנים שהתקבלו ב-Query.
    // הסדר הוא הפוך (מלמטה למעלה) כדי לזהות את השלב המתקדם ביותר שהושלם.
    let state = 0;
    if (query.SetDefaultChoice) state = 6;            // שלב 6: בחירת קביעת ברירת מחדל
    else if (query.TargetFolderCopy) state = 55;      // שלב 55: בחירת יעד לעותק נוסף
    else if (query.TargetFolderDefault) state = 5;    // שלב 5: בחירת יעד לשמירה (פעם ראשונה)
    else if (query.UserChoiceAdditionalSave) state = 4; // שלב 4: שאלה האם לשמור עותק נוסף
    else if (query.VoiceIndex) state = 3;             // שלב 3: הלקוח בחר קול מתוך הרשימה
    else if (query.VoiceGender) state = 2;            // שלב 2: הלקוח בחר מגדר (גבר/אישה)
    else if (query.UserAudioRecord) state = 1;        // שלב 1: הלקוח סיים להקליט את ההודעה

    RequestLogger.info(ApiCallId, ApiPhone, state, "מתחיל עיבוד שלב");

    switch (state) {
        
        // ====================================================================
        // שלב 0: ברוכים הבאים. המערכת מבקשת מהמאזין להקליט את התוכן.
        // ====================================================================
        case 0:
            RequestLogger.info(ApiCallId, ApiPhone, 0, "בקשת הקלטה מהמשתמש");
            responseBuilder = new YemotBuilder("read")
                .addText("ברוכים הבאים למערכת היצירה הקולית")
                .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                // מפעיל את תפריט ההקלטה המקורי של ימות (1 לשמיעה, 2 לאישור וכו')
                .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 1: ניתוח ההקלטה (STT) ובקשת בחירת מגדר.
        // ====================================================================
        case 1:
            RequestLogger.info(ApiCallId, ApiPhone, 1, "מתחיל תמלול (STT) להקלטה");
            const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
            
            // הורדת הקובץ שרגע הוקלט משרתי ימות המשיח
            const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
            
            // שליחת הקובץ ל-Gemini 1.5 Flash (הזול והמהיר) לקבלת טקסט מנוקה עם הנחיות במאי
            const transcribedText = await gemini.transcribeAudio(audioBuffer);
            RequestLogger.info(ApiCallId, ApiPhone, 1, `טקסט פוענח: ${transcribedText.substring(0, 50)}...`);

            if (!transcribedText || transcribedText.length < 2) {
                // מנגנון כשל: לא הצלחנו לפענח דיבור. נחזיר להקלטה מחדש.
                responseBuilder = new YemotBuilder("read")
                    .addText("לא הצלחנו להבין את ההקלטה. אנא דברו ברור יותר ונסו שוב")
                    .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;
            }

            // שומרים את הטקסט המפוענח כקובץ TXT בתיקייה הזמנית. נשתמש בו בשלב ה-TTS.
            await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

            // תפריט בחירת מגדר - דורש ספרה 1 בלבד.
            // **ביטול האישור מופעל כאן (disableConfirmation = true)**
            responseBuilder = new YemotBuilder("read")
                .addText("הטקסט נותח ונקלט בהצלחה")
                .addText("לבחירת קול גברי הקישו 1")
                .addText("לבחירת קול נשי הקישו 2")
                // min=1, max=1, timeout=10s, AskNo=true, blockAsterisk=true, allowZero=false
                .setReadConfigAdvanced("VoiceGender", "Digits", 1, 1, 10, true, true, false, false)
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 2: הלקוח בחר מגדר - הקראת רשימת הקולות הזמינים.
        // ====================================================================
        case 2:
            const isMale = query.VoiceGender === "1";
            const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            RequestLogger.info(ApiCallId, ApiPhone, 2, `תפריט קולות. נבחר מגדר: ${isMale ? 'גבר' : 'אישה'}`);
            
            responseBuilder = new YemotBuilder("read").addText("אנא בחרו את הקול הרצוי מתוך הרשימה");
            
            // בניית תפריט ההשמעה הדינמי מתוך המאגר המוגדר ב-core.js
            for (let i = 0; i < voices.length; i++) {
                const num = i + 1;
                // הוספת 'אפס' לספרות בודדות כדי שימות המשיח יקריא בצורה זורמת
                let spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
            }
            responseBuilder.addText("ובסיום הקישו סולמית");

            // בחירת קול דורשת 2 ספרות (כי יש 15 קולות).
            // **ביטול אישור מופעל (disableConfirmation = true)**
            responseBuilder
                .setReadConfigAdvanced("VoiceIndex", "Digits", 2, 2, 15, true, true, false, false)
                .addState("gender", isMale ? "MALE" : "FEMALE")
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 3: הפקת השמע (TTS) והצעה לשמירה.
        // שלב זה הוא ה"כבד" ביותר ולכן המוזיקה בהמתנה (ext.ini) היא קריטית כאן.
        // ====================================================================
        case 3:
            const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            let rawVoiceIndex = parseInt(query.VoiceIndex, 10);
            
            // הגנת שגיאות: אם המאזין הקיש משהו לא חוקי, נבחר את הראשון כברירת מחדל
            if (isNaN(rawVoiceIndex) || rawVoiceIndex < 1 || rawVoiceIndex > voiceList.length) {
                RequestLogger.warn(ApiCallId, ApiPhone, 3, `הוקש קול לא תקין (${query.VoiceIndex}). משתמש בברירת מחדל.`);
                rawVoiceIndex = 1;
            }
            const selectedVoiceId = voiceList[rawVoiceIndex - 1].id;
            RequestLogger.info(ApiCallId, ApiPhone, 3, `מתחיל הפקת TTS. קול נבחר: ${selectedVoiceId}`);

            // משיכת הטקסט המוכן
            const textToSpeak = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
            if (!textToSpeak) throw new Error("קובץ הטקסט לתמלול לא נמצא בתיקייה הזמנית.");

            // הפקת ה-TTS באמצעות ג'מיני
            const ttsBuffer = await gemini.generateTTS(textToSpeak, selectedVoiceId);
            
            // שמירת האודיו שהופק בתיקייה הזמנית
            const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
            await yemot.uploadFile(ttsTempPath, ttsBuffer);

            // בדיקה במסד הנתונים של ימות האם למאזין כבר יש תיקיית ברירת מחדל
            const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
            const defaultFolderData = await yemot.getTextFile(prefPath);

            if (defaultFolderData && defaultFolderData.trim().length > 0) {
                // תרחיש א': קיימת תיקיית ברירת מחדל. שומרים ישירות!
                const folder = defaultFolderData.trim();
                const nextFileNum = await yemot.getNextSequenceFileName(folder);
                const finalSavePath = `ivr2:/${folder}/${nextFileNum}.wav`;
                
                RequestLogger.info(ApiCallId, ApiPhone, 3, `שומר אוטומטית למועדפים: ${finalSavePath}`);
                await yemot.uploadFile(finalSavePath, ttsBuffer);

                // משמיע את התוצאה ושואל אם לשמור עותק נוסף. ללא אישור נוסף (AskNo).
                responseBuilder = new YemotBuilder("read")
                    .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // השמעת הקובץ שיצרנו
                    .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
                    .addText("האם תרצו לשמור עותק במיקום נוסף. לאישור הקישו 1, לביטול וחזרה לתפריט הראשי הקישו 2")
                    .setReadConfigAdvanced("UserChoiceAdditionalSave", "Digits", 1, 1, 15, true, true, false, false)
                    .addState("yemot_token", YEMOT_TOKEN);

            } else {
                // תרחיש ב': אין תיקיית ברירת מחדל. נשמיע את הקובץ ונבקש נתיב לשמירה.
                // כאן אנחנו חייבים לבקש אישור כפלי בקשת הלקוח, ולאפשר הקשת * או 0!
                RequestLogger.info(ApiCallId, ApiPhone, 3, `מבקש נתיב שמירה פעם ראשונה`);
                
                responseBuilder = new YemotBuilder("read")
                    .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // השמעת הקובץ שיצרנו
                    .addText("הקובץ הושמע בהצלחה. כעת נעבור לשמירת הקובץ במערכת")
                    .addText("נא הקישו את מספר השלוחה לשמירה. למעבר בין שלוחות הקישו כוכבית, ובסיום הקישו סולמית")
                    .addText("לשמירה בתיקייה הראשית, הקישו אפס וסולמית")
                    // max=20, min=1, timeout=15, disableConfirm=false (יבקש אישור!), allowAst=true, allowZero=true, replace=true
                    .setReadConfigAdvanced("TargetFolderDefault", "Digits", 20, 1, 15, false, true, true, true)
                    .addState("yemot_token", YEMOT_TOKEN);
            }
            break;

        // ====================================================================
        // שלב 4: המאזין שכבר יש לו מועדפים נשאל האם לשמור עותק נוסף
        // ====================================================================
        case 4:
            if (query.UserChoiceAdditionalSave === "1") {
                // המאזין בחר 1 -> רוצה עותק נוסף. נבקש נתיב במדויק (עם כוכביות ואפס).
                RequestLogger.info(ApiCallId, ApiPhone, 4, `המשתמש בחר לשמור עותק נוסף.`);
                responseBuilder = new YemotBuilder("read")
                    .addText("נא הקישו את מספר השלוחה לשמירה. למעבר בין שלוחות הקישו כוכבית, ובסיום הקישו סולמית")
                    .addText("לשמירה בתיקייה הראשית, הקישו אפס וסולמית")
                    // חייב לבקש אישור (disableConfirm=false) ולאפשר * ו 0.
                    .setReadConfigAdvanced("TargetFolderCopy", "Digits", 20, 1, 15, false, true, true, true)
                    .addState("yemot_token", YEMOT_TOKEN);
            } else {
                // בחר 2 -> לסיים ולחזור לראשי
                RequestLogger.info(ApiCallId, ApiPhone, 4, `המשתמש ויתר על עותק נוסף.`);
                responseBuilder = new YemotBuilder("go_to_folder").addText("/");
            }
            break;

        // ====================================================================
        // שלב 5 (ו-55): המאזין הקיש נתיב לשמירה. יש לשמור את הקובץ.
        // שלב 5 = פעם ראשונה, נשאל אם להפוך לברירת מחדל. 
        // שלב 55 = עותק נוסף, נחזור לראשי.
        // ====================================================================
        case 5:
        case 55:
            // הנתיב כבר תורגם מכוכביות לסלשים בתוך YemotBuilder עקב הגדרת replaceChar="*/"
            const rawInputFolder = query.TargetFolderDefault || query.TargetFolderCopy;
            
            if (rawInputFolder === undefined) {
                // אם במקרה משתמש ניתק או הקיש רק סולמית ריקה לחלוטין
                responseBuilder = new YemotBuilder("go_to_folder").addText("/");
                break;
            }

            const cleanTargetFolder = sanitizeFolderPath(rawInputFolder);
            RequestLogger.info(ApiCallId, ApiPhone, state, `נתיב לשמירה התקבל: ${rawInputFolder} מנוקה ל: ${cleanTargetFolder || 'שורש'}`);

            // מורידים את ה-TTS שהפקנו מהתיקייה הזמנית
            const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
            
            // מבררים מה המספר הפנוי הבא בתיקיית היעד המבוקשת
            const seqFileName = await yemot.getNextSequenceFileName(cleanTargetFolder || "/");
            const uploadPath = cleanTargetFolder ? `ivr2:/${cleanTargetFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
            
            // שומרים את הקובץ סופית
            await yemot.uploadFile(uploadPath, ttsForSave);

            if (state === 55) {
                // מדובר בשמירת עותק נוסף. נשמיע אישור קצר ונחזור לראשי.
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText(`עותק הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}. תודה ולהתראות`)
                    .addGoToFolder("/");
            } else {
                // זו פעם ראשונה שהוא שומר במערכת (שלב 5). נציע להפוך לברירת מחדל.
                // כאן אנחנו מבטלים את האישור, כי המאזין פשוט לוחץ 1 או 2 לסיום.
                responseBuilder = new YemotBuilder("read")
                    .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                    .addText("האם תרצו לשמור את השלוחה שהקשתם כשלוחת ברירת המחדל שלכם להקלטות הבאות")
                    .addText("לאישור הקישו 1, לביטול הקישו 2")
                    // min=1, max=1, timeout=10, disableConfirm=true, blockAst=true, allowZero=false
                    .setReadConfigAdvanced("SetDefaultChoice", "Digits", 1, 1, 10, true, true, false, false)
                    .addState("targetFolder", cleanTargetFolder)
                    .addState("yemot_token", YEMOT_TOKEN);
            }
            break;

        // ====================================================================
        // שלב 6: עדכון העדפת ברירת המחדל ושחרור המאזין
        // ====================================================================
        case 6:
            const userChoice = query.SetDefaultChoice;
            const folderToMarkAsDefault = query.targetFolder; // נתיב נקי שכבר עבר סניטציה
            
            RequestLogger.info(ApiCallId, ApiPhone, 6, `קביעת ברירת מחדל. בחירה: ${userChoice}`);

            if (userChoice === "1" && folderToMarkAsDefault !== undefined) {
                // הלקוח בחר לשמור את המועדף. ניצור קובץ TXT בתיקיית Preferences עם המספר שלו.
                const userPrefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                await yemot.uploadTextFile(userPrefPath, folderToMarkAsDefault);
                
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("העדפתכם נשמרה בהצלחה. תודה ולהתראות")
                    .addGoToFolder("/");
            } else {
                // הלקוח בחר 2 (או לא ענה / לחץ משהו אחר) - לא שומרים.
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("תודה ולהתראות")
                    .addGoToFolder("/");
            }
            break;

        // כשל (Fallback)
        default:
            RequestLogger.warn(ApiCallId, ApiPhone, state, "שלב לא מוכר, חוזר לראשי.");
            responseBuilder = new YemotBuilder("go_to_folder").addText("/");
    }

    return responseBuilder ? responseBuilder.build() : "";
}

// ============================================================================
// פונקציית הייצוא הראשית - Express/Vercel Handler
// ============================================================================

module.exports = async (req, res) => {
    // מניעת קריסות (ReferenceError / Global Leakage) - איפוס משתנים
    let yemotRes = "";
    
    try {
        // ב-Vercel, נתונים יכולים להגיע ב-GET (query) או POST (body)
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // שליפת הטוקן מתוך הבקשה של ימות המשיח
        const YEMOT_TOKEN = query.yemot_token;

        if (!YEMOT_TOKEN) {
            console.error("[CRITICAL] חסר טוקן של ימות המשיח! הבקשה תידחה.");
            // הודעה מוקלטת מראש בימות המשיח המודיעה על שגיאת הגדרה
            const errorResponse = "id_list_message=t-חסר_טוקן_מערכת_בהגדרות_השלוחה&hangup=yes";
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send(errorResponse);
        }

        // יצירת מנהל ימות המשיח עבור הבקשה הספציפית הזו בלבד
        const yemot = new YemotManager(YEMOT_TOKEN);
        
        const ApiPhone = query.ApiPhone || "0000000000";
        const ApiCallId = query.ApiCallId || "demo-call-id";

        // הפעלת פונקציית הליבה שתחזיר את המחרוזת המושלמת עבור ימות המשיח
        yemotRes = await handleIvrFlow(query, yemot, ApiPhone, ApiCallId, YEMOT_TOKEN);

        // שליחת התשובה - חייב להיות תמיד טקסט רגיל (Plain Text) בקידוד UTF-8
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotRes);

    } catch (error) {
        // טיפול שגיאות אולטימטיבי: השרת לעולם לא יקרוס, המאזין יקבל הודעה מסודרת.
        console.error(`[IVR Fatal Exception] ${error.message}`, error);
        
        // יצירת הודעת חרום ללקוח וניתוק יזום של המערכת.
        const safeErrorResponse = "id_list_message=t-ארעה_שגיאה_קריטית_במערכת_אנו_מתנצלים_על_התקלה&hangup=yes";
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(safeErrorResponse);
    }
};
