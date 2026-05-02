/**
 * @file api/index.js
 * @version 5.0.0 (Enterprise Edition - Full Menu Voice & Styles)
 * @description נקודת הכניסה המרכזית (Serverless Endpoint) למערכת ה-IVR החכמה של ימות המשיח.
 * המערכת משלבת המרת דיבור לטקסט (STT) מבית גוגל (Gemini 3.1 Flash Lite Preview),
 * ויצירת שמע מטקסט (TTS) באמצעות Gemini 2.5 Flash TTS.
 * * פיצ'רים מרכזיים בגרסה זו:
 * 1. הקראת כל התפריטים בקול הרובוטי של ימות המשיח (באמצעות מחרוזת t-).
 * 2. תפריט בחירת מגדר (קול גברי / נשי).
 * 3. תפריט בחירת קול מדויק לפי שמות וקולות (1-15).
 * 4. תפריט בחירת סגנונות (שמח, רציני, עצוב, ניטרלי) + סגנון מותאם אישית (הקלטת הנחיית במאי).
 * 5. עיבוד הנחיות במאי (System Instructions) כטקסט בסוגריים מרובעים כדי שג'מיני לא יקריא אותן בקול.
 * 6. ביטול מוחלט של "לאישור הקישו 1" (AskNo) בכל התפריטים הקוליים - החלקה מהירה של השיחה.
 * 7. תמיכה מלאה בנתיבים עמוקים של שלוחות (כגון 9*2*3 שמתורגם אוטומטית ל- 9/2/3).
 * 8. מערכת Logging מתקדמת למעקב אחרי שגיאות ותקלות בסביבת Vercel.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// 1. קונפיגורציה, מפתחות והגדרות סביבה גלובליות
// ============================================================================

// מערך של מפתחות גישה ל-API של גוגל (Gemini).
// במידה ויש הגבלה (Rate Limit) על מפתח אחד, המערכת בספריית Core תדלג אוטומטית למפתח הבא.
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_API_KEY_HERE"];

// אתחול מנהל ג'מיני פעם אחת בלבד (מחוץ ל-Handler) כדי לחסוך זמן בהפעלות הבאות (Cold Start Reduction).
const gemini = new GeminiManager(GEMINI_API_KEYS);

// התיקייה הזמנית במערכת ימות המשיח שבה נשמור את הקלטות הבסיס והתמלולים לפני אישורם הסופי.
const TEMP_FOLDER = "/Temp_Gemini_App";

// רשימת הסגנונות הקבועים שיוקראו למאזין בתפריט הסגנונות (שלב 4).
// המערכת מתרגמת כל בחירה להנחיית טון (Prompt Cue) שמועברת למודל השמע באנגלית.
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
// 2. מחלקת ניהול הלוגים (Enterprise Request Logger)
// ============================================================================
/**
 * מחלקה זו אחראית להדפסת הודעות מעקב לשרתי Vercel. 
 * במקרה של תקלה, ניתן יהיה לאתר במדויק באיזה שלב הלקוח היה ומה גרם לקריסה.
 */
class RequestLogger {
    /**
     * רושם הודעת מידע רגילה
     * @param {string} callId מזהה השיחה הייחודי מימות המשיח
     * @param {string} phone מספר הטלפון של המאזין
     * @param {string|number} step השלב הנוכחי בתהליך ה-IVR
     * @param {string} message הודעת המעקב
     */
    static info(callId, phone, step, message) {
        console.log(`[INFO] [Call: ${callId}] [Phone: ${phone}] [Step: ${step}] => ${message}`);
    }

    /**
     * רושם הודעת אזהרה
     */
    static warn(callId, phone, step, message) {
        console.warn(`[WARN] [Call: ${callId}] [Phone: ${phone}] [Step: ${step}] => ${message}`);
    }

    /**
     * רושם שגיאה קריטית, כולל פירוט השגיאה (Stack Trace)
     */
    static error(callId, phone, step, message, err = null) {
        console.error(`[ERROR] [Call: ${callId}] [Phone: ${phone}] [Step: ${step}] => ${message}`);
        if (err) {
            console.error(`[Stack Trace]:`, err);
        }
    }
}

