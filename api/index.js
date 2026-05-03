/**
 * @file api/index.js
 * @version 7.0.0 (Ultimate Enterprise Edition - Bulletproof Yemot API)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * קובץ זה מכיל את ליבת הלוגיקה העסקית, ניהול המצבים (State Machine) ללא תלות במשתני עזר,
 * בניית תפריטים המוקראים אוטומטית בקול הרובוטי של ימות המשיח, ותמיכה מושלמת בניווט.
 * * פיצ'רים בגרסה זו:
 * 1. מערכת ניקוי טקסט (Sanitizer) אגרסיבית המונעת שתיקות (Silence) וקריסות מנוע ה-TTS של ימות המשיח.
 * 2. זיהוי שלבים מבוסס Presence: מונע "לופים" (Loops) באופן אבסולוטי - לא סומכים על משתני עזר.
 * 3. השתקת "לאישור הקישו 1" דרך שימוש מדויק ב-15 הפרמטרים של פקודת read.
 * 4. תמיכה בסגנון מותאם אישית (הקלטת הנחיית במאי ל-AI) או בחירת סגנונות מוגדרים מראש.
 * 5. המרת כוכביות (*) לסלשים (/) לשמירה חלקה בשלוחות פנימיות.
 * 6. מערכת לוגים מקיפה ברמת השרת למעקב קל ובקרה ב-Vercel.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות סביבה (Environment Variables) וקונפיגורציה
// ============================================================================

// משיכת מפתחות ה-API של גוגל ממשתני הסביבה ב-Vercel (מופרדים בפסיק לניהול עומסים)
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_API_KEY_HERE"];

// אתחול מנהל מודל השפה והשמע (Gemini) פעם אחת בלבד מחוץ ל-Handler לטובת זמני טעינה מהירים
const gemini = new GeminiManager(GEMINI_API_KEYS);

// התיקייה בה יישמרו הקבצים הזמניים במערכת ימות המשיח בטרם ישמרו ליעדם הסופי
const TEMP_FOLDER = "/Temp_Gemini_App";

// רשימת סגנונות ההקראה שיוקראו למאזין בתפריט (שלב 4). 
// ההנחיות באנגלית מוסתרות בתוך סוגריים מרובעים [ ] כדי שמודל ה-TTS יאמץ את הרגש ולא יקריא את המלל.
const SPEECH_STYLES = [
    { id: "1", name: "ניטרלי וטבעי", cue: "" },
    { id: "2", name: "שמח ונלהב", cue: "[Speak in a very happy, excited and cheerful tone] " },
    { id: "3", name: "רציני ורשמי", cue: "[Speak in a serious, informative, and professional tone] " },
    { id: "4", name: "עצוב ודרמטי", cue: "[Speak in a sad, emotional, and dramatic tone] " },
    { id: "5", name: "כועס ותקיף", cue: "[Speak in an angry, aggressive, and firm tone] " },
    { id: "6", name: "לוחש וסודי", cue: "[Whispers quietly and secretly] " },
    { id: "7", name: "סגנון מותאם אישית בהקלטה", cue: "CUSTOM" }
];

// ============================================================================
// מחלקת ניהול הלוגים (Enterprise Request Logger)
// ============================================================================
/**
 * מחלקה זו מנהלת את ההדפסות למסוף הלוגים של Vercel. 
 * מאפשרת לעקוב אחרי מסלול השיחה של כל מאזין, לאתר שגיאות, ולהבין בדיוק איזה
 * נתון גרם לבעיה באם ישנה כזו.
 */
class RequestLogger {
    static info(callId, phone, step, message) {
        console.log(`[INFO] | Call: ${callId} | Phone: ${phone} | Step: ${step} | => ${message}`);
    }

    static warn(callId, phone, step, message) {
        console.warn(`[WARN] | Call: ${callId} | Phone: ${phone} | Step: ${step} | => ${message}`);
    }

    static error(callId, phone, step, message, err = null) {
        console.error(`[ERROR] | Call: ${callId} | Phone: ${phone} | Step: ${step} | => ${message}`);
        if (err) console.error(err);
    }
}

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות ל-API של ימות המשיח (YemotBuilder)
// ============================================================================
/**
 * מחלקה מיוחדת זו מונעת שגיאות תחביר (Syntax Errors) מול השרתים של ימות המשיח.
 * היא אחראית לנקות טקסטים, לחבר פרמטרים עם פסיקים, להוסיף משתני מצב, ולוודא 
 * שכל פקודה נשלחת בדיוק במבנה שה-API של חברת "ימות המשיח" מצפה לקבל.
 */
