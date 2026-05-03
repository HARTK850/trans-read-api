/**
 * @file api/index.js
 * @version 11.0.0 (Ultimate Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * 
 * פיצ'רים בגרסה זו:
 * 1. "AskNo" מיושם באופן הרמטי בעזרת 15 הפרמטרים, מבטל לחלוטין "לאישור הקישו 1".
 * 2. תפריט גבר/אישה (1/2), עותק נוסף (1/2) וברירת מחדל דורשים ספרה אחת בלבד ומזנקים הלאה!
 * 3. תפריט בחירת הקולות (15 קולות) דורש בדיוק 2 ספרות (01, 02 וכו').
 * 4. התפריט המקורי של ימות המשיח לאחר הקלטה ("לשמיעה 1, לאישור 2...") הוחזר לתפקוד.
 * 5. ה-AI מנתח את טון הדיבור לבד, ללא תפריט סגנונות מעיק.
 * 6. השרת מושהה בכוונה בעת הפקת ה-TTS כדי לעורר אוטומטית את המוזיקה בהמתנה (ztomao) של ימות!
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :["YOUR_DEFAULT_API_KEY_HERE"];

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
     * מנקה את הטקסט מתווים שגורמים לימות המשיח לשתוק או לקרוס.
     * משאיר רווחים תקינים כדי שההקראה תהיה טבעית.
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
     * הפתרון האולטימטיבי לחיסול הודעות האישור של ימות המשיח!
     * 
     * @param {string} varName - שם המשתנה לאיסוף בבקשה הבאה
     * @param {number} maxDigits - כמות מקסימלית של ספרות (אם ריק = ללא הגבלה)
     * @param {number} minDigits - כמות מינימלית
     * @param {number} timeout - זמן המתנה להקשה בשניות
     * @param {boolean} disableConfirmation - אם true, מכניס AskNo במקום השביעי למניעת אישור
     * @param {boolean} allowZero - אם true, מתיר שימוש באפס כחלק מהקלט
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = false) {
        // על מנת להשתיק את ה"לאישור הקישו 1", חברת ימות המשיח דורשת לשתול את המילה "AskNo" 
        // בפרמטר השביעי (צורת השמעת הנתון). כמו כן, "yes" או "no" קובעים חסימות.
        const playType = disableConfirmation ? "AskNo" : "Digits";
        const blockAsterisk = "yes"; // חוסמים כוכבית בתפריטים פשוטים כדי למנוע יציאות בטעות
        const blockZero = allowZero ? "no" : "yes"; // yes=לחסום, no=לאפשר

        this.params =[
            varName,               // 1. שם המשתנה 
            "no",                  // 2. לא להשתמש בקיים
            "Digits",              // 3. סוג הקלט
            maxDigits.toString(),  // 4. מקסימום ספרות
            minDigits.toString(),  // 5. מינימום ספרות
            timeout.toString(),    // 6. זמן המתנה בשניות
            playType,              // 7. הברקת ה-AskNo! שובר את תפריט האישור
            blockAsterisk,         // 8. חסימת כוכבית
            blockZero,             // 9. חסימת אפס
            "",                    // 10. החלפת כוכבית בסלש (אנו נשאיר ריק בתפריטים רגילים)
            "",                    // 11. מקשים מורשים (ריק=הכל מותר)
            "",                    // 12. כמות פעמים
            "",                    // 13. המשך אם ריק
            "",                    // 14. מודל מקלדת
            "no"                   // 15. אישור הקשה נוסף (no)
        ];
        return this;
    }

    /**
     * הגדרת בקשת נתיב (למשל לשמירת קובץ בתיקייה) שמתירה כוכביות ואפסים.
     * כאן המערכת גם ממירה כוכביות לסלשים אוטומטית.
     */
    setReadFolderAdvanced(varName) {
        this.params =[
            varName,   // 1
            "no",      // 2
            "Digits",  // 3
            "20",      // 4: מקסימום 20 ספרות לנתיב
            "1",       // 5: מינימום ספרה אחת
            "15",      // 6: זמן המתנה
            "AskNo",   // 7: ללא אישור! 
            "no",      // 8: חסימת כוכבית = no (מותר כוכבית!)
            "no",      // 9: חסימת אפס = no (מותר אפס!)
            "*/",      // 10: החלפת כוכבית בסלש = */
            "", "", "", "", "no" // 11-15
        ];
        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה (Record).
     * מפעיל את תפריט ההקלטה המקורי (ההגדרות של הפרמטר השישי נשארו ריקות כדי שהתפריט ישמיע).
     */
    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   // 1. שם המשתנה 
            "no",      // 2. להשתמש בקיים?
            "record",  // 3. סוג קלט (הקלטה קולית)
            folder,    // 4. תיקיית יעד
            fileName,  // 5. שם קובץ
            "",        // 6. הפעלת תפריט אישור המקורי של ימות (1 שמיעה, 2 אישור, 3 מחדש, 5 להמשך)
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. שרשור לקובץ קודם (no)
        ];
        return this;
    }

    /** שרשור משתני מערכת לקריאה הבאה */
    addState(key, value) {
        this.nextState[key] = value;
        return this;
    }

    /** סיום הטיפול וניתוב הלקוח לשלוחה סופית */
    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /** הרכבת המחרוזת הסופית על פי דרישות ימות המשיח */
    build() {
        let res = "";
        
        // חיבור הבלוקים עם נקודה
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

        // אם יש ניתוב סופי וזה לא read
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

// מחיקת משתנים ריקים כדי שאם הלקוח הגיע ל-Timeout, השלב ירוץ מחדש
function cleanupEmptyQueryVariables(query) {
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "TargetFolderDefault", "WantCopySave", "TargetFolderCopy", "SetDefaultChoice"];
    for (const key of keys) {
        if (query[key] === "") delete query[key];
    }
}

