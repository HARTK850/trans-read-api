/**
 * @file api/index.js
 * @version 6.0.0 (Ultimate Enterprise Edition)
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR מבוססת Gemini וימות המשיח.
 * קובץ זה מכיל את ליבת הלוגיקה העסקית, ניהול המצבים (State Machine), ניתוב השיחות, והרכבת התפריטים.
 * * פיצ'רים בגרסה זו:
 * 1. הקראת כל התפריטים בקול הרובוטי של ימות המשיח (t-טקסט).
 * 2. בנייה חסינה של פקודת `read` המכילה תמיד את 15 הפרמטרים במדויק.
 * 3. השתקת בקשות האישור ("לאישור הקישו 1") באמצעות AskNo בפרמטר ה-15.
 * 4. תמיכה מלאה בהקשת שלוחות פנימיות (כגון 1*2*3 המומר ל- 1/2/3).
 * 5. מינימום ספרות הוגדר ל-1 בכל התפריטים כדי למנוע את שגיאת "לא הקשתם מינימום ספרות".
 * 6. ניהול שלבים (Step Routing) מדויק באמצעות משתנה ייעודי העובר בסבבים (api_add_X=step=Y).
 * 7. טיפול שגיאות אבסולוטי ולוגים ברמת שרת.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות סביבה (Environment Variables) וקונפיגורציה
// ============================================================================

// חלוקת מפתחות גוגל למניעת חסימת Rate Limit
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_API_KEY_HERE"];

// מנהל בינה מלאכותית
const gemini = new GeminiManager(GEMINI_API_KEYS);

// התיקייה בה יישמרו הקבצים הזמניים (לפני ניתוב סופי על ידי המאזין)
const TEMP_FOLDER = "/Temp_Gemini_App";

// רשימת סגנונות ההקראה. כל סגנון מתורגם להנחיית טון דיבור באנגלית לג'מיני.
// ההנחיות עטופות בסוגריים מרובעים כדי שג'מיני לא יקריא אותן בקול!
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
// מחלקת ניהול הלוגים - RequestLogger
// ============================================================================
class RequestLogger {
    static info(callId, phone, step, message) {
        console.log(`[INFO] [Call: ${callId}] [Phone: ${phone}] [Step: ${step}] => ${message}`);
    }

    static warn(callId, phone, step, message) {
        console.warn(`[WARN] [Call: ${callId}] [Phone: ${phone}] [Step: ${step}] => ${message}`);
    }

    static error(callId, phone, step, message, err = null) {
        console.error(`[ERROR] [Call: ${callId}] [Phone: ${phone}] [Step: ${step}] => ${message}`);
        if (err) console.error(err);
    }
}

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות ימות המשיח (YemotBuilder)
// ============================================================================
/**
 * מחלקה זו מונעת שגיאות תחביר מול ה-API של ימות המשיח.
 * היא דואגת לאחד טקסטים, לנקות תווים מסוכנים, ולהרכיב פקודות מדויקות
 * עם המספר הנכון של פרמטרים ומפרידים (סימן שווה ופסיקים).
 */
class YemotBuilder {
    constructor(action) {
        this.action = action; // 'read', 'id_list_message', 'go_to_folder'
        this.contentBlocks = []; // הבלוקים שיקריא (קבצים או tts מובנה)
        this.params = []; // 15 הפרמטרים של פקודת read
        this.nextState = {}; // משתנים שחוזרים לימות וישובו אלינו בבקשה הבאה
        this.goToFolder = null; // ניתוב סופי 
    }

