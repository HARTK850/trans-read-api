/**
 * @file api/index.js
 * @description מנהל השלבים (State Machine) של ה-IVR עבור Vercel Serverless.
 * מספק חווית משתמש רציפה (UX): מקריא "אפס אחד", מאפשר תפריט הקלטה מלא, מאפשר מקש "0", 
 * ומתקדם מיידית בלי ה"לאישור הקישו 1" המעיק.
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
        this.action = action; // לרוב 'read' או 'id_list_message'
        this.contentBlocks = [];
        this.params =[];
        this.nextState = {};
        this.goToFolder = null; 
    }

    cleanYemotText(text) {
        return text.replace(/[-.(),]/g, ""); // מנקה תווים מסוכנים לימות המשיח
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
     * הגדרת קלט מסוג Digits (ללא אישור "הקישו 1").
     * מאפשר הקשת אפס! (BlockZero=no)
     */
    setReadConfig(varName, maxDigits, minDigits, timeout) {
        this.params =[
            varName, 
            "no",           // לא להשתמש בקיים
            "Digits",       // סוג קלט
            maxDigits || "",// מקסימום (ריק = ללא הגבלה)
            minDigits || "1",// מינימום
            timeout || "10",// טיימאאוט בשניות
            "No",           // *** ביטול Playback (מעלים את 'לאישור הקישו 1') ***
            "yes",          // חסימת כוכבית
            "no"            // *** מתיר שימוש בספרה 0 ***
        ];
        return this;
    }

    /**
     * הגדרת בקשת הקלטה.
     * מפעיל את תפריט ההקלטה המלא של ימות המשיח (1 לשמיעה, 2 לאישור, 3 מחדש, 5 המשך).
     */
    setRecordConfig(varName, folder, fileName, minSec, maxSec) {
        this.params =[
            varName,
            "no",
            "record",
            folder,
            fileName,
            "no",  // *** no = הפעלת התפריט המלא של ימות! ***
            "yes", // שמירה בניתוק
            "no",  // לא לשרשר לקובץ קודם
            minSec || "2",
            maxSec || "120"
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

    // הגנת נטישה: אם הלקוח ניתק, אנו מפסיקים מיד את הפעולה ומונעים לולאות.
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
    
    // ניהול שלבים (State Machine) המבוסס על הנתונים שהצטברו בבקשה
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
                // שלב 0: פתיח המערכת ובקשת הקלטה מהמשתמש. (תפריט ימות מלא)
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למערכת היצירה הקולית")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 1:
                // ====================================================================
                // שלב 1: STT חכם המזהה סגנון, ומעבר לבחירת גבר/אישה.
                // * מודל התמלול מסוקרן לנתח את הטון ולהוסיף סוגריים עגולים.
                // ====================================================================
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                // ה-audioBuffer עובר עיבוד וניקוי רעשים בתוך הפונקציה
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[STT Success] טקסט שתומלל עם טון: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                        .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                        .addState("yemot_token", YEMOT_TOKEN);
                    break;
                }

                // שמירת הטקסט (כולל הוראות הבמאי) כדי למשוך אותו בהמשך
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול של גבר הקישו אפס אחד")
                    .addText("לבחירת קול של אישה הקישו אפס שתיים")
                    .setReadConfig("VoiceGender", 2, 2, 10) // מחייב להקיש 01 או 02
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 2:
                // ====================================================================
                // שלב 2: תפריט הקולות הייעודי (15 קולות) שמקריא "אפס אחד".
                // ====================================================================
                const isMale = query.VoiceGender === "01";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder("read").addText("אנא בחרו את הקול הרצוי");
                
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    // ימות המשיח לא יודעת להקריא "01" יפה, לכן אנחנו מאכילים אותה בכפית: "אפס אחד"
                    let spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }

                responseBuilder.addText("בסיום הקישו סולמית");

                responseBuilder
                    .setReadConfig("VoiceIndex", 2, 1, 15) // תומך ב 1 עד 2 ספרות (למשל: 5, 05, 12)
                    .addState("gender", isMale ? "MALE" : "FEMALE")
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 3:
                // ====================================================================
                // שלב 3: הלקוח בחר קול - יצירת ה-TTS באופן מיידי!
                // *הערה: הוסר תפריט הסגנונות.* השרת ייעצר כאן לכמה שניות וימות תנגן מוזיקה!
                // ====================================================================
                const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                
                // הגנה במקרה של הקשת קול מחוץ לטווח
                const selectedVoiceId = (voiceIndex >= 0 && voiceIndex < voiceList.length) ? voiceList[voiceIndex].id : voiceList[0].id;

                // משיכת הטקסט עם ההוראות (מה שג'מיני יצר בשלב 1)
                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // יצירת האודיו מ-Gemini (ללא העברת System Instructions, רק הטקסט הגולמי)
                const ttsAudioBuffer = await gemini.generateTTS(mainText, selectedVoiceId);
                
                // העלאה ושמירת הקובץ שהופק בתיקייה הזמנית בימות המשיח
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

                // ניתוב לשמירה בהתאם להעדפות שמורות (האם הלקוח שמר שלוחת ברירת מחדל?)
                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileName = await yemot.getNextSequenceFileName(folder);
                    const finalPath = `ivr2:/${folder}/${nextFileName}.wav`;
                    
                    await yemot.uploadFile(finalPath, ttsAudioBuffer);

                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) // משמיע את הקובץ שהופק!
                        .addText("הקובץ הושמע ונשמר בהצלחה בשלוחה המועדפת")
                        .addText("האם לשמור עותק במיקום נוסף לאישור הקישו אפס אחד לביטול וחזרה הקישו אפס שתיים")
                        .setReadConfig("UserChoiceAdditionalSave", 2, 2, 10) // מאלץ "01" או "02" לתגובה מיידית
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ. לשמירה בתיקייה הראשית הקישו אפס. ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderDefault", "", 1, 15) // Max ריק, Min 1, הכל פתוח! גם אפס מותר.
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 4:
                // ====================================================================
                // שלב 4: משתמש בעל שלוחת ברירת מחדל נשאל האם לשמור עותק נוסף
                // ====================================================================
                if (query.UserChoiceAdditionalSave === "01") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderCopy", "", 1, 15) // הכל פתוח
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/");
                }
                break;

            case 5:  // נתיב רגיל (אין ברירת מחדל)
            case 55: // נתיב לעותק נוסף
                // ====================================================================
                // שלב 5 + 55: תיוק הקובץ בשלוחת היעד (ומאפשר שמירה לשורש "0")
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
                    // פעם ראשונה ששומר - מציעים להפוך לברירת מחדל
                    responseBuilder = new YemotBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו אפס אחד לסיום הקישו אפס שתיים")
                        .setReadConfig("SetDefaultChoice", 2, 2, 10)
                        .addState("targetFolder", cleanFolder)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 6:
                // ====================================================================
                // שלב 6: עדכון מועדפים במסד הנתונים של ימות (קבצי txt) ופרידה
                // ====================================================================
                if (query.SetDefaultChoice === "01" && query.targetFolder !== undefined) {
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
