/**
 * @file api/index.js
 * @version 15.0.0 (Ultimate Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * 
 * פיצ'רים מרכזיים בגרסה זו (המענה המושלם לדרישות):
 * 1. השמדת ה-"לאישור הקישו 1" באופן מוחלט דרך שליטה מלאה ב-15 הפרמטרים של פקודת read (AskNo).
 * 2. תפריטים מותאמים (1/2 ספרות): בחירת קולות דורשת 01,02. כל שאר התפריטים (כן/לא) דורשים רק 1 או 2.
 * 3. תפריט הקלטה של ימות הוחזר למקור (לשמיעה 1, לאישור 2, מחדש 3...).
 * 4. ביטול תפריט רגש: ה-AI מזהה רגש לבד ושותל סוגריים בתמלול.
 * 5. השרת מעכב תגובה בזמן יצירת ה-TTS - מפעיל אוטומטית מוזיקת המתנה (ztomao) מימות המשיח.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות לתקן המחמיר של ימות המשיח (YemotBuilder)
// ============================================================================
class YemotBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks = []; 
        this.params =[]; 
        this.nextState = {}; 
        this.goToFolder = null; 
    }

    /**
     * ניקוי טקסט עברי מתווים שגורמים לימות המשיח לקרוס.
     * משאיר רווחים תקינים להקראה טבעית (ללא קווים תחתונים).
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
     * הגדרת קלט (Digits) בעזרת 15 הפרמטרים המלאים של ה-API של ימות המשיח.
     * הפתרון האולטימטיבי לחיסול הודעות האישור ("לאישור הקישו 1").
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        // "AskNo" בפרמטר השביעי (צורת השמעת הנתון) הוא סוד הקסם שמבטל את תפריט האישור!
        const playType = disableConfirmation ? "AskNo" : "Digits";
        
        const blockAsterisk = autoReplaceAsteriskWithSlash ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes"; 
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";

        this.params =[
            varName,               // 1. פרמטר
            "no",                  // 2. להשתמש בקיים
            "Digits",              // 3. סוג
            maxDigits.toString(),  // 4. מקסימום
            minDigits.toString(),  // 5. מינימום
            timeout.toString(),    // 6. זמן המתנה
            playType,              // 7. AskNo - מונע 'לאישור הקישו 1'
            blockAsterisk,         // 8. חסימת כוכבית
            blockZero,             // 9. חסימת אפס
            replaceChar,           // 10. החלפת תווים
            "",                    // 11. מקשים מורשים
            "",                    // 12. כמות פעמים
            "",                    // 13. המשך אם ריק
            "",                    // 14. מודל מקלדת
            "no"                   // 15. אישור הקשה (חובה no)
        ];
        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה (Record).
     * על ידי השארת הפרמטר השישי ריק, אנו מפעילים את תפריט ההקלטה *המקורי* של ימות.
     */
    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   // 1. שם המשתנה 
            "no",      // 2. להשתמש בקיים? לא
            "record",  // 3. סוג קלט (הקלטה קולית)
            folder,    // 4. תיקיית יעד בימות המשיח
            fileName,  // 5. שם קובץ
            "",        // 6. הפעלת תפריט אישור המקורי של ימות (1 שמיעה, 2 אישור וכו')
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. שרשור לקובץ קודם (no)
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
    return rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

function cleanupEmptyQueryVariables(query) {
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "TargetFolderDefault", "WantCopySave", "TargetFolderCopy", "SetDefaultChoice"];
    for (const key of keys) {
        if (query[key] === "") delete query[key];
    }
}