    /**
     * ניקוי טקסט עבור ה-TTS של ימות המשיח. 
     * ממיר רווחים לקו תחתון ומוחק כל תו שעלול לשבור את המחרוזת.
     */
    _cleanYemotTTS(text) {
        if (!text) return "";
        return text.toString()
            .replace(/[=,&?^#*.!]/g, "") // תווים שאסורים ב-API
            .replace(/-/g, "") // מחיקת מקפים
            .replace(/\s+/g, "_"); // ימות המשיח משתמשת בקו תחתון כרווח
    }

    /**
     * הוספת הקראת טקסט מובנית בימות המשיח (t-Text).
     */
    addText(text) {
        const cleanStr = this._cleanYemotTTS(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    /**
     * הוספת השמעת קובץ קיים.
     */
    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    /**
     * הגדרת קלט (הקשת מקשים) עם פרמטרים מתקדמים למניעת אישורים וחסימות.
     * מכיל בדיוק 15 ערכים על פי דרישות ימות המשיח.
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowAsterisk = false, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        const playType = disableConfirmation ? "No" : "Digits";
        const blockAsterisk = allowAsterisk ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes";
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";
        const askConfirm = disableConfirmation ? "no" : "";

        this.params = [
            varName,               // 1. משתנה לשמירה
            "no",                  // 2. שימוש בקיים (לא)
            "Digits",              // 3. סוג קלט
            maxDigits.toString(),  // 4. מקסימום ספרות
            minDigits.toString(),  // 5. מינימום ספרות (לרוב 1)
            playType,              // 6. צורת השמעה 
            blockAsterisk,         // 7. חסימת כוכבית
            blockZero,             // 8. חסימת אפס
            replaceChar,           // 9. החלפת תווים
            "",                    // 10. מקשים מורשים (ריק=הכל)
            "",                    // 11. ניסיונות הקשה (ריק=5)
            "",                    // 12. זמן המתנה
            "",                    // 13. טקסט אם ריק
            "",                    // 14. סוג מקלדת
            askConfirm             // 15. לאישור הקישו 1 (no=מושבת)
        ];

        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה קולית, עם התפריט הסטנדרטי של ימות המשיח.
     */
    setRecordInput(varName, folder, fileName) {
        this.params = [
            varName,   // 1. משתנה
            "no",      // 2. להשתמש בקיים
            "record",  // 3. סוג קלט
            folder,    // 4. תיקייה
            fileName,  // 5. שם קובץ
            "no",      // 6. אישור מיידי? "no" מפעיל את תפריט 1 לשמיעה, 2 לאישור
            "yes",     // 7. שמירה בניתוק
            "no",      // 8. שרשור לקיים
            "1",       // 9. אורך מינימלי (שניות)
            "600"      // 10. אורך מקסימלי
        ];
        return this;
    }

    /**
     * שמירת משתני זרימה (State) לסבב הבא של ה-API.
     */
    addState(key, value) {
        if (value !== undefined && value !== null) {
            this.nextState[key] = value;
        }
        return this;
    }

    /**
     * הוראה לימות המשיח לעבור לשלוחה אחרת.
     */
    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /**
     * בונה את מחרוזת ה-API הסופית התקנית של ימות המשיח.
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

        let i = 0;
        for (const [key, value] of Object.entries(this.nextState)) {
            res += `&api_add_${i}=${key}=${encodeURIComponent(value)}`;
            i++;
        }

        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// פונקציות עזר (Helpers)
// ============================================================================

/**
 * מנקה נתיב שלוחה שהתקבל מהמאזין ומכין אותו לשמירה בטוחה.
 */
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; // "0" מסמל שמירה בתיקייה הראשית
    return rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

// ============================================================================
// פונקציה ראשית: הפקת האודיו (TTS Generation Module)
// פונקציה זו משותפת למספר שלבים ולכן הופרדה.
// ============================================================================
async function processAndGenerateTTS(query, yemot, ApiCallId, ApiPhone, YEMOT_TOKEN, styleInstructionText) {
    RequestLogger.info(ApiCallId, ApiPhone, "TTS_GEN", "מתחיל תהליך עיבוד TTS מול ג'מיני");
    
    // קביעת הקול שנבחר
    const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
    let voiceIdx = parseInt(query.voiceIdx, 10);
    if (isNaN(voiceIdx) || voiceIdx < 1 || voiceIdx > voiceList.length) voiceIdx = 1;
    const selectedVoiceId = voiceList[voiceIdx - 1].id;

    // משיכת טקסט המקור מהתיקייה הזמנית בימות
    const rawText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
    if (!rawText) throw new Error("קובץ הטקסט הראשי חסר בתיקייה הזמנית");

    // הרכבת הנחיית הבמאי (בסוגריים מרובעים) עם הטקסט בעברית
    const textToSpeak = `${styleInstructionText}${rawText}`;

    // בקשת ה-TTS מ-Gemini API
    const ttsBuffer = await gemini.generateTTS(textToSpeak, selectedVoiceId);
    
    // שמירת תוצר ה-TTS באופן זמני כדי שהמאזין ישמע מיד
    const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
    await yemot.uploadFile(ttsTempPath, ttsBuffer);

    // בדיקה במסד הנתונים האם קיימת שלוחת ברירת מחדל שמורה ללקוח זה
    const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
    const defaultFolder = await yemot.getTextFile(prefPath);

    let builder = new YemotBuilder("read");

    if (defaultFolder && defaultFolder.trim().length > 0) {
        // המאזין הגדיר בעבר מועדפים! שומרים ישירות לשם.
        const folder = defaultFolder.trim();
        const nextFileNum = await yemot.getNextSequenceFileName(folder);
        const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
        
        await yemot.uploadFile(finalPath, ttsBuffer);

        builder
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
            .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
            .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה לתפריט הראשי הקישו 2")
            // מקסימום 1, מינימום 1 (כדי למנוע שגיאת מינימום)
            .setReadDigitsAdvanced("WantCopySave", 1, 1, 15, true, false, false, false)
            .addState("step", "8") // הולך לשלב 8
            .addState("yemot_token", YEMOT_TOKEN);
    } else {
        // למאזין אין מועדפים, נשאל אותו איפה הוא רוצה לשמור.
        builder
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
            .addText("הקובץ הושמע בהצלחה. כעת נעבור לשמירת הקובץ במערכת")
            .addText("נא הקישו את מספר השלוחה לשמירה. למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
            .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
            // מקסימום 20, מינימום 1, מתיר כוכבית, מתיר אפס, מחליף כוכבית בסלש.
            .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true, true)
            .addState("step", "7") // הולך לשלב 7
            .addState("yemot_token", YEMOT_TOKEN);
    }

    return builder;
}

// ============================================================================
// פונקציית בקרת הזרימה המרכזית (Main State Machine)
// ============================================================================
async function handleIvrFlow(query, yemot, ApiPhone, ApiCallId, YEMOT_TOKEN) {
    let responseBuilder = null;

    // שליפת השלב (step) שהעברנו לעצמנו בסבב הקודם (דרך addState). אם אין, זה שלב 1.
    const step = parseInt(query.step || "1", 10);
    RequestLogger.info(ApiCallId, ApiPhone, step, "מנתח בקשה נכנסת");

    switch (step) {
        
        // ====================================================================
        // שלב 1: פתיח המערכת והקלטת הודעה
        // ====================================================================
        case 1:
            responseBuilder = new YemotBuilder("read")
                .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                .addState("step", "2")
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 2: תמלול (STT) ובחירת מגדר
        // ====================================================================
        case 2:
            RequestLogger.info(ApiCallId, ApiPhone, 2, "מתחיל תמלול ההקלטה הראשי");
            const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
            const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
            
            const transcribedText = await gemini.transcribeAudio(mainAudioBuffer, "gemini-3.1-flash-lite-preview");
            
            if (!transcribedText || transcribedText.length < 2) {
                RequestLogger.warn(ApiCallId, ApiPhone, 2, "תמלול נכשל או ריק");
                responseBuilder = new YemotBuilder("read")
                    .addText("לא הצלחנו להבין את ההקלטה. אנא דברו ברור יותר ונסו שוב")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                    .addState("step", "2") // נשארים באותו שלב
                    .addState("yemot_token", YEMOT_TOKEN);
                break;
            }

            // שמירת הטקסט
            await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

            responseBuilder = new YemotBuilder("read")
                .addText("הטקסט נותח ונקלט בהצלחה. לבחירת קול קריין גברי הקישו 1, לבחירת קול קריינית נשית הקישו 2")
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false) 
                .addState("step", "3")
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 3: בחירת קול מהרשימה
        // ====================================================================
        case 3:
            const isMale = query.VoiceGender === "1";
            const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            
            responseBuilder = new YemotBuilder("read")
                .addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
            
            for (let i = 0; i < voices.length; i++) {
                const num = i + 1;
                responseBuilder.addText(`ל${voices[i].desc} הקישו ${num}`);
            }
            responseBuilder.addText("ובסיום הקישו סולמית");

            // מקסימום 2 ספרות (יש 15 קולות), מינימום 1 (כדי למנוע שגיאת לא הקשתם מינימום)
            responseBuilder
                .setReadDigitsAdvanced("VoiceIndex", 2, 1, 15, true, false, false, false)
                .addState("gender", isMale ? "MALE" : "FEMALE")
                .addState("step", "4")
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 4: בחירת סגנון הקראה (טון דיבור)
        // ====================================================================
        case 4:
            // שומרים את הקול שנבחר
            const chosenVoiceIndex = parseInt(query.VoiceIndex || "1", 10);
            
            responseBuilder = new YemotBuilder("read")
                .addText("מצוין. כעת נבחר את סגנון ההקראה וטון הדיבור");

            SPEECH_STYLES.forEach(style => {
                responseBuilder.addText(`ל${style.name} הקישו ${style.id}`);
            });

            responseBuilder
                .setReadDigitsAdvanced("StyleIndex", 1, 1, 10, true, false, false, false)
                .addState("gender", query.gender)
                .addState("voiceIdx", chosenVoiceIndex.toString())
                .addState("step", "5")
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 5: ניתוח סגנון ההקראה - הקלטת מותאם אישית או עיבוד TTS מיידי
        // ====================================================================
        case 5:
            const styleIdx = parseInt(query.StyleIndex || "1", 10);
            const selectedStyle = SPEECH_STYLES.find(s => s.id === styleIdx.toString()) || SPEECH_STYLES[0];

            if (selectedStyle.cue === "CUSTOM") {
                RequestLogger.info(ApiCallId, ApiPhone, 5, "המשתמש רוצה סגנון בהקלטה מותאמת אישית.");
                responseBuilder = new YemotBuilder("read")
                    .addText("אנא הקליטו בקולכם את סגנון ההקראה הנדרש. למשל, הקרא זאת בקול בוכים או הקרא זאת בהתלהבות רבה. ולאחר מכן הקישו סולמית")
                    .setRecordInput("CustomStyleRecord", TEMP_FOLDER, `${ApiCallId}_style`)
                    .addState("gender", query.gender)
                    .addState("voiceIdx", query.voiceIdx)
                    .addState("step", "6")
                    .addState("yemot_token", YEMOT_TOKEN);
            } else {
                RequestLogger.info(ApiCallId, ApiPhone, 5, `נבחר סגנון קבוע: ${selectedStyle.name}`);
                // מפעיל פונקציה ליצירת ה-TTS שגם קובעת לאן המאזין עובר הלאה
                responseBuilder = await processAndGenerateTTS(query, yemot, ApiCallId, ApiPhone, YEMOT_TOKEN, selectedStyle.cue);
            }
            break;

        // ====================================================================
        // שלב 6: תמלול סגנון ההקראה המותאם אישית ויצירת ה-TTS
        // ====================================================================
        case 6:
            RequestLogger.info(ApiCallId, ApiPhone, 6, "תמלול הוראות במאי מותאמות אישית");
            const styleRecordPath = `${TEMP_FOLDER}/${ApiCallId}_style.wav`;
            const styleAudioBuffer = await yemot.downloadFile(`ivr2:${styleRecordPath}`);
            
            let customStyleText = await gemini.transcribeAudio(styleAudioBuffer, "gemini-3.1-flash-lite-preview");
            
            if (!customStyleText || customStyleText.length < 2) {
                customStyleText = ""; // כשלו בתמלול
            } else {
                customStyleText = `[Speak according to these instructions: ${customStyleText}] `;
            }

            responseBuilder = await processAndGenerateTTS(query, yemot, ApiCallId, ApiPhone, YEMOT_TOKEN, customStyleText);
            break;

        // ====================================================================
        // שלב 7: הלקוח הקיש נתיב לשמירת הקובץ. שומרים, ושואלים על ברירת מחדל.
        // ====================================================================
        case 7:
            const rawTarget = query.TargetFolderDefault;
            if (rawTarget === undefined) { 
                responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                break; 
            }

            const cleanTarget = cleanAndSanitizeFolder(rawTarget);
            const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
            const seqFileName = await yemot.getNextSequenceFileName(cleanTarget || "/");
            const uploadPath = cleanTarget ? `ivr2:/${cleanTarget}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
            
            await yemot.uploadFile(uploadPath, ttsForSave);

            responseBuilder = new YemotBuilder("read")
                .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}.`)
                .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו 1, לסיום הקישו 2.")
                // מינימום 1
                .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false, false)
                .addState("savedFolder", cleanTarget)
                .addState("step", "10")
                .addState("yemot_token", YEMOT_TOKEN);
            break;

        // ====================================================================
        // שלב 8: הלקוח עם המועדפים נשאל האם הוא רוצה לשמור עותק. 
        // ====================================================================
        case 8:
            if (query.WantCopySave === "1") {
                responseBuilder = new YemotBuilder("read")
                    .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית.")
                    .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית.")
                    // מתיר כוכביות ואפס
                    .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, true, true, true)
                    .addState("step", "9")
                    .addState("yemot_token", YEMOT_TOKEN);
            } else {
                responseBuilder = new YemotBuilder("go_to_folder").addText("/");
            }
            break;

        // ====================================================================
        // שלב 9: שמירת העותק הנוסף וחזרה לתפריט ראשי.
        // ====================================================================
        case 9:
            const rawCopy = query.TargetFolderCopy;
            if (rawCopy === undefined) { 
                responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                break; 
            }

            const cleanCopy = cleanAndSanitizeFolder(rawCopy);
            const ttsForCopy = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
            const copyFileName = await yemot.getNextSequenceFileName(cleanCopy || "/");
            const copyUploadPath = cleanCopy ? `ivr2:/${cleanCopy}/${copyFileName}.wav` : `ivr2:/${copyFileName}.wav`;
            
            await yemot.uploadFile(copyUploadPath, ttsForCopy);

            responseBuilder = new YemotBuilder("id_list_message")
                .addText(`העותק נשמר בהצלחה כקובץ מספר ${copyFileName}. תודה ולהתראות.`)
                .addGoToFolder("/");
            break;

        // ====================================================================
        // שלב 10: שמירת העדפת מועדפים למאזין וסיום.
        // ====================================================================
        case 10:
            if (query.SetDefaultChoice === "1" && query.savedFolder !== undefined) {
                const prefPathTxt = `ivr2:/Preferences/${ApiPhone}.txt`;
                await yemot.uploadTextFile(prefPathTxt, query.savedFolder);
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("שלוחת ברירת המחדל עודכנה בהצלחה. תודה ולהתראות.")
                    .addGoToFolder("/");
            } else {
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("תודה ולהתראות.")
                    .addGoToFolder("/");
            }
            break;

        default:
            responseBuilder = new YemotBuilder("go_to_folder").addText("/");
    }

    return responseBuilder ? responseBuilder.build() : "";
}

// ============================================================================
// פונקציית הייצוא הסופית (Express Endpoint)
// ============================================================================

module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        const ApiPhone = query.ApiPhone || "Unknown";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        if (!YEMOT_TOKEN) {
            RequestLogger.error(ApiCallId, ApiPhone, "INIT", "חסר YEMOT_TOKEN");
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("id_list_message=t-חסר_טוקן_מערכת_בהגדרות_השלוחה&hangup=yes");
        }

        // במקרה של ניתוק יזום של המאזין, שרת לא מתאמץ סתם.
        if (query.hangup === "yes") {
            RequestLogger.info(ApiCallId, ApiPhone, "HANGUP", "המאזין ניתק");
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        
        // הרצת מכונת המצבים (State Machine) וקבלת פקודת ימות המשיח המדויקת
        yemotFinalResponse = await handleIvrFlow(query, yemot, ApiPhone, ApiCallId, YEMOT_TOKEN);

        // החזרת המחרוזת כ- Plain Text (דרישת חובה של ה-API בימות)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        console.error(`[IVR Critical Catch]`, error);
        
        const safeError = new YemotBuilder("id_list_message")
            .addText("אירעה שגיאה קריטית במערכת. אנו מתנצלים על התקלה.")
            .addGoToFolder("/")
            .build();
            
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(safeError);
    }
};
