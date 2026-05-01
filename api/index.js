/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR החכמה לתמלול והקראה.
 * מנהל את ה-State Machine ללא משתנים נסתרים, אלא באמצעות קריאת ה-URL מימות המשיח.
 * נכתב בסטנדרט Enterprise: כולל מנגנוני כשל, תיעוד מקיף, בניית תגובות אטומה לשגיאות, ומניעת לולאות.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// 1. קונפיגורציה והגדרות מערכת גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') :[
    "YOUR_GEMINI_API_KEY_1"
];

// יצירת מופע יחיד של מנהל ה-API של ג'מיני (ינהל את התור וחלוקת העומס)
const gemini = new GeminiManager(GEMINI_API_KEYS);

// התיקייה הזמנית במערכת ימות המשיח. כאן נשמרים ההקלטות והטקסטים לפני תיוק סופי.
const TEMP_FOLDER = "/Temp_Gemini_App";

// ============================================================================
// 2. מנוע אובייקט-אוריינטד ליצירת תחביר ימות המשיח (YemotBuilder)
// ============================================================================
/**
 * מחלקה זו אחראית לבנות בצורה בטוחה ותקנית את מחרוזת ה-Response לימות המשיח.
 * מונעת שגיאות כתיב, מנקה תווים מסוכנים (כמו נקודות בתוך משפטים), ומנהלת את
 * שרשור המשתנים לשלב הבא (api_add).
 */
class YemotBuilder {
    constructor(action) {
        this.action = action; // פעולה ראשית, לרוב 'read' או 'id_list_message'
        this.contentBlocks =[];
        this.params =[];
        this.nextState = {};
        this.goToFolder = null; // מאפשר שרשור אוטומטי של חזרה לתפריט ראשי
    }

    /**
     * ניקוי טקסט עברית מסימני פיסוק העלולים לבלבל את מנוע הפיענוח של ימות המשיח
     * @param {string} text - הטקסט להקראה
     * @returns {string} טקסט נקי לחלוטין מנקודות, פסיקים, ומקפים.
     */
    cleanYemotText(text) {
        return text.replace(/[-.(),]/g, "");
    }

    /**
     * הוספת בלוק הקראה (Text to Speech של ימות המשיח לממשק עצמו)
     */
    addText(text) {
        const clean = this.cleanYemotText(text);
        this.contentBlocks.push(`t-${clean}`);
        return this;
    }

    /**
     * הוספת בלוק להשמעת קובץ אודיו (File)
     */
    addFile(filePath) {
        this.contentBlocks.push(`f-${filePath}`);
        return this;
    }

    /**
     * הגדרת מאפייני בקשת קלט מסוג Digits (ללא אישורים מיותרים)
     */
    setReadConfig(varName, type, maxDigits, minDigits, timeout) {
        // מונע את השמעת ה"לאישור הקישו 1" על ידי הגדרת "No" בפרמטר השביעי של ה-read
        this.params =[
            varName, 
            "no",           // לא להשתמש בקיים
            type,           // סוג הקלט: Digits או record
            maxDigits, 
            minDigits, 
            timeout, 
            type === "Digits" ? "No" : "no", // ביטול Playback להקשות
            "yes"           // חסימת מקש כוכבית
        ];
        return this;
    }

    /**
     * הגדרת מאפייני בקשת קלט מסוג הקלטה (Record)
     */
    setRecordConfig(varName, folder, fileName, minSec, maxSec) {
        this.params =[
            varName,
            "no",
            "record",
            folder,
            fileName,
            "yes", // אישור מיידי על ידי סולמית (ללא תפריט הקלטה חוזרת של ימות)
            "yes", // שמירה בניתוק
            "no",  // לא לשרשר לקובץ קודם
            minSec,
            maxSec
        ];
        return this;
    }

    /**
     * הוספת משתנים שיישלחו חזרה מהשרת של ימות המשיח לקריאה הבאה (API Add)
     */
    addState(key, value) {
        this.nextState[key] = value;
        return this;
    }