// ============================================================================
// 3. מנוע יצירת הפקודות לימות המשיח (YemotBuilder Class)
// ============================================================================
/**
 * מחלקת YemotBuilder נועדה לבנות בצורה בטוחה ותקנית את הפקודות שימות המשיח דורשת.
 * היא מטפלת בהרכבת פקודות read, id_list_message, שרשור הקראות מנוע ה-TTS של ימות,
 * והעברת משתנים (State) משלב לשלב.
 */
class YemotBuilder {
    constructor(action) {
        this.action = action; // פעולת הבסיס: 'read', 'go_to_folder', 'id_list_message'
        this.contentBlocks = []; // הבלוקים שיקריא (קבצים או tts מובנה)
        this.params = []; // פרמטרים ספציפיים לפקודת קלט (15 הפרמטרים של read)
        this.nextState = {}; // משתנים שיעברו לשלב הבא ב-API
        this.goToFolder = null; // ניתוב סופי אם קיים
    }

    /**
     * פונקציה פנימית לניקוי הטקסט שימות המשיח אמורה להקריא (TTS פנימי).
     * ימות המשיח קורסת אם יש במחרוזת תווים שמהווים סימני פיסוק של פקודות (כמו פסיק, שווה, סוגריים).
     * @param {string} text - הטקסט המקורי להקראה
     * @returns {string} טקסט מנוקה ומוכן להקראה
     */
    _cleanYemotTTS(text) {
        if (!text) return "";
        // מחיקת סימני פיסוק מסוכנים והחלפת רווחים בקו תחתון (כך עובד ה-TTS של ימות ב-API)
        return text.replace(/[-.(),=]/g, "").replace(/\s+/g, "_"); 
    }