class YemotBuilder {
    constructor(action) {
        this.action = action; // 'read', 'id_list_message', 'go_to_folder'
        this.contentBlocks = []; // הבלוקים להקראה (t-טקסט או f-קובץ)
        this.params = []; // מערך הפרמטרים של פקודת הקלט
        this.goToFolder = null; // ניתוב שלוחה סופי
    }

    /**
     * פונקציה אגרסיבית לניקוי הטקסט עבור ה-TTS (קול רובוטי) של ימות המשיח.
     * מוחקת כל גרש (כמו במילה ג'מיני), פסיק, סימן קריאה וכדומה - כי תווים אלו
     * שוברים את המחרוזת של ימות המשיח וגורמים לשקט!
     * @param {string} text הטקסט הגולמי
     * @returns {string} טקסט נקי ובטוח לחלוטין להקראה
     */
    _cleanYemotTTS(text) {
        if (!text) return "";
        // שלב 1: החלפת כל תו שאינו עברית, אנגלית או מספר ברווח (מוחק גרשיים וסימני קריאה!)
        let safeText = text.toString().replace(/[^א-תa-zA-Z0-9]/g, " ");
        // שלב 2: צמצום רווחים כפולים והחלפתם בקו תחתון (כך ה-TTS של ימות המשיח מזהה רווחים)
        return safeText.trim().replace(/\s+/g, "_");
    }