// ============================================================================
// הליבה: Serverless Request Handler & State Machine
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // הגנת ניתוק - למניעת לולאות (Loops) מול השרת של ימות המשיח
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
        
        // --- ניהול שלבים מבוסס הנתונים שנאספו (Stateless Machine) ---
        let state = 0;
        if (query.SetDefaultChoice !== undefined) state = 6;
        else if (query.TargetFolderCopy !== undefined) state = 55;
        else if (query.WantCopySave !== undefined) state = 4;
        else if (query.TargetFolderDefault !== undefined) state = 5; // שים לב לסדר
        else if (query.VoiceIndex !== undefined) state = 3;
        else if (query.VoiceGender !== undefined) state = 2;
        else if (query.UserAudioRecord !== undefined) state = 1;

        TelemetryLogger.info("FlowController", "StateDetection", `שלב: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            case 0:
                // ====================================================================
                // שלב 0: פתיח וקבלת הקלטה
                // מפעיל את תפריט ימות הסטנדרטי לאישור ההקלטה.
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 1:
                // ====================================================================
                // שלב 1: STT חכם עם הבנת טון + מעבר לבחירת גבר/אישה.
                // *חווית משתמש:* דורש ספרה 1 בלבד (1 או 2). ללא "לאישור הקישו 1".
                // ====================================================================
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                // ה-audioBuffer עובר עיבוד וניקוי רעשים (DSP) בתוך core.js ואז נשלח לג'מיני.
                // ג'מיני מנתח את טון הדיבור ומוסיף את ההערות בסוגריים לתמלול (למשל: '(בעצב)').
                const transcribedTextWithEmotion = await gemini.transcribeAudioWithEmotion(mainAudioBuffer);
                TelemetryLogger.info("MainHandler", "STT", `תומלל כולל רגש: ${transcribedTextWithEmotion}`);

                if (!transcribedTextWithEmotion || transcribedTextWithEmotion.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    break;
                }

                // שמירת הטקסט בקובץ (כולל ההוראות בסוגריים) כדי לשלוף בשלב ה-TTS
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedTextWithEmotion);

                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול של גבר הקישו 1")
                    .addText("לבחירת קול של אישה הקישו 2")
                    // max=1, min=1. "AskNo" מופעל. חסימת אפס מופעלת.
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false); 
                break;

            case 2:
                // ====================================================================
                // שלב 2: תפריט הקולות הייעודי. דורש 2 ספרות בדיוק (למשל 01).
                // *חווית משתמש:* מקריא "אפס אחד" כדי שהמאזין יבין שעליו להקיש 01. ללא אישור.
                // ====================================================================
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false); 
                    break;
                }

                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder("read").addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
                
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; // הקראת "אפס אחד"
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }
                
                // מקסימום 2, מינימום 2. AskNo מופעל. הלקוח מקיש "01" ועף ישר לשלב הבא!
                responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false, false);
                break;

            case 3:
                // ====================================================================
                // שלב 3: הלקוח בחר קול (למשל 05) - יצירת ה-TTS המיידי!
                // * מודל ה-TTS מקבל את הטקסט + סוגריים. הסגנון מיושם אוטומטית.
                // * השרת ממתין כמה שניות, ימות המשיח מנגנת את המוזיקה שמוגדרת ב-ext.ini.
                // ====================================================================
                const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                
                if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false, false);
                    break;
                }

                const selectedVoiceId = voiceListCheck[checkIdx].id;
                
                // משיכת הטקסט (הכולל את הנחיות הבמאי בסוגריים עגולים שג'מיני הכניס בשלב 1)
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // --- הפקת האודיו ---
                // פעולה זו נמשכת בממוצע 3-5 שניות. 
                // בזמן הזה, מכיוון שהשרת חושב ולא מחזיר תשובה מיידית, ימות תפעיל את המוזיקה שלך!
                // שים לב: בדוק שב-ext.ini כתוב בדיוק: api_wait_answer_music_on_hold=yes (עם ה-a בהתחלה!)
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

                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // משמיע את התוצאה המדהימה
                        .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
                        .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        // ספרה 1 בלבד (1 או 2), מתקדם מיד בלי "לאישור הקישו 1"
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false, false);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                        .addText("נא הקישו את מספר השלוחה לשמירה. למעבר בין שלוחות פנימיות הקישו כוכבית, ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        // מתיר אפס, מתיר כוכבית, ממיר כוכבית לסלש.
                        .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, false, true, true);
                }
                break;

            case 4:
                // ====================================================================
                // שלב 4: (ללקוח וותיק) הלקוח נשאל האם הוא מעוניין בעותק נוסף
                // ====================================================================
                if (query.WantCopySave === "1") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, false, true, true);
                } else if (query.WantCopySave === "2") {
                    responseBuilder = new YemotBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית לאישור הקישו 1 לביטול הקישו 2")
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false, false);
                }
                break;

            case 5:  // שמירה רגילה
            case 55: // שמירת עותק
                // ====================================================================
                // שלב 5 + 55: תיוק הקובץ בשלוחת היעד (תמיכה בשורש "0")
                // ====================================================================
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                
                if (targetFolder === undefined) { 
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                    break; 
                }
                
                // הלקוח הקיש '0' למרות שזה לא חוקי טכנית בימות כדי לסמן את השורש
                if (targetFolder === "0") {
                    targetFolder = "";
                }
                
                const cleanFolder = cleanAndSanitizeFolder(targetFolder); 
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder || "/");
                
                const uploadPath = cleanFolder ? `ivr2:/${cleanFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
                await yemot.uploadFile(uploadPath, ttsForSave);

                if (state === 55) { 
                    // עותק נוסף - מסיים וחוזר לשורש
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText(`העותק נשמר בהצלחה כקובץ מספר ${seqFileName} תודה ולהתראות`)
                        .addGoToFolder("/"); 
                } else { 
                    // פעם ראשונה ששומר - מציעים להפוך לברירת מחדל (1 או 2)
                    responseBuilder = new YemotBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו 1 לסיום הקישו 2")
                        .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false, false) 
                        .addState("targetFolder", cleanFolder);
                }
                break;

            case 6:
                // ====================================================================
                // שלב 6: עדכון מועדפים במסד הנתונים של ימות (קבצי txt) ופרידה
                // ====================================================================
                if (query.SetDefaultChoice === "1" && query.targetFolder !== undefined) {
                    await yemot.uploadTextFile(`ivr2:/Preferences/${ApiPhone}.txt`, query.targetFolder.replace(/\*/g, "/"));
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText("שלוחת ברירת המחדל עודכנה בהצלחה תודה ולהתראות")
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
        TelemetryLogger.error("MainHandler", "Exception", "אירעה שגיאה קריטית בקוד", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה קריטית במערכת אנו מתנצלים&go_to_folder=/");
    }
};