    /**
     * הוספת בלוק הקראת טקסט (מנוע הדיבור הרובוטי הרגיל של ימות המשיח).
     * שימושי מאוד לתפריטים כדי שהמאזין לא יקיש על עיוור.
     * @param {string} text - הטקסט שיוקרא למאזין
     */
    addText(text) {
        const cleanStr = this._cleanYemotTTS(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    /**
     * הוספת השמעת קובץ קולי קיים במערכת (כמו הקובץ שהמודל הפיק).
     * @param {string} filePath - הנתיב הפנימי בימות (למשל: 'Temp/audio_tts')
     */
    addFile(filePath) {
        this.contentBlocks.push(`f-${filePath}`);
        return this;
    }

    /**
     * הגדרת קלט מסוג הקשת מקשים (Digits). תומך בביטול אישורים והגדרות מתקדמות.
     * @param {string} varName - שם המשתנה שבו תישמר הקשת המאזין
     * @param {number|string} maxDigits - מקסימום ספרות מותרות
     * @param {number|string} minDigits - מינימום ספרות (למניעת שגיאת ימות "לא הקשתם מינימום")
     * @param {number|string} timeout - שניות להמתנה למענה
     * @param {boolean} disableConfirmation - אם true, מכבה את ההודעה "לאישור הקישו 1".
     * @param {boolean} allowAsterisk - אם true, מתיר שימוש בכוכבית (*) כחלק מהקלט.
     * @param {boolean} allowZero - אם true, מתיר שימוש בספרה אפס (0).
     * @param {boolean} autoReplaceAsteriskWithSlash - אם true, מתרגם כל כוכבית לסלש (מעולה לשלוחות פנימיות).
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowAsterisk = false, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        // הערך ה-6: האם להקריא את מה שהוקש? אם לא צריכים אישור, גם לא נקריא (No).
        const playType = disableConfirmation ? "No" : "Digits";
        // הערך ה-7: חסימת כוכבית?
        const blockAsterisk = allowAsterisk ? "no" : "yes";
        // הערך ה-8: חסימת אפס?
        const blockZero = allowZero ? "no" : "yes";
        // הערך ה-9: החלפת תווים אוטומטית (כדי ש- 9*2 יחזור לשרת כ- 9/2)
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";
        // הערך ה-15: שולט האם ימות תשאל "לאישור הקישו 1 להקשה מחדש 2". 'no' משתיק את זה לחלוטין.
        const askConfirm = disableConfirmation ? "no" : "";

        this.params = [
            varName,               // 1. משתנה לשמירה
            "no",                  // 2. האם להשתמש בקיים?
            "Digits",              // 3. סוג קלט
            maxDigits.toString(),  // 4. מקסימום
            minDigits.toString(),  // 5. מינימום
            playType,              // 6. צורת השמעה
            blockAsterisk,         // 7. חסימת כוכבית
            blockZero,             // 8. חסימת אפס
            replaceChar,           // 9. החלפת תווים
            "", "", "", "", "",    // 10-14. מקשים, ניסיונות, מקלדות וכו'
            askConfirm             // 15. ביטול אישור
        ];

        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה (Record).
     * משתמש בתפריט הסטנדרטי של ימות המשיח כדי שהמאזין יוכל לשמוע את עצמו ולאשר.
     */
    setRecordInput(varName, folder, fileName) {
        this.params = [
            varName,   // 1. משתנה
            "no",      // 2. להשתמש בקיים
            "record",  // 3. סוג קלט
            folder,    // 4. תיקייה
            fileName,  // 5. שם קובץ
            "no",      // 6. אישור מיידי? "no" מפעיל את תפריט ההקלטה (1 לשמיעה, 2 לאישור)
            "yes",     // 7. שמירה בניתוק? yes מונע איבוד חומר אם השיחה התנתקה
            "no",      // 8. לשרשר לקיים?
            "1",       // 9. אורך מינימלי
            "600"      // 10. אורך מקסימלי (10 דקות)
        ];
        return this;
    }

    /**
     * שומר משתני State שיחזרו אלינו מהשרת בסבב הבא
     */
    addState(key, value) {
        if (value !== undefined && value !== null) {
            this.nextState[key] = value;
        }
        return this;
    }

    /**
     * הוספת פעולת סיום והעברה לשלוחה אחרת.
     */
    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /**
     * מחזיר את המחרוזת הסופית שמוכנה להישלח לימות המשיח
     */
// בתוך class YemotBuilder, תחליף את פונקציית build:
build() {
        let res = "";
        // מחבר את כל חלקי הטקסט/קבצים עם נקודה ביניהם (הפורמט הנדרש)
        const textPart = this.contentBlocks.join('.');

        if (this.action === "read") {
            // מחבר את 15 הפרמטרים שנוצרו ב-setReadDigitsAdvanced עם פסיקים
            const paramsPart = this.params.length > 0 ? this.params.join(',') : "";
            // שימוש ב- '=' במקום '^' ובפסיקים במקום '>'
            res = `read=${textPart}=${paramsPart}`;
        } else if (this.action === "id_list_message") {
            res = `id_list_message=${textPart}`;
        } else if (this.action === "go_to_folder") {
            res = `go_to_folder=${this.goToFolder || "/"}`;
        } else {
            res = `${this.action}=${textPart}`;
        }

        // הוספת משתני ה-State (כדי שהשרת יזכור באיזה שלב אנחנו)
        // שימוש ב- '&' במקום '*' כפי שנדרש ב-API
        let i = 0;
        for (const [key, value] of Object.entries(this.nextState)) {
            res += `&api_add_${i}=${key}=${encodeURIComponent(value)}`;
            i++;
        }

        // אם הגדרת לאן לעבור בסיום הפעולה
        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// 4. פונקציות עזר (Helpers) 
// ============================================================================

/**
 * מנקה נתיב שלוחה שהתקבל מהמאזין ומוודא שהוא תקין לשמירה.
 * @param {string} rawPath הנתיב כפי שהתקבל מהקשה (יכול לכלול כוכביות או סלשים כפולים)
 * @returns {string} נתיב תקין (ללא סלש בהתחלה/בסוף) או מחרוזת ריקה לשורש המערכת.
 */
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; // "0" מוגדר כשמירה בתיקייה הראשית
    let clean = rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
    return clean;
}

// ============================================================================
// 5. המוח והלוגיקה (The State Machine Controller)
// ============================================================================
/**
 * פונקציה זו מנהלת את כל שלבי השיחה. היא מקבלת את משתני ה-Query, קובעת באיזה
 * שלב המאזין נמצא כרגע, מפעילה פונקציות של ג'מיני וימות, ומחזירה את הפקודה המתאימה.
 */
async function handleIvrFlow(query, yemot, ApiPhone, ApiCallId, YEMOT_TOKEN) {
    let responseBuilder = null;

    // איתור השלב (State) הנוכחי. נעשה מהשלב המאוחר ביותר למוקדם.
    let state = 0;
    if (query.SetDefaultChoice) state = 10;            // האם לשמור כמועדף?
    else if (query.TargetFolderCopy) state = 9;        // שלוחה לשמירת עותק נוסף
    else if (query.WantCopySave) state = 8;            // האם מעוניין בעותק נוסף?
    else if (query.TargetFolderDefault) state = 7;     // שלוחה לשמירה (פעם ראשונה)
    else if (query.CustomStyleRecord) state = 6;       // סיים להקליט סגנון מותאם אישית
    else if (query.StyleIndex) state = 5;              // בחר סגנון הקראה מהתפריט
    else if (query.VoiceIndex) state = 4;              // בחר קול מתוך הרשימה (1-15)
    else if (query.VoiceGender) state = 3;             // בחר מגדר (1 גבר, 2 אישה)
    else if (query.UserAudioRecord) state = 2;         // סיים להקליט את הטקסט הראשי
    else state = 1;                                    // כניסה ראשונית למערכת

    RequestLogger.info(ApiCallId, ApiPhone, state, "מעבד שלב");

    switch (state) {
        
        // --------------------------------------------------------------------
        // שלב 1: קבלת פנים ובקשת הקלטת טקסט ראשית
        // --------------------------------------------------------------------
        case 1:
            responseBuilder = new YemotBuilder("read")
                .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // --------------------------------------------------------------------
        // שלב 2: תמלול הטקסט (STT) ושאלת מגדר הקול המבוקש
        // --------------------------------------------------------------------
        case 2:
            RequestLogger.info(ApiCallId, ApiPhone, 2, "מתחיל תמלול קובץ אודיו ראשי");
            const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
            const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
            
            // תמלול באמצעות המודל הזול והמהיר ביותר של גוגל
            const transcribedText = await gemini.transcribeAudio(mainAudioBuffer, "gemini-3.1-flash-lite-preview");
            
            if (!transcribedText || transcribedText.length < 2) {
                RequestLogger.warn(ApiCallId, ApiPhone, 2, "התמלול נכשל או ריק. חוזר להקלטה.");
                responseBuilder = new YemotBuilder("read")
                    .addText("לא הצלחנו להבין את ההקלטה אנא דברו ברור יותר ונסו שוב")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;
            }

            RequestLogger.info(ApiCallId, ApiPhone, 2, `טקסט שפוענח: ${transcribedText}`);
            // שמירת הטקסט לתיקייה זמנית לקריאה בשלבים הבאים
            await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

            // תפריט מגדר: מקריאים באמצעות ה-TTS של ימות
            responseBuilder = new YemotBuilder("read")
                .addText("הטקסט נותח ונקלט בהצלחה")
                .addText("לבחירת קול קריין גברי הקישו 1")
                .addText("לבחירת קול קריינית נשית הקישו 2")
                // קלט של ספרה אחת בלבד, ללא 'לאישור הקישו 1'
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false)
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // --------------------------------------------------------------------
        // שלב 3: הלקוח בחר מגדר - מקריאים לו את התפריט המפורט של שמות הקולות
        // --------------------------------------------------------------------
        case 3:
            const isMale = query.VoiceGender === "1";
            const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            
            responseBuilder = new YemotBuilder("read")
                .addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
            
            // עוברים על רשימת הקולות ומייצרים הקראה לכל קול (לדוגמה "אפס אחד לקול רציני")
            for (let i = 0; i < voices.length; i++) {
                const num = i + 1;
                let spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
            }
            responseBuilder.addText("ובסיום הקישו סולמית");

            // בחירת קול מצריכה 2 ספרות, כי יש עד 15 קולות בכל מגדר
            responseBuilder
                .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false, false)
                .addState("gender", isMale ? "MALE" : "FEMALE")
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // --------------------------------------------------------------------
        // שלב 4: הלקוח בחר את הקול - נעבור לבחירת "סגנון הקראה" (רגש / כוונה)
        // --------------------------------------------------------------------
        case 4:
            // שמירת האינדקס של הקול הנבחר בשמירה זמנית (State)
            const chosenVoiceIndex = parseInt(query.VoiceIndex, 10);
            
            responseBuilder = new YemotBuilder("read")
                .addText("מצוין כעת נבחר את סגנון ההקראה וטון הדיבור");

            // הקראת תפריט הסגנונות הדינמי מתוך המערך SPEECH_STYLES
            SPEECH_STYLES.forEach(style => {
                responseBuilder.addText(`ל${style.name} הקישו ${style.id}`);
            });

            responseBuilder
                .setReadDigitsAdvanced("StyleIndex", 1, 1, 10, true, false, false, false)
                .addState("gender", query.gender)
                .addState("voiceIdx", chosenVoiceIndex.toString())
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // --------------------------------------------------------------------
        // שלב 5: נבחר סגנון. אם זה סגנון מותאם אישית נשלח להקלטה, אחרת נייצר TTS.
        // --------------------------------------------------------------------
        case 5:
            const styleIdx = parseInt(query.StyleIndex, 10);
            const selectedStyle = SPEECH_STYLES.find(s => s.id === styleIdx.toString());

            if (!selectedStyle) {
                // הקיש סגנון לא חוקי, נחזיר לשלב קודם
                responseBuilder = new YemotBuilder("go_to_folder").addText(".").addState("yemot_token", YEMOT_TOKEN);
                break;
            }

            if (selectedStyle.cue === "CUSTOM") {
                // המאזין בחר "סגנון מותאם אישית" (מקש 7). נפעיל הקלטה להנחיות במאי.
                RequestLogger.info(ApiCallId, ApiPhone, 5, "נבחר סגנון מותאם אישית. מבקש הקלטה.");
                responseBuilder = new YemotBuilder("read")
                    .addText("אנא הקליטו בקולכם את סגנון ההקראה הנדרש. למשל, הקרא זאת בקול בוכים או הקרא זאת בהתלהבות רבה. ולאחר מכן הקישו סולמית")
                    .setRecordInput("CustomStyleRecord", TEMP_FOLDER, `${ApiCallId}_style`)
                    .addState("gender", query.gender)
                    .addState("voiceIdx", query.voiceIdx)
                    .addState("yemot_token", YEMOT_TOKEN);
            } else {
                // נבחר סגנון קבוע (שמח, עצוב, וכו'). 
                // אנחנו מדלגים על שלב 6 וישר קוראים לפונקציה המייצרת את השמע.
                RequestLogger.info(ApiCallId, ApiPhone, 5, `נבחר סגנון קבוע: ${selectedStyle.name}`);
                responseBuilder = await processTTSGeneration(query, yemot, ApiCallId, ApiPhone, YEMOT_TOKEN, selectedStyle.cue);
            }
            break;

        // --------------------------------------------------------------------
        // שלב 6: הלקוח הקליט סגנון מותאם אישית. יש לתמלל אותו ואז לייצר TTS.
        // --------------------------------------------------------------------
        case 6:
            RequestLogger.info(ApiCallId, ApiPhone, 6, "מתחיל תמלול לסגנון המותאם אישית");
            const styleRecordPath = `${TEMP_FOLDER}/${ApiCallId}_style.wav`;
            const styleAudioBuffer = await yemot.downloadFile(`ivr2:${styleRecordPath}`);
            
            let customStyleText = await gemini.transcribeAudio(styleAudioBuffer, "gemini-3.1-flash-lite-preview");
            
            // במידה ולא הבנו, נשתמש בברירת מחדל כדי לא לתקוע את הלקוח
            if (!customStyleText || customStyleText.length < 2) {
                RequestLogger.warn(ApiCallId, ApiPhone, 6, "תמלול סגנון נכשל. ממשיך ללא הנחיה מיוחדת.");
                customStyleText = "";
            } else {
                // עוטף את הנחיית המשתמש בסוגריים מרובעים כהנחיית במאי באנגלית כדי שהמודל לא יקריא אותה אלא יציית לה
                customStyleText = `[Speak according to these instructions: ${customStyleText}] `;
            }

            // קוראים לפונקציית ייצור ה-TTS עם הסגנון המותאם אישית
            responseBuilder = await processTTSGeneration(query, yemot, ApiCallId, ApiPhone, YEMOT_TOKEN, customStyleText);
            break;

        // --------------------------------------------------------------------
        // שלב 7: הלקוח התבקש (מתוך פונקציית העזר) להקיש נתיב לשמירת הקובץ. 
        // --------------------------------------------------------------------
        case 7:
            const rawInputFolder = query.TargetFolderDefault;
            if (rawInputFolder === undefined) { 
                // ניתוק או יציאה
                responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                break; 
            }

            const cleanTargetFolder = sanitizeFolderPath(rawInputFolder);
            RequestLogger.info(ApiCallId, ApiPhone, 7, `שמירה מבוקשת לנתיב: ${cleanTargetFolder || 'שורש'}`);

            // הורדת ה-TTS שהופק מג'מיני (מתיקייה זמנית) והעברתו לתיקייה הקבועה
            const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
            const seqFileName = await yemot.getNextSequenceFileName(cleanTargetFolder || "/");
            const uploadPath = cleanTargetFolder ? `ivr2:/${cleanTargetFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
            
            await yemot.uploadFile(uploadPath, ttsForSave);

            // שואל האם לשמור את השלוחה כברירת מחדל לעתיד
            responseBuilder = new YemotBuilder("read")
                .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                .addText("האם תרצו לשמור את השלוחה שהקשתם כשלוחת ברירת המחדל שלכם להקלטות הבאות")
                .addText("לאישור הקישו 1, לביטול הקישו 2")
                // AskNo=true מופעל
                // שנה את השורה הזו:
                .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10) // מינימום 1, מקסימום 1
                .addState("savedFolder", cleanTargetFolder)
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // --------------------------------------------------------------------
        // שלב 8: שלב ביניים למי שיש לו כבר ברירת מחדל - האם לשמור עותק נוסף?
        // --------------------------------------------------------------------
        // תיקון שלב 8 (הקשת שלוחה לשמירה)
case 8:
    const cleanFolder = query.targetFolder ? query.targetFolder.replace(/[\/\\*]/g, '*') : "";
    if (!cleanFolder) {
        responseBuilder = new YemotBuilder("read")
            .addText("לא הוקשה שלוחה תקינה אנא הקישו את מספר השלוחה ובסיום סולמית")
            .setReadConfig("targetFolder", "Digits", 1, 10, 10) // מינימום 1, מקסימום 10
            .addState("state", 8);
    } else {
        // כאן מתבצע הטיפול בשמירה (הקוד הקיים שלך...)
        // ... ודא שבמעבר לשלב 9 אתה משתמש בזה:
        responseBuilder = new YemotBuilder("read")
            .addText("האם תרצו להגדיר שלוחה זו כברירת מחדל לאישור הקישו אחת לסיום הקישו שתיים")
            .setReadConfig("SetDefaultChoice", "Digits", 1, 1, 10) // שיניתי למינימום 1!
            .addState("state", 9)
            .addState("targetFolder", cleanFolder);
    }
    break;

// תיקון שלב 9 (בדיקת בחירה)
case 9:
    // שינוי הבדיקה מ-"01" ל-"1"
    if (query.SetDefaultChoice === "1" && query.targetFolder) {
        await yemot.uploadTextFile(`ivr2:/Preferences/${ApiPhone}.txt`, query.targetFolder.replace(/\*/g, "/"));
        responseBuilder = new YemotBuilder("id_list_message").addText("שלוחת ברירת המחדל עודכנה בהצלחה תודה ולהתראות");
    } else {
        responseBuilder = new YemotBuilder("id_list_message").addText("תודה ולהתראות");
    }
    yemotRes = responseBuilder.build() + "&go_to_folder=/";
    break;

            const cleanCopyFolder = sanitizeFolderPath(rawCopyFolder);
            const ttsForCopy = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
            const seqCopyName = await yemot.getNextSequenceFileName(cleanCopyFolder || "/");
            const copyUploadPath = cleanCopyFolder ? `ivr2:/${cleanCopyFolder}/${seqCopyName}.wav` : `ivr2:/${seqCopyName}.wav`;
            
            await yemot.uploadFile(copyUploadPath, ttsForCopy);

            responseBuilder = new YemotBuilder("id_list_message")
                .addText(`העותק נשמר בהצלחה כקובץ מספר ${seqCopyName}. תודה ולהתראות`)
                .addGoToFolder("/");
            break;

        // --------------------------------------------------------------------
        // שלב 10: שמירת העדפת שלוחת ברירת מחדל למאזין וסיום.
        // --------------------------------------------------------------------
        case 10:
            if (query.SetDefaultChoice === "1" && query.savedFolder !== undefined) {
                const userPrefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                // שומרים קובץ טקסט עם מספר הטלפון בתיקיית Preferences
                await yemot.uploadTextFile(userPrefPath, query.savedFolder);
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("שלוחת ברירת המחדל עודכנה בהצלחה. תודה ולהתראות")
                    .addGoToFolder("/");
            } else {
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("תודה ולהתראות")
                    .addGoToFolder("/");
            }
            break;

        default:
            responseBuilder = new YemotBuilder("go_to_folder").addText("/");
    }

    return responseBuilder ? responseBuilder.build() : "";
}

// ============================================================================
// 6. הפקת ה-TTS הראשי (פונקציה עזר כבדה המשותפת לשלבים 5 ו-6)
// ============================================================================
/**
 * מטפלת במשיכת הטקסט המקורי, חיבור עם הנחיית הסגנון, הפקת האודיו מג'מיני,
 * ושמירתו. לאחר מכן קובעת האם לשמור לברירת מחדל או לבקש נתיב שמירה.
 */
async function processTTSGeneration(query, yemot, ApiCallId, ApiPhone, YEMOT_TOKEN, styleInstructionText) {
    RequestLogger.info(ApiCallId, ApiPhone, "TTS", "מתחיל תהליך עיבוד TTS מול ג'מיני");
    
    // משיכת הקול הנבחר
    const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
    let voiceIdx = parseInt(query.voiceIdx, 10);
    if (isNaN(voiceIdx) || voiceIdx < 1 || voiceIdx > voiceList.length) voiceIdx = 1;
    const selectedVoiceId = voiceList[voiceIdx - 1].id;

    // קריאת הטקסט שתומלל בשלב 1
    const rawText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
    if (!rawText) throw new Error("קובץ הטקסט הראשי חסר");

    // "סוד קסם": ג'מיני מתייחס לטקסט המוקף בסוגריים מרובעים כאל הנחיית במאי (Audio Tag / Prompt) 
    // ולא מקריא אותו בקול רם, אלא מאמץ את הגישה הרגשית שלו!
    const textToSpeak = `${styleInstructionText}${rawText}`;

    // הפקת ה-TTS (קריאת API לגוגל והמרת PCM ל-WAV)
    const ttsBuffer = await gemini.generateTTS(textToSpeak, selectedVoiceId);
    
    // שמירה זמנית כדי שהלקוח ישמע מיד
    const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
    await yemot.uploadFile(ttsTempPath, ttsBuffer);

    // בדיקת היסטוריית מועדפים של הלקוח
    const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
    const defaultFolder = await yemot.getTextFile(prefPath);

    let builder = new YemotBuilder("read");

    if (defaultFolder && defaultFolder.trim().length > 0) {
        // יש מועדף! שומרים ישירות לשלוחת ברירת המחדל
        const folder = defaultFolder.trim();
        const nextFileNum = await yemot.getNextSequenceFileName(folder);
        const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
        
        await yemot.uploadFile(finalPath, ttsBuffer);

        builder
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // השמעת התוצר
            .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
            .addText("האם לשמור עותק נוסף בשלוחה אחרת. לאישור הקישו 1, לביטול וחזרה לתפריט הראשי הקישו 2")
            .setReadDigitsAdvanced("WantCopySave", 1, 1, 15, true, false, false, false)
            .addState("yemot_token", YEMOT_TOKEN);
    } else {
        // אין מועדף. נשמיע את התוצר ונבקש נתיב לשמירה.
        builder
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // השמעת התוצר
            .addText("הקובץ הושמע בהצלחה")
            .addText("כעת נא הקישו את מספר השלוחה לשמירה. למעבר בין שלוחות פנימיות הקישו כוכבית, ובסיום הקישו סולמית")
            .addText("לשמירה בתיקייה הראשית, הקישו אפס וסולמית")
            // מאפשרים הקשת *, מאפשרים 0, וממירים כוכבית לסלש (autoReplaceAsteriskWithSlash=true)
            .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true, true)
            .addState("yemot_token", YEMOT_TOKEN);
    }

    return builder;
}

// ============================================================================
// 7. נקודת הקצה והייצוא (Express / Serverless Function Export)
// ============================================================================

module.exports = async (req, res) => {
    // אתחול מחרוזת התשובה
    let yemotFinalResponse = "";
    
    try {
        // איחוד פרמטרים בין GET ל-POST לטובת גמישות
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        const ApiPhone = query.ApiPhone || "Unknown";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        if (!YEMOT_TOKEN) {
            RequestLogger.error(ApiCallId, ApiPhone, "INIT", "חסר YEMOT_TOKEN");
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("id_list_message=t-חסר_טוקן_מערכת_בהגדרות_השלוחה&hangup=yes");
        }

        // במקרה של ניתוק פתאומי מצד המאזין, אין טעם להמשיך להריץ לוגיקה
        if (query.hangup === "yes") {
            RequestLogger.info(ApiCallId, ApiPhone, "HANGUP", "הלקוח ניתק את השיחה מיוזמתו");
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        // יצירת מופע ימות המשיח עם הטוקן שהתקבל
        const yemot = new YemotManager(YEMOT_TOKEN);

        // הפעלת פונקציית הלוגיקה והמצבים (State Machine) שתחזיר לנו את מחרוזת ה-API הנדרשת
        yemotFinalResponse = await handleIvrFlow(query, yemot, ApiPhone, ApiCallId, YEMOT_TOKEN);

        // שליחת התשובה בחזרה לשרתי ימות המשיח (חובה להחזיר Text Plain בקידוד UTF-8)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        // השרת לעולם לא קורס! במקרה של שגיאה בלתי צפויה, נחזיר הודעה מסודרת למאזין וננתק.
        console.error(`[CRITICAL CATCH]`, error);
        
        const safeError = new YemotBuilder("id_list_message")
            .addText("אירעה שגיאה קריטית במערכת. אנו מתנצלים על התקלה. נא נסו שוב מאוחר יותר")
            .addGoToFolder("/")
            .build();
            
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(safeError);
    }
};