    /**
     * הגדרת ניתוב בסוף הפעולה
     */
    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    /**
     * עיבוד ובניית המחרוזת הסופית למשלוח בחזרה לשרתי ימות המשיח
     */
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
// 3. הליבה: Serverless Request Handler
// ============================================================================

module.exports = async function handler(req, res) {
    // איסוף הפרמטרים מהבקשה (תומך גם ב-GET וגם ב-POST של ימות)
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    // --- הגנת נטישה (Hangup Protection) ---
    // אם הלקוח סגר את הטלפון, ימות המשיח שולחת פנייה אחרונה עם hangup=yes.
    // חובה לעצור כאן ולא להחזיר שום תוכן, אחרת ניצור לולאה שגויה במערכת שלהם.
    if (query.hangup === "yes") {
        console.log(`[Hangup Event] שיחה נותקה בצד הלקוח. (CallID: ${query.ApiCallId})`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(""); 
    }

    // קבלת הטוקן ובניית קליינט ימות המשיח
    const YEMOT_TOKEN = query.yemot_token;
    if (!YEMOT_TOKEN) {
        console.error("[Fatal Error] לא התקבל טוקן גישה מימות המשיח! המערכת תקרוס עכשיו.");
    }
    const yemot = new YemotManager(YEMOT_TOKEN);

    const ApiPhone = query.ApiPhone || "UnknownPhone";
    const ApiCallId = query.ApiCallId || "UnknownCallID";
    
    // --- Stateless State Machine ---
    // אנחנו מזהים באיזה שלב הלקוח נמצא לפי הנתון האחרון שהוא הזין והתווסף ל-URL.
    // זוהי השיטה האמינה והיציבה ביותר לעבודה מול ה-API של ימות המשיח.
    let state = 0;
    if (query.SetDefaultChoice) state = 9;
    else if (query.TargetFolderCopy) state = 85; 
    else if (query.TargetFolderDefault) state = 8;
    else if (query.UserChoiceAdditionalSave) state = 7;
    else if (query.CustomStyleRecord) state = 5;
    else if (query.StyleChoice) state = 4;
    else if (query.VoiceIndex) state = 3;
    else if (query.VoiceGender) state = 2;
    else if (query.UserAudioRecord) state = 1;
    
    console.log(`[Flow Controller] טלפון: ${ApiPhone} | מזהה: ${ApiCallId} | שלב שזוהה: ${state}`);

    // כאן התיקון הקריטי למניעת ReferenceError שהפיל את המערכת!
    let yemotRes = "";
    let responseBuilder = null;

    try {
        switch (state) {
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת ובקשת הקלטה מהמשתמש
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למערכת היצירה הקולית")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 1:
                // ====================================================================
                // שלב 1: עיבוד ההקלטה לטקסט (STT) ושמירתו
                // ====================================================================
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                // ה-audioBuffer עובר עיבוד שמע והגברה בתוך GeminiManager (DSP)
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[STT Success] טקסט שתומלל בהצלחה: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                        .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                        .addState("yemot_token", YEMOT_TOKEN);
                    break;
                }

                // שמירת הטקסט בקובץ כדי למשוך אותו בשלב הפקת הקול
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                // המעבר החלק - דורש בדיוק 2 ספרות לקבלת החלטה ללא המתנה ואישור!
                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נקלט בהצלחה")
                    .addText("לבחירת קול של גבר הקישו אפס אחד")
                    .addText("לבחירת קול של אישה הקישו אפס שתיים")
                    .setReadConfig("VoiceGender", "Digits", 2, 2, 10) 
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 2:
                // ====================================================================
                // שלב 2: משתמש בחר מין - מקריאים לו את תפריט הקולות הייעודי
                // ====================================================================
                const isMale = query.VoiceGender === "01";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder("read").addText("אנא בחרו את הקול הרצוי");
                
                for (let i = 0; i < voices.length; i++) {
                    const digitStr = String(i + 1).padStart(2, '0');
                    const spokenDigitStr = digitStr.replace("0", "אפס ");
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenDigitStr}`);
                }

                responseBuilder
                    .setReadConfig("VoiceIndex", "Digits", 2, 2, 15) // מחייב 2 ספרות (למשל 05) ועובר הלאה
                    .addState("gender", isMale ? "MALE" : "FEMALE")
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 3:
                // ====================================================================
                // שלב 3: הלקוח בחר קול - מעבר לתפריט בחירת טון וסגנון
                // ====================================================================
                const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                
                //Fallback למקרה שהקיש משהו לא הגיוני
                const selectedVoiceId = (voiceIndex >= 0 && voiceIndex < voiceList.length) ? voiceList[voiceIndex].id : voiceList[0].id;

                responseBuilder = new YemotBuilder("read")
                    .addText("לבחירת סגנון רגיל הקישו אפס אחד")
                    .addText("לסגנון שמח ונלהב הקישו אפס שתיים")
                    .addText("לסגנון רציני הקישו אפס שלוש")
                    .addText("להגדרת סגנון מותאם אישית בהקלטה הקישו אפס ארבע")
                    .setReadConfig("StyleChoice", "Digits", 2, 2, 10)
                    .addState("voiceId", selectedVoiceId)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 4:
                // ====================================================================
                // שלב 4: פיצול הפקה. אם בחר סגנון מובנה - ההפקה מתחילה מיד וברקע!
                // ====================================================================
                const styleChoice = query.StyleChoice;

                if (styleChoice === "04") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("אנא הקליטו את הנחיות הבמאי לסגנון ההקראה הרצוי ולאחר מכן הקישו סולמית")
                        .setRecordConfig("CustomStyleRecord", TEMP_FOLDER, `${ApiCallId}_style`, 2, 60)
                        .addState("voiceId", query.voiceId)
                        .addState("yemot_token", YEMOT_TOKEN);
                    break;
                } 
                
                // הכנת ה-Emotion Cue שיוזרק לתוך הטקסט לפרומפט של ג'מיני
                let emotionCue = "";
                if (styleChoice === "02") emotionCue = "Happy, upbeat, and very excited";
                else if (styleChoice === "03") emotionCue = "Serious, dramatic, and formal";

                // משיכת הטקסט להקראה מהאחסון
                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // יצירת קובץ ה-TTS (מושעה עדיפות - לוקח כמה שניות)
                const ttsAudioBuffer = await gemini.generateTTS(mainText, query.voiceId, emotionCue);
                
                // שמירת הקובץ שהופק בתיקייה הזמנית בימות המשיח
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

                // ניתוב לשמירה בהתאם להעדפות שמורות (Database חכם מבוסס קבצים)
                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileName = await yemot.getNextSequenceFileName(folder);
                    const finalPath = `ivr2:/${folder}/${nextFileName}.wav`;
                    
                    await yemot.uploadFile(finalPath, ttsAudioBuffer);

                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע ונשמר בהצלחה בשלוחה המועדפת")
                        .addText("האם לשמור עותק במיקום נוסף לאישור הקישו אפס אחד לביטול וחזרה הקישו אפס שתיים")
                        .setReadConfig("UserChoiceAdditionalSave", "Digits", 2, 2, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderDefault", "Digits", 15, 1, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 5:
                // ====================================================================
                // שלב 5: עיבוד הנחיות הבמאי (STT), והפקת הקול המותאם אישית (TTS)
                // ====================================================================
                const styleBuffer = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_style.wav`);
                const customEmotionCue = await gemini.transcribeAudio(styleBuffer);
                const mainTextCustom = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // הזרקת ההוראות של המאזין ישירות למנוע של ג'מיני (במבנה של הנחיית במאי פנימית)
                const customTTSBuffer = await gemini.generateTTS(mainTextCustom, query.voiceId, customEmotionCue);
                await yemot.uploadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`, customTTSBuffer);

                const prefPathCustom = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolderCustom = await yemot.getTextFile(prefPathCustom);

                if (defaultFolderCustom && defaultFolderCustom.trim().length > 0) {
                    const folder = defaultFolderCustom.trim();
                    const nextFileName = await yemot.getNextSequenceFileName(folder);
                    await yemot.uploadFile(`ivr2:/${folder}/${nextFileName}.wav`, customTTSBuffer);

                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע ונשמר בהצלחה בשלוחה המועדפת")
                        .addText("האם לשמור עותק במיקום נוסף לאישור הקישו אפס אחד לביטול וחזרה הקישו אפס שתיים")
                        .setReadConfig("UserChoiceAdditionalSave", "Digits", 2, 2, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderDefault", "Digits", 15, 1, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 7:
                // ====================================================================
                // שלב 7: משתמש נשאל האם הוא רוצה לשמור עותק נוסף
                // ====================================================================
                if (query.UserChoiceAdditionalSave === "01") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderCopy", "Digits", 15, 1, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/");
                }
                break;

            case 8:  // שמירה בפעם הראשונה
            case 85: // שמירת עותק נוסף
                // ====================================================================
                // שלבים 8+85: תיוק הקובץ בתיקיית היעד, ושאלה על ברירת המחדל
                // ====================================================================
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                if (!targetFolder) { 
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                    break; 
                }
                
                const cleanFolder = targetFolder.replace(/\*/g, "/");
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder);
                
                await yemot.uploadFile(`ivr2:/${cleanFolder}/${seqFileName}.wav`, ttsForSave);

                if (state === 85) { 
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText(`העותק נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addGoToFolder("/"); // חזרה לשורש המערכת
                } else { 
                    responseBuilder = new YemotBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו אפס אחד לסיום הקישו אפס שתיים")
                        .setReadConfig("SetDefaultChoice", "Digits", 2, 2, 10)
                        .addState("targetFolder", cleanFolder)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 9:
                // ====================================================================
                // שלב 9: תיוק העדפת המשתמש (שלוחת ברירת המחדל) ופרידה
                // ====================================================================
                if (query.SetDefaultChoice === "01" && query.targetFolder) {
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
                // Fallback למקרה חירום מוחלט
                responseBuilder = new YemotBuilder("go_to_folder").addText("/");
        }

        // בניית המחרוזת הסופית מתוך מחלקת הבנייה הבטוחה
        if (!yemotRes && responseBuilder) {
            yemotRes = responseBuilder.build();
        }

        // שליחת התשובה בחזרה לימות המשיח
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotRes);

    } catch (error) {
        // מנגנון תפיסת שגיאות קריטיות - מונע תקיעת לקוח במערכת הטלפונית
        console.error(`[IVR Critical Catch Error]`, error);
        let errorRes = new YemotBuilder("id_list_message")
            .addText("אירעה שגיאה במערכת ההמרה אנו מתנצלים")
            .addGoToFolder("/")
            .build();
            
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(errorRes);
    }
};