    /**
     * מוסיף טקסט שיקרא על ידי הקול הרובוטי של ימות המשיח למאזין.
     */
    addText(text) {
        const cleanStr = this._cleanYemotTTS(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    /**
     * מוסיף קובץ קיים במערכת ימות להשמעה למאזין.
     */
    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    /**
     * הגדרת קלט (הקשת מקשים) עם פרמטרים מתקדמים למניעת אישורים וחסימות.
     * מתודה זו שולחת בדיוק 15 פרמטרים כדי לוודא שימות המשיח מבינה אותנו כהלכה.
     * @param {string} varName - שם המשתנה שיוחזר בכתובת בסבב הבא
     * @param {number} maxDigits - מקסימום ספרות להקשה
     * @param {number} minDigits - מינימום ספרות (מומלץ 1 למניעת שגיאות)
     * @param {number} timeout - זמן המתנה להקשה בשניות
     * @param {boolean} disableConfirmation - אם true משתיק את ההודעה 'לאישור הקישו 1'
     * @param {boolean} allowAsterisk - אם true, מתיר שימוש בכוכבית (*) כחלק מהקלט
     * @param {boolean} allowZero - אם true, מתיר שימוש באפס (0)
     * @param {boolean} autoReplaceAsteriskWithSlash - אם true, ממיר כוכבית לסלש (מעולה לשלוחות פנימיות)
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowAsterisk = false, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        // אם לא רוצים אישור, לא נשמיע חזרה את מה שהלקוח הקיש כדי לחסוך זמן (NO)
        const playType = disableConfirmation ? "NO" : "Digits";
        
        // ימות המשיח עובדת בשיטת yes=חסום, no=מותר. קצת מבלבל, לכן אנחנו מתרגמים פה.
        const blockAsterisk = allowAsterisk ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes";
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";
        
        // פרמטר מס' 15 שולט על תפריט האישור ("לאישור הקישו 1, להקשה מחודשת 2"). "no" משתיק אותו.
        const askConfirm = disableConfirmation ? "no" : "";

        this.params = [
            varName,               // 1. משתנה לשמירה
            "no",                  // 2. האם להשתמש בערך קיים? לא.
            "Digits",              // 3. סוג קלט
            maxDigits.toString(),  // 4. מקסימום ספרות
            minDigits.toString(),  // 5. מינימום ספרות
            playType,              // 6. צורת השמעת הנתון
            blockAsterisk,         // 7. חסימת כוכבית
            blockZero,             // 8. חסימת אפס
            replaceChar,           // 9. החלפת תווים אוטומטית
            "",                    // 10. מקשים מורשים (ריק=הכל מותר)
            "",                    // 11. מספר ניסיונות טעות (ריק=ברירת מחדל של ימות)
            timeout.toString(),    // 12. שניות המתנה להקשה
            "",                    // 13. טקסט להקשה ריקה
            "",                    // 14. סוג מקלדת
            askConfirm             // 15. אישור הקשה
        ];

        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה (Record).
     * מפעיל את תפריט ההקלטה הסטנדרטי של ימות המשיח (1 לשמיעה, 2 לאישור וכו').
     */
    setRecordInput(varName, folder, fileName) {
        this.params = [
            varName,   // 1. שם המשתנה שיוחזר לשרת שלנו
            "no",      // 2. להשתמש בקיים?
            "record",  // 3. סוג קלט (הקלטה קולית)
            folder,    // 4. תיקיית יעד לשמירה בימות
            fileName,  // 5. שם קובץ
            "",        // 6. ביטול תפריט אישור? ריק אומר *להשמיע* את התפריט הרגיל
            "yes",     // 7. שמירה בניתוק? כן, מונע איבוד הקלטות
            "no"       // 8. לשרשר לקובץ קיים? לא
        ];
        return this;
    }

    /**
     * מגדיר העברה סופית של השיחה לשלוחה אחרת.
     */
    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /**
     * מרכיב את הפקודה הסופית על פי כללי ה-API הנוקשים של ימות המשיח.
     */
    build() {
        let res = "";
        
        // חיבור הבלוקים (הודעות/קבצים) עם נקודה כמפריד
        const textPart = this.contentBlocks.join('.');

        if (this.action === "read" && this.params.length > 0) {
            // לפקודת read מצמידים את הפרמטרים עם פסיקים
            res = `read=${textPart}=${this.params.join(',')}`;
        } else if (this.action === "id_list_message") {
            res = `id_list_message=${textPart}`;
        } else if (this.action === "go_to_folder") {
            res = `go_to_folder=${this.goToFolder || "/"}`;
        } else {
            res = `${this.action}=${textPart}`;
        }

        // אם יש ניתוב חזרה או המשך, וזה לא הפעולה המרכזית, נוסיף זאת לכתובת
        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// פונקציות עזר עסקיות (Business Logic Helpers)
// ============================================================================

/**
 * מנקה נתיב שלוחה שהתקבל מהמאזין ומכין אותו לשמירה בטוחה במערכת ימות המשיח.
 * מוודא שאין סלשים כפולים או נתיבים שגויים.
 * @param {string} rawPath הנתיב הגולמי כפי שחזר מפקודת ה-Read
 * @returns {string} נתיב נקי ומסודר
 */
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; // "0" מסמל שמירה בתיקייה הראשית (שורש)
    // הפיכת כוכביות לסלשים (למרות שכבר הומר ב-API, רק ליתר ביטחון) והורדת סלשים מיותרים
    return rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

/**
 * פונקציה חכמה לניקוי משתנים ריקים מהבקשה.
 * אם מאזין ממתין יותר מדי זמן ולא מקיש, ימות המשיח עשויה לשלוח את המשתנה כריק (Timeout).
 * אנו מוחקים אותו מהאובייקט כדי שה-State Machine יחזור וישאל את המאזין שוב את אותה שאלה.
 */
function cleanupEmptyQueryVariables(query) {
    const keysToCheck = [
        "UserAudioRecord", "VoiceGender", "VoiceIndex", "StyleIndex", 
        "CustomStyleRecord", "TargetFolderDefault", "WantCopySave", 
        "TargetFolderCopy", "SetDefaultChoice"
    ];
    for (const key of keysToCheck) {
        if (query[key] === "") {
            delete query[key];
        }
    }
}

// ============================================================================
// פונקציה ראשית: הפקת האודיו מול מודל ה-TTS (מבודדת לחסכון בכפילויות קוד)
// ============================================================================
/**
 * פונקציה זו מרכזת את עבודת ה"משא הכבד". 
 * היא קוראת את הטקסט שתומלל, מצמידה לו את הנחיות הטון, מפיקה אודיו מגוגל, ושומרת בימות.
 */
async function processAndGenerateTTS(query, yemot, ApiCallId, ApiPhone, styleInstructionText) {
    RequestLogger.info(ApiCallId, ApiPhone, "TTS_GENERATION", "מתחיל תהליך פניה לשרתי גוגל ליצירת הקובץ הקולי");
    
    // 1. איתור מזהה הקול המדויק (לפי בחירת מגדר ואינדקס מתוך השלב הקודם)
    const voiceList = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
    let voiceIdx = parseInt(query.VoiceIndex, 10);
    // הגנת גבולות במקרה של הקשה חריגה
    if (isNaN(voiceIdx) || voiceIdx < 1 || voiceIdx > voiceList.length) voiceIdx = 1;
    const selectedVoiceId = voiceList[voiceIdx - 1].id;

    // 2. משיכת הטקסט העברי (שתומלל בשלב 1) מתוך הקובץ הזמני ששמרנו בימות המשיח
    const rawText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
    if (!rawText) throw new Error("קובץ הטקסט הראשי חסר בתיקייה הזמנית ולא ניתן ליצור הקראה");

    // 3. הכנת הטקסט למודל ה-TTS: אנו "עוטפים" את הוראות הבמאי בסוגריים מרובעים.
    // מנועי AI מזהים זאת כ-Prompt Audio Tag ומיישמים את הרגש מבלי להקריא את המילים באנגלית!
    const textToSpeak = `${styleInstructionText}${rawText}`;

    // 4. קריאת API לגוגל (Gemini) וקבלת קובץ השמע כ-Buffer של קובץ WAV תקני
    const ttsBuffer = await gemini.generateTTS(textToSpeak, selectedVoiceId);
    
    // 5. שמירת תוצר ה-TTS בתיקייה הזמנית כדי שנוכל להשמיע אותו מיד למאזין
    const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
    await yemot.uploadFile(ttsTempPath, ttsBuffer);

    // 6. בניית השלב הבא: בדיקה האם יש למאזין "שלוחת ברירת מחדל" שמורה משיחות קודמות
    const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
    const defaultFolder = await yemot.getTextFile(prefPath);

    let builder = new YemotBuilder("read");

    if (defaultFolder && defaultFolder.trim().length > 0) {
        // יש מועדף! נשמור את הקובץ ישירות לשם ונחסוך למאזין זמן הקשה.
        const folder = defaultFolder.trim();
        const nextFileNum = await yemot.getNextSequenceFileName(folder);
        const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
        
        await yemot.uploadFile(finalPath, ttsBuffer);

        builder
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // משמיע את התוצאה המדהימה
            .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם.`)
            .addText("האם תרצו לשמור עותק במיקום נוסף? לאישור הקישו 1, לביטול וחזרה לתפריט הראשי הקישו 2.")
            // מחכה לקבל את ההחלטה במשתנה WantCopySave. מוגבל לספרה אחת וללא אישור.
            .setReadDigitsAdvanced("WantCopySave", 1, 1, 15, true, false, false, false);
    } else {
        // למאזין אין מועדפים, ולכן עלינו לשאול אותו איפה הוא רוצה לשמור את הקובץ כעת.
        builder
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // משמיע את התוצאה
            .addText("הקובץ הושמע בהצלחה. כעת נעבור לשמירת הקובץ במערכת.")
            .addText("נא הקישו את מספר השלוחה לשמירה. למעבר בין שלוחות פנימיות הקישו כוכבית, ובסיום הקישו סולמית.")
            .addText("לשמירה בתיקייה הראשית, הקישו אפס וסולמית.")
            // מחכה לקבל את הנתיב במשתנה TargetFolderDefault. מרשה כוכבית, ואפס, וממיר כוכבית לסלש.
            .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true, true);
    }

    return builder;
}

// ============================================================================
// ליבת המערכת - State Machine Controller
// ============================================================================
/**
 * פונקציה זו מנהלת את לוגיקת השיחה המלאה. 
 * הגדולה של הארכיטקטורה כאן היא שאנחנו לא תלויים במשתני "step" שעלולים לאבד 
 * סנכרון עם השרת של ימות המשיח במקרי תקלה. אנו מחשבים את המיקום של המאזין 
 * לפי המשתנים שכבר נאספו ממנו וקיימים בכתובת (Query String).
 * "אם יש לי את X, סימן שאני בשלב Y". זה מונע לופים לחלוטין!
 */
async function handleIvrFlow(query, yemot, ApiPhone, ApiCallId) {
    let responseBuilder = null;

    // מחיקת משתנים ריקים (נוצרים כשהלקוח מתמהמה ולא מקיש כלום בטלפון, מה שמוביל ל-Timeout).
    // מחיקתם תגרום למכונת המצבים לחזור שלב אחד אחורה ולשאול אותו שוב.
    cleanupEmptyQueryVariables(query);

    // זיהוי השלב בו המאזין נמצא - נבדק מהסוף להתחלה כדי למצוא את השלב המאוחר ביותר שהושלם
    let state = 1;
    if (query.SetDefaultChoice !== undefined) state = 10;
    else if (query.TargetFolderCopy !== undefined) state = 9;
    else if (query.WantCopySave !== undefined) state = 8;
    else if (query.TargetFolderDefault !== undefined) state = 7;
    else if (query.CustomStyleRecord !== undefined) state = 6;
    else if (query.StyleIndex !== undefined) state = 5;
    else if (query.VoiceIndex !== undefined) state = 4;
    else if (query.VoiceGender !== undefined) state = 3;
    else if (query.UserAudioRecord !== undefined) state = 2;

    RequestLogger.info(ApiCallId, ApiPhone, state, "מעבד את מצב השיחה הנוכחי");

    switch (state) {
        
        // ====================================================================
        // שלב 1: פתיח המערכת והקלטת הודעת המקור
        // ====================================================================
        case 1:
            responseBuilder = new YemotBuilder("read")
                .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני.")
                .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית.")
                // משתמש בפונקציית הקלטה המפעילה את תפריט ימות הסטנדרטי לאישור ההקלטה
                .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
            break;

        // ====================================================================
        // שלב 2: תמלול (STT) של ההקלטה, ובחירת מגדר (גבר/אישה)
        // ====================================================================
        case 2:
            RequestLogger.info(ApiCallId, ApiPhone, 2, "מתחיל תמלול ההקלטה הראשי בשרתי גוגל");
            const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
            
            // הורדת ההקלטה שהרגע בוצעה כדי לשלוח למודל השפה
            const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
            
            // תמלול באמצעות המודל החסכוני והמהיר ביותר של גוגל
            const transcribedText = await gemini.transcribeAudio(mainAudioBuffer, "gemini-3.1-flash-lite-preview");
            
            // בקרת שגיאות על התמלול
            if (!transcribedText || transcribedText.length < 2) {
                RequestLogger.warn(ApiCallId, ApiPhone, 2, "התמלול נכשל או ריק. מבקש מהמאזין להקליט שוב.");
                responseBuilder = new YemotBuilder("read")
                    .addText("לא הצלחנו להבין את ההקלטה. אנא דברו ברור יותר ונסו שוב.")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;
            }

            RequestLogger.info(ApiCallId, ApiPhone, 2, `טקסט שפוענח ושמור: ${transcribedText.substring(0,40)}...`);
            
            // שומרים את הטקסט בקובץ כדי לא לאבד אותו בסבבים הבאים של השיחה
            await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

            // תפריט המוקרא אוטומטית לבחירת קול הקריין
            responseBuilder = new YemotBuilder("read")
                .addText("הטקסט נותח ונקלט בהצלחה.")
                .addText("לבחירת קול קריין גברי הקישו 1, לבחירת קול קריינית נשית הקישו 2.")
                // 1=max, 1=min, 10=timeout. בלי אישור 'הקישו 1' מיותר.
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false); 
            break;

        // ====================================================================
        // שלב 3: הלקוח בחר מגדר - מקריאים לו את התפריט המפורט של שמות הקולות
        // ====================================================================
        case 3:
            // מאמתים את הקשת המאזין (אם הקיש משהו לא חוקי נחזיר אותו שלב אחורה כדי שיקיש שוב)
            if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                RequestLogger.warn(ApiCallId, ApiPhone, 3, "מגדר לא חוקי הוקש. מבקש שוב.");
                responseBuilder = new YemotBuilder("read")
                    .addText("בחירה לא חוקית. לבחירת קול גברי הקישו 1, לקול נשי הקישו 2.")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false); 
                break;
            }

            const isMale = query.VoiceGender === "1";
            const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            
            responseBuilder = new YemotBuilder("read")
                .addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה:");
            
            // בנייה דינמית של תפריט הקולות. אנו מוסיפים 'אפס' לספרות בודדות
            // כדי שימות המשיח תקרא "אפס שתיים" במקום סתם "שתים", לטובת זרימה קולית נעימה.
            for (let i = 0; i < voices.length; i++) {
                const num = i + 1;
                const spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}.`);
            }
            responseBuilder.addText("ובסיום הקישו סולמית.");

            // בחירת קול מצריכה 2 ספרות, כי יש עד 15 קולות בכל מגדר. 
            // המינימום הוא 1, כדי לא לצעוק על מי שהקיש סתם "3" ולא "03".
            responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 1, 15, true, false, false, false);
            break;

        // ====================================================================
        // שלב 4: הלקוח בחר את הקול - נעבור לתפריט "סגנון הקראה" (רגש / כוונה)
        // ====================================================================
        case 4:
            // הגנת שגיאות לבחירת הקול
            const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            let checkIdx = parseInt(query.VoiceIndex, 10);
            if (isNaN(checkIdx) || checkIdx < 1 || checkIdx > voiceListCheck.length) {
                RequestLogger.warn(ApiCallId, ApiPhone, 4, "קול לא חוקי. מבקש קול שוב.");
                responseBuilder = new YemotBuilder("read")
                    .addText("בחירה לא חוקית. אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית.")
                    .setReadDigitsAdvanced("VoiceIndex", 2, 1, 15, true, false, false, false);
                break;
            }

            responseBuilder = new YemotBuilder("read")
                .addText("מצוין. כעת נבחר את סגנון ההקראה וטון הדיבור.");

            // הרכבת תפריט הסגנונות הדינמי המופיע למעלה בקונפיגורציה
            SPEECH_STYLES.forEach(style => {
                responseBuilder.addText(`ל${style.name} הקישו ${style.id}.`);
            });

            responseBuilder.setReadDigitsAdvanced("StyleIndex", 1, 1, 15, true, false, false, false);
            break;

        // ====================================================================
        // שלב 5: נבחר סגנון. אם זה מותאם אישית (7) נשלח להקלטה, אחרת נייצר TTS מיד.
        // ====================================================================
        case 5:
            const styleIdx = parseInt(query.StyleIndex, 10);
            const selectedStyle = SPEECH_STYLES.find(s => s.id === styleIdx.toString());

            if (!selectedStyle) {
                // המאזין הקיש סגנון לא קיים
                responseBuilder = new YemotBuilder("read")
                    .addText("בחירה לא חוקית. אנא בחרו את סגנון ההקראה מתוך הרשימה.")
                    .setReadDigitsAdvanced("StyleIndex", 1, 1, 15, true, false, false, false);
                break;
            }

            if (selectedStyle.cue === "CUSTOM") {
                // מקש 7 נבחר. המאזין מתבקש להקליט את הוראות הבמאי (הנחיות הפרומפט שלו למודל)
                RequestLogger.info(ApiCallId, ApiPhone, 5, "נבחר סגנון מותאם אישית. מפנה להקלטה.");
                responseBuilder = new YemotBuilder("read")
                    .addText("אנא הקליטו בקולכם את סגנון ההקראה הנדרש. למשל, הקרא זאת בקול בוכים או הקרא זאת בהתלהבות רבה. ולאחר מכן הקישו סולמית.")
                    .setRecordInput("CustomStyleRecord", TEMP_FOLDER, `${ApiCallId}_style`);
            } else {
                // נבחר סגנון קבוע (לדוגמה: "כועס ותקיף"). נייצר את האודיו באופן מיידי ונחזיר פקודת ימות.
                RequestLogger.info(ApiCallId, ApiPhone, 5, `נבחר סגנון קבוע: ${selectedStyle.name}`);
                responseBuilder = await processAndGenerateTTS(query, yemot, ApiCallId, ApiPhone, selectedStyle.cue);
            }
            break;

        // ====================================================================
        // שלב 6: הלקוח הקליט סגנון מותאם אישית. נתמלל אותו ואז נייצר את ה-TTS.
        // ====================================================================
        case 6:
            RequestLogger.info(ApiCallId, ApiPhone, 6, "מתחיל תמלול הוראות סגנון מותאמות אישית");
            const styleRecordPath = `${TEMP_FOLDER}/${ApiCallId}_style.wav`;
            const styleAudioBuffer = await yemot.downloadFile(`ivr2:${styleRecordPath}`);
            
            let customStyleText = await gemini.transcribeAudio(styleAudioBuffer, "gemini-3.1-flash-lite-preview");
            
            // הגנה למקרה של רעשי רקע שלא הובנו - לא נפיל את התהליך, פשוט נייצר בלי סגנון מיוחד
            if (!customStyleText || customStyleText.length < 2) {
                RequestLogger.warn(ApiCallId, ApiPhone, 6, "תמלול סגנון נכשל. ממשיך ללא הנחיה מיוחדת.");
                customStyleText = ""; 
            } else {
                // עוטף את הנחיית המשתמש בסוגריים מרובעים. זה הופך את זה להנחיית במאי (Prompt Tag).
                customStyleText = `[Speak according to these instructions: ${customStyleText}] `;
            }

            responseBuilder = await processAndGenerateTTS(query, yemot, ApiCallId, ApiPhone, customStyleText);
            break;

        // ====================================================================
        // שלב 7: הלקוח (החדש) הקיש נתיב לשמירת הקובץ. נתייק את הקובץ ונסדיר מועדפים.
        // ====================================================================
        case 7:
            const rawTarget = query.TargetFolderDefault;
            if (rawTarget === undefined) { 
                // אם המאזין ניתק בדיוק כאן, השרת מחזיר אותו לשורש כדי לא להיתקע.
                responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                break; 
            }

            const cleanTarget = cleanAndSanitizeFolder(rawTarget);
            RequestLogger.info(ApiCallId, ApiPhone, 7, `שמירת יעד מבוקשת לנתיב: ${cleanTarget || 'שורש המערכת'}`);

            // משיכת הקובץ המוגמר מהתיקייה הזמנית והעברתו לנתיב היעד במערכת הטלפונית
            const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
            const seqFileName = await yemot.getNextSequenceFileName(cleanTarget || "/");
            const uploadPath = cleanTarget ? `ivr2:/${cleanTarget}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
            
            await yemot.uploadFile(uploadPath, ttsForSave);

            // שואל האם לשמור את השלוחה הזו כמועדפת (ברירת מחדל) לפעמים הבאות שיכנס למערכת
            responseBuilder = new YemotBuilder("read")
                .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}.`)
                .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות? לאישור הקישו 1, לסיום הקישו 2.")
                // מאשר ספרה 1 או 2, מבלי להשמיע תפריט אישור נוסף
                .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false, false);
            break;