// ============================================================================
// הליבה: Serverless Request Handler
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // הגנת ניתוק - למניעת לולאות (Loops) של שגיאות מול השרת של ימות
        if (query.hangup === "yes") {
            console.log(`[Hangup Event] המאזין ניתק את השיחה. עוצר הליכים. (CallID: ${query.ApiCallId})`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        if (!YEMOT_TOKEN) {
            console.error("[Fatal Error] נדחתה גישה: חסר טוקן YEMOT_TOKEN בהגדרות השלוחה.");
            return res.status(200).send("id_list_message=t-תקלה במערכת חסר מפתח הגדרה&hangup=yes");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        const ApiPhone = query.ApiPhone || "UnknownPhone";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        cleanupEmptyQueryVariables(query);
        
        // --- ניהול שלבים (State Machine) חכם, ללא משתנים נסתרים. נקבע לפי נוכחות המשתנה האחרון ב-URL ---
        let state = 0;
        if (query.SetDefaultChoice !== undefined) state = 6;
        else if (query.TargetFolderCopy !== undefined) state = 55;
        else if (query.WantCopySave !== undefined) state = 4;
        else if (query.TargetFolderDefault !== undefined) state = 3;
        else if (query.VoiceIndex !== undefined) state = 2;
        else if (query.VoiceGender !== undefined) state = 1;
        else if (query.UserAudioRecord !== undefined) {
            // אם המשתנה קיים אבל הערך הוא רק הנתיב (כלומר ההקלטה הושלמה)
            state = 100; // שלב הביניים - הורדת ההקלטה והתמלול
        }

        console.log(`[Flow Controller] טלפון: ${ApiPhone} | מזהה: ${ApiCallId} | שלב: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת והקלטת הודעת המקור
                // הלקוח יקבל את התפריט המלא של ימות המשיח לאחר שיקליט
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 100:
                // ====================================================================
                // שלב 1: STT חכם (עם ניתוח טון) ובחירת גבר/אישה (ספרה אחת בלבד!)
                // ====================================================================
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                // ה-audioBuffer עובר עיבוד וניקוי רעשים (DSP) בתוך core.js ואז נשלח לג'מיני.
                // ג'מיני מוסיף בסוגריים עגולים את הוראות הבמאי (הטון).
                const transcribedText = await gemini.transcribeAudioWithEmotion(mainAudioBuffer);
                console.log(`[STT] תומלל: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    break;
                }

                // שמירת הטקסט בקובץ (כולל ההוראות בסוגריים) כדי לשלוף בשלב ה-TTS
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול קריין גברי הקישו 1 לבחירת קול קריינית נשית הקישו 2")
                    // מקסימום 1, מינימום 1. ללא אישור! הלקוח מזנק לשלב הבא עם הקשה בודדת.
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false); 
                break;

            case 1:
                // ====================================================================
                // שלב 2: המאזין בחר מגדר - מקריאים לו את תפריט הקולות (2 ספרות)
                // ====================================================================
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false); 
                    break;
                }

                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder("read")
                    .addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
                
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; // הקראת "אפס אחד"
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }
                responseBuilder.addText("ובסיום הקישו סולמית");

                // מחייב 2 ספרות (למשל 01). מפעיל "AskNo" למניעת "לאישור הקישו 1".
                responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false);
                break;

            case 2:
                // ====================================================================
                // שלב 3: הלקוח בחר קול - יצירת ה-TTS המיידי (הסגנון מוסק אוטומטית)
                // * כאן השרת משהה את התגובה במכוון כדי שמוזיקת ההמתנה שלך (ztomao) תתחיל לנגן!
                // ====================================================================
                const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                
                if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false);
                    break;
                }

                const selectedVoiceId = voiceListCheck[checkIdx].id;
                
                // משיכת הטקסט (הכולל את הנחיות הבמאי בסוגריים עגולים) משלב 1
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // --- הפקת האודיו ---
                // פעולה זו נמשכת בממוצע 3-5 שניות. 
                // בזמן הזה, מכיוון שהשרת לא מחזיר מיד תשובה לימות, ימות תפעיל את `api_wait_answer_music_on_hold_different=ztomao`!
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
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false); // דורש ספרה 1 בלבד, ללא אישור!
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                        .addText("נא הקישו את מספר השלוחה לשמירה למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        .setReadFolderAdvanced("TargetFolderDefault"); // שימוש בפונקציה המתקדמת שמתירה 0 וכוכבית
                }
                break;

            case 4:
                // ====================================================================
                // שלב 4: (ללקוח וותיק) הלקוח נשאל האם הוא מעוניין בעותק נוסף בנתיב שונה (ספרה 1)
                // ====================================================================
                if (query.WantCopySave === "1") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        .setReadFolderAdvanced("TargetFolderCopy");
                } else if (query.WantCopySave === "2") {
                    responseBuilder = new YemotBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית לאישור הקישו 1 לביטול הקישו 2")
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false);
                }
                break;

            case 3:  // נתיב רגיל (אין ברירת מחדל)
            case 55: // נתיב לעותק נוסף
                // ====================================================================
                // שלב 5 + 55: תיוק הקובץ בשלוחת היעד (ומאפשר שמירה לשורש "0")
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
                    // פעם ראשונה ששומר - מציעים להפוך לברירת מחדל (דורש רק ספרה 1 או 2)
                    responseBuilder = new YemotBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו 1 לסיום הקישו 2")
                        .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false) 
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

        // שימור המשתנים ההיסטוריים שנאספו לאורך הדרך לטובת ה-Stateless Request
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
        console.error(`[IVR Critical Exception]`, error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה קריטית במערכת אנו מתנצלים&go_to_folder=/");
    }
};
