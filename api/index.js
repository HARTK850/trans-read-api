/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR החכמה לתמלול והקראה.
 * 
 * פיצ'רים מרכזיים בגרסה זו (Enterprise):
 * 1. "AskNo": ביטול מוחלט של "לאישור הקישו 1" במקומות הנדרשים.
 * 2. 1-Digit vs 2-Digit Menus: דיוק מושלם באורך התפריטים לחוויה זורמת.
 * 3. השבתת ה-System Instructions כדי למנוע קריסת 400 מג'מיני TTS.
 * 4. אינטגרציה מלאה של תפריט ההקלטה המקורי של ימות המשיח (1 לשמיעה, 2 לאישור וכו').
 * 5. הפעלת מוזיקת המתנה באמצעות שיהוי מחושב.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות סביבה וקונפיגורציה
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') :[
    "YOUR_GEMINI_API_KEY_1"
];
const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// מנוע אובייקט-אוריינטד ליצירת תחביר ימות המשיח (YemotBuilder)
// ============================================================================
class YemotBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks = [];
        this.params =[];
        this.nextState = {};
        this.goToFolder = null; 
    }

    cleanYemotText(text) {
        // מחיקת כל תווים בעייתיים שעלולים לשבור את תחביר המחרוזות של ימות המשיח
        return text.replace(/[-.(),]/g, ""); 
    }

    addText(text) {
        const clean = this.cleanYemotText(text);
        this.contentBlocks.push(`t-${clean}`);
        return this;
    }

    addFile(filePath) {
        this.contentBlocks.push(`f-${filePath}`);
        return this;
    }

    /**
     * הגדרת קלט מסוג Digits/Number.
     * @param {string} varName - שם המשתנה שיוחזר
     * @param {string} type - Digits או Number
     * @param {number} maxDigits - מקסימום ספרות (או ריק)
     * @param {number} minDigits - מינימום ספרות
     * @param {number} timeout - שניות להמתנה
     * @param {boolean} disableConfirmation - אם true, שולח AskNo (מבטל 'לאישור הקישו 1')
     * @param {boolean} blockAsterisk - חסימת כוכבית
     * @param {boolean} allowZero - מאפשר בחירת '0'. אם true, נשלח 'no' כדי לבטל חסימת 0.
     */
    setReadConfig(varName, type, maxDigits, minDigits, timeout, disableConfirmation = true, blockAsterisk = true, allowZero = true) {
        // הסדר המדויק לפי מסמכי ימות המשיח לפקודת read (אחרי סוג הקלט):
        // משתנה, קיים(no), סוג(Digits), מקס, מינ, זמן, AskNo, חסימת_כוכבית, חסימת_אפס.
        this.params =[
            varName, 
            "no",           
            type,           
            maxDigits || "",
            minDigits || "1",
            timeout || "10",
            disableConfirmation ? "AskNo" : "", // הפתרון ל"לאישור הקישו 1"
            blockAsterisk ? "yes" : "no",
            allowZero ? "no" : "yes" // block_zero="no" מאפשר את הספרה 0
        ];
        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה (Record).
     * @param {string} varName - שם המשתנה
     * @param {string} folder - תיקיית שמירה
     * @param {string} fileName - שם הקובץ לשמירה
     */
    setRecordConfig(varName, folder, fileName) {
        // כדי להפעיל את תפריט ימות המקורי (1 שמיעה, 2 אישור...), הערך השישי חייב להיות "no"
        // פרמטרים: משתנה, קיים(no), record, תיקייה, שם, אישור_מיידי(no), שמירה_בניתוק(yes), הוספה_לקיים(no)
        this.params =[
            varName,
            "no",
            "record",
            folder,
            fileName,
            "no",  // ביטול אישור מיידי בסולמית = הפעלת התפריט המלא של ימות!
            "yes", // שמירה בניתוק
            "no"   // לא לשרשר לקובץ קודם
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
        let res = `${this.action}=`;
        
        if (this.contentBlocks.length > 0) {
            res += this.contentBlocks.join('.');
        }

        if (this.params.length > 0) {
            res += "=" + this.params.join(',');
        }

        let index = 0;
        for (const [key, value] of Object.entries(this.nextState)) {
            res += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
            index++;
        }

        if (this.goToFolder) {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// הליבה: Serverless Request Handler
// ============================================================================

module.exports = async function handler(req, res) {
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    // הגנת נטישה: אם הלקוח ניתק, מונעים לולאה אוטומטית בימות המשיח.
    if (query.hangup === "yes") {
        console.log(`[Hangup Event] שיחה נותקה. מזהה: ${query.ApiCallId}`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(""); 
    }

    const YEMOT_TOKEN = query.yemot_token;
    if (!YEMOT_TOKEN) {
        console.error("[Fatal Error] חסר טוקן גישה של ימות המשיח!");
    }
    const yemot = new YemotManager(YEMOT_TOKEN);

    const ApiPhone = query.ApiPhone || "UnknownPhone";
    const ApiCallId = query.ApiCallId || "UnknownCallID";
    
    // זיהוי שלבים (State Machine) המבוסס על משתנים מצטברים ב-URL.
    let state = 0;
    if (query.SetDefaultChoice) state = 6;
    else if (query.TargetFolderCopy) state = 55; // שלב מיוחד לעותק נוסף
    else if (query.TargetFolderDefault) state = 5;
    else if (query.UserChoiceAdditionalSave) state = 4;
    else if (query.VoiceIndex) state = 3;
    else if (query.VoiceGender) state = 2;
    else if (query.UserAudioRecord) state = 1;
    
    console.log(`[Flow Controller] טלפון: ${ApiPhone} | שלב: ${state}`);

    let yemotRes = "";
    let responseBuilder = null;

    try {
        switch (state) {
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת ובקשת הקלטה. (מפעיל תפריט ימות מלא)
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למערכת היצירה הקולית")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 1:
                // ====================================================================
                // שלב 1: STT חכם + ניתוח טון ג'מיני + בחירת מין (ספרה 1 בלבד)
                // ====================================================================
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                // ה-audioBuffer עובר הגברה וניקוי (DSP) בתוך core.js ואז נשלח לג'מיני
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[STT Success] טקסט תומלל (עם הנחיות טון): ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                        .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                        .addState("yemot_token", YEMOT_TOKEN);
                    break;
                }

                // שומרים את הטקסט (כולל הערות הבמאי בסוגריים) לשימוש בשלב ה-TTS
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                // תפריט ספרה 1: "AskNo" מופעל למניעת "לאישור הקישו 1"
                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול של גבר הקישו 1")
                    .addText("לבחירת קול של אישה הקישו 2")
                    .setReadConfig("VoiceGender", "Digits", 1, 1, 10, true, true, false) 
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 2:
                // ====================================================================
                // שלב 2: תפריט הקולות (דורש 2 ספרות כי יש 15 קולות) - הקראת "אפס אחד"
                // ====================================================================
                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder("read").addText("אנא בחרו את הקול הרצוי");
                
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    // מקריא "אפס אחד", "אפס שתיים" לטובת חווית משתמש טבעית
                    let spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }

                responseBuilder.addText("בסיום הקישו סולמית");

                // תפריט 2 ספרות: "AskNo" מופעל למניעת אישור
                responseBuilder
                    .setReadConfig("VoiceIndex", "Digits", 2, 2, 15, true, true, false)
                    .addState("gender", isMale ? "MALE" : "FEMALE")
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 3:
                // ====================================================================
                // שלב 3: הלקוח בחר קול - יצירת ה-TTS באופן מיידי! (מוזיקה בהמתנה מופעלת)
                // *הערה: הוסר תפריט הסגנונות כבקשתך. הטון מחושב ישירות מתוך הטקסט!*
                // ====================================================================
                const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                
                // הגנה במקרה של הקשת קול מחוץ לטווח
                const selectedVoiceId = (voiceIndex >= 0 && voiceIndex < voiceList.length) ? voiceList[voiceIndex].id : voiceList[0].id;

                // משיכת הטקסט עם ההוראות (מה שג'מיני יצר בשלב 1)
                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // יצירת האודיו מ-Gemini (שימו לב: הקובץ המוחזר הוא PCM RAW, והופך ל-WAV בתוך core.js)
                const ttsAudioBuffer = await gemini.generateTTS(mainText, selectedVoiceId);
                
                // העלאה ושמירת הקובץ שהופק בתיקייה הזמנית בימות המשיח
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

                // בדיקת העדפות שמורות (האם הלקוח שמר שלוחת ברירת מחדל פעם קודמת?)
                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileName = await yemot.getNextSequenceFileName(folder);
                    const finalPath = `ivr2:/${folder}/${nextFileName}.wav`;
                    
                    // שמירת עותק נוסף בתיקיית ברירת המחדל
                    await yemot.uploadFile(finalPath, ttsAudioBuffer);

                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // משמיע את הקובץ שהופק!
                        .addText("הקובץ הושמע ונשמר בהצלחה בשלוחה המועדפת")
                        .addText("האם לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        .setReadConfig("UserChoiceAdditionalSave", "Digits", 1, 1, 15, true, true, false) // 1 ספרה בלבד, עם AskNo!
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ. לשמירה בתיקייה הראשית הקישו אפס ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderDefault", "Digits", 15, 1, 15, true, true, true) // allowZero=true (מתיר הקשת 0)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 4:
                // ====================================================================
                // שלב 4: משתמש בעל שלוחת ברירת מחדל נשאל האם לשמור עותק נוסף (1 או 2)
                // ====================================================================
                if (query.UserChoiceAdditionalSave === "1") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderCopy", "Digits", 15, 1, 15, true, true, true) // allowZero=true
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/");
                }
                break;

            case 5:  // נתיב רגיל (אין ברירת מחדל)
            case 55: // נתיב לעותק נוסף
                // ====================================================================
                // שלב 5 + 55: תיוק הקובץ בשלוחת היעד (עם תמיכה בשמירה לשורש "0")
                // ====================================================================
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                
                // הלקוח ניתק או הקיש סולמית בלבד
                if (targetFolder === undefined) { 
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                    break; 
                }
                
                // אם המשתמש הקיש '0', אנחנו מאפסים את התיקייה כדי לשמור בתיקיית השורש
                if (targetFolder === "0") {
                    targetFolder = "";
                }
                
                const cleanFolder = targetFolder.replace(/\*/g, "/"); // מתרגם כוכביות לסלשים
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder || "/");
                
                const uploadPath = cleanFolder ? `ivr2:/${cleanFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
                await yemot.uploadFile(uploadPath, ttsForSave);

                if (state === 55) { 
                    // עותק נוסף - מסיים וחוזר לשורש
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText(`העותק נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addGoToFolder("/"); 
                } else { 
                    // פעם ראשונה ששומר - מציעים להפוך לברירת מחדל (דורש ספרה 1 בלבד)
                    responseBuilder = new YemotBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו 1 לסיום הקישו 2")
                        .setReadConfig("SetDefaultChoice", "Digits", 1, 1, 10, true, true, false) // 1 ספרה בלבד + AskNo
                        .addState("targetFolder", cleanFolder)
                        .addState("yemot_token", YEMOT_TOKEN);
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

        if (!yemotRes && responseBuilder) {
            yemotRes = responseBuilder.build();
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotRes);

    } catch (error) {
        console.error(`[IVR Error]`, error);
        let errorRes = new YemotBuilder("id_list_message")
            .addText("אירעה שגיאה במערכת ההמרה אנו מתנצלים")
            .addGoToFolder("/")
            .build();
            
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(errorRes);
    }
};