        // ====================================================================
        // שלב 8: הלקוח (הוותיק) נשאל האם הוא מעוניין בעותק נוסף בנתיב שונה. 
        // ====================================================================
        case 8:
            if (query.WantCopySave === "1") {
                // הלקוח בחר לחייב אותנו לשמור עותק. נשאל אותו איפה.
                responseBuilder = new YemotBuilder("read")
                    .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית.")
                    .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית.")
                    // כאן חובה להתיר כוכביות, אפס, ולתרגם כוכבית לסלש (autoReplace=true).
                    .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, true, true, true);
            } else if (query.WantCopySave === "2") {
                // המאזין בחר 2, אין עותק נוסף. נסיים.
                responseBuilder = new YemotBuilder("id_list_message").addText("תודה ולהתראות.")
                responseBuilder.addGoToFolder("/");
            } else {
                // שגיאת הקשה, נבקש שוב.
                responseBuilder = new YemotBuilder("read")
                    .addText("בחירה שגויה. לאישור עותק נוסף הקישו 1, לביטול הקישו 2.")
                    .setReadDigitsAdvanced("WantCopySave", 1, 1, 15, true, false, false, false);
            }
            break;

        // ====================================================================
        // שלב 9: שמירת העותק הנוסף בנתיב הנפרד וסיום קו.
        // ====================================================================
        case 9:
            const rawCopy = query.TargetFolderCopy;
            if (rawCopy === undefined) { 
                responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                break; 
            }

            const cleanCopy = cleanAndSanitizeFolder(rawCopy);
            RequestLogger.info(ApiCallId, ApiPhone, 9, `שמירת עותק נוסף לנתיב: ${cleanCopy || 'שורש'}`);

            const ttsForCopy = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
            const copyFileName = await yemot.getNextSequenceFileName(cleanCopy || "/");
            const copyUploadPath = cleanCopy ? `ivr2:/${cleanCopy}/${copyFileName}.wav` : `ivr2:/${copyFileName}.wav`;
            
            await yemot.uploadFile(copyUploadPath, ttsForCopy);

            // הפעם אנחנו מסיימים באמצעות id_list_message (הודעה ללא דרישת קלט)
            responseBuilder = new YemotBuilder("id_list_message")
                .addText(`העותק נשמר בהצלחה כקובץ מספר ${copyFileName}. תודה ולהתראות.`)
                .addGoToFolder("/");
            break;

        // ====================================================================
        // שלב 10: תיעוד "העדפת השמירה" (המועדפים) של הלקוח וסיום מלא.
        // ====================================================================
        case 10:
            if (query.SetDefaultChoice === "1" && query.TargetFolderDefault !== undefined) {
                const prefPathTxt = `ivr2:/Preferences/${ApiPhone}.txt`;
                const safeSavedFolder = cleanAndSanitizeFolder(query.TargetFolderDefault);
                
                // כותבים קובץ טקסט ששמו הוא מספר הטלפון של המאזין. בפנים ישמור את היעד המועדף עליו.
                await yemot.uploadTextFile(prefPathTxt, safeSavedFolder);
                RequestLogger.info(ApiCallId, ApiPhone, 10, "נשמרו מועדפים חדשים ללקוח");
                
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("שלוחת ברירת המחדל עודכנה בהצלחה. תודה ולהתראות.")
                    .addGoToFolder("/");
            } else if (query.SetDefaultChoice === "2") {
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("תודה ולהתראות.")
                    .addGoToFolder("/");
            } else {
                 responseBuilder = new YemotBuilder("read")
                    .addText("בחירה שגויה. לשמירת שלוחה כברירת מחדל הקישו 1, לביטול הקישו 2.")
                    .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false, false);
            }
            break;

        default:
            // מנגנון ביטחון: אם הגיע שלב בלתי אפשרי, נחזיר את המאזין לתפריט הראשי
            RequestLogger.warn(ApiCallId, ApiPhone, state, "שלב בלתי מזוהה הגיע, מנתב לשורש המערכת.");
            responseBuilder = new YemotBuilder("go_to_folder").addText("/");
    }

    return responseBuilder ? responseBuilder.build() : "";
}

// ============================================================================
// נקודת הקצה ליצוא השרת (Express / Vercel Serverless Function Export)
// ============================================================================

module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        // איחוד פרמטרים בין שיטת GET ו-POST (ימות המשיח תומכת בשתיהן)
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        const ApiPhone = query.ApiPhone || "UnknownPhone";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        // הגנת התחברות - ללא טוקן המערכת לא מסוגלת לעבוד
        if (!YEMOT_TOKEN) {
            RequestLogger.error(ApiCallId, ApiPhone, "INIT", "נדחתה גישה עקב חוסר ב- YEMOT_TOKEN.");
            const errorMsg = "id_list_message=t-חסר_טוקן_מערכת_בהגדרות_השלוחה&hangup=yes";
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send(errorMsg);
        }

        // הגנת ניתוק - כאשר המאזין טורק את הטלפון, ימות המשיח שולחת פניית פרידה (Hangup Event).
        // אנו חייבים להחזיר לה מחרוזת ריקה כדי שלא תכביד סתם על שרתי גוגל.
        if (query.hangup === "yes") {
            RequestLogger.info(ApiCallId, ApiPhone, "HANGUP", "המאזין ניתק את השיחה מיוזמתו. עוצר הליכים.");
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        // אתחול אובייקט הגישה לימות המשיח (מאפשר הורדה והעלאת קבצים בימות)
        const yemot = new YemotManager(YEMOT_TOKEN);
        
        // הרצת מכונת המצבים החכמה (State Machine) וקבלת פקודת התחביר המושלמת
        yemotFinalResponse = await handleIvrFlow(query, yemot, ApiPhone, ApiCallId);

        // שליחת התשובה בחזרה לשרתי ימות המשיח. 
        // חובה להחזיר Text Plain בקידוד UTF-8. כל תצורה אחרת (כמו JSON) תוביל לקריסת המערכת בטלפון.
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        // המפלט האחרון (Ultimate Catch Block): גם אם שרת של גוגל נפל לחלוטין, 
        // המאזין בטלפון אף פעם לא ישמע "אין מענה משרת API". הוא יקבל הודעת התנצלות תקינה בעברית.
        console.error(`[IVR Critical Exception] Server crashed unexpectedly:`, error);
        
        const safeFallbackResponse = new YemotBuilder("id_list_message")
            .addText("אירעה שגיאה קריטית במערכת. אנו מתנצלים על התקלה.")
            .addGoToFolder("/")
            .build();
            
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(safeFallbackResponse);
    }
};
