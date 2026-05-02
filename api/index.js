/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR החכמה לתמלול והקראה.
 * מנהל את ה-State Machine ללא משתנים נסתרים. 
 * מותאם לחווית משתמש (UX) חלקה: תפריט הקלטה מלא, ביטול אישורי "הקישו 1" וניגון מוזיקה בזמן יצירת הקול.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// 1. קונפיגורציה והגדרות מערכת גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') :[
    "YOUR_GEMINI_API_KEY_1"
];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// 2. מנוע אובייקט-אוריינטד ליצירת תחביר ימות המשיח (YemotBuilder)
// ============================================================================
class YemotBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks =[];
        this.params =[];
        this.nextState = {};
        this.goToFolder = null; 
    }

    cleanYemotText(text) {
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
     * הגדרת מאפייני בקשת קלט מספרים.
     * הערך השביעי 'No' מבטל לחלוטין את "לאישור הקישו 1".
     */
    setReadConfig(varName, maxDigits, minDigits, timeout) {
        this.params =[
            varName, 
            "no",           
            "Digits",           
            maxDigits, 
            minDigits, 
            timeout, 
            "No", // ביטול Playback להקשות ("לאישור הקישו 1")
            "yes" // חסימת מקש כוכבית
        ];
        return this;
    }

    /**
     * הגדרת מאפייני בקשת הקלטה.
     * הערך השישי 'no' מבטל אישור אוטומטי, ובכך מחזיר את תפריט ההקלטה המלא של ימות המשיח!
     */
    setRecordConfig(varName, folder, fileName, minSec, maxSec) {
        this.params =[
            varName,
            "no",
            "record",
            folder,
            fileName,
            "no",  // no = הפעלת התפריט המלא של ימות (1 לשמיעה, 2 לאישור, 3 להקלטה מחדש...)
            "yes", // שמירה בניתוק
            "no",  // לא לשרשר לקובץ קודם
            minSec,
            maxSec
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
// 3. הליבה: Serverless Request Handler
// ============================================================================

module.exports = async function handler(req, res) {
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    // עצירת פעולה אם הלקוח סגר את הטלפון, מונע לולאות
    if (query.hangup === "yes") {
        console.log(`[Hangup Event] שיחה נותקה. (CallID: ${query.ApiCallId})`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(""); 
    }

    const YEMOT_TOKEN = query.yemot_token;
    if (!YEMOT_TOKEN) {
        console.error("[Fatal Error] חסר טוקן גישה מימות המשיח!");
    }
    const yemot = new YemotManager(YEMOT_TOKEN);

    const ApiPhone = query.ApiPhone || "UnknownPhone";
    const ApiCallId = query.ApiCallId || "UnknownCallID";
    
    // ניהול שלבים (State Machine) המבוסס על סריקת המשתנים מהבקשה.
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
    
    console.log(`[Flow Controller] טלפון: ${ApiPhone} | שלב: ${state}`);

    let yemotRes = "";
    let responseBuilder = null;

    try {
        switch (state) {
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת ובקשת הקלטה. הלקוח יקבל תפריט ימות מלא!
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למערכת היצירה הקולית")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 1:
                // ====================================================================
                // שלב 1: עיבוד ההקלטה ובקשת מין הקול (בחירה של ספרה אחת בלבד!)
                // ====================================================================
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[STT Success] טקסט שתומלל: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                        .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                        .addState("yemot_token", YEMOT_TOKEN);
                    break;
                }

                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נקלט בהצלחה")
                    .addText("לבחירת קול של גבר הקישו 1")
                    .addText("לבחירת קול של אישה הקישו 2")
                    .setReadConfig("VoiceGender", 1, 1, 10) // מאפשר ספרה 1 בלבד ומתקדם מיד
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 2:
                // ====================================================================
                // שלב 2: תפריט הקולות (דורש עד 2 ספרות כי יש 15 קולות)
                // ====================================================================
                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder("read").addText("אנא בחרו את הקול הרצוי");
                
                for (let i = 0; i < voices.length; i++) {
                    // המערכת פשוט מקריאה "הקישו 1", "הקישו 15". בלי אפס מוביל.
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${i + 1}`);
                }

                responseBuilder.addText("בסיום הקישו סולמית");

                responseBuilder
                    .setReadConfig("VoiceIndex", 2, 1, 15) // מאפשר מ-1 עד 2 ספרות.
                    .addState("gender", isMale ? "MALE" : "FEMALE")
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 3:
                // ====================================================================
                // שלב 3: בחירת הסגנון (ספרה אחת בלבד!)
                // ====================================================================
                const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                
                const selectedVoiceId = (voiceIndex >= 0 && voiceIndex < voiceList.length) ? voiceList[voiceIndex].id : voiceList[0].id;

                responseBuilder = new YemotBuilder("read")
                    .addText("לבחירת סגנון רגיל הקישו 1")
                    .addText("לסגנון שמח ונלהב הקישו 2")
                    .addText("לסגנון רציני הקישו 3")
                    .addText("להגדרת סגנון מותאם אישית בהקלטה הקישו 4")
                    .setReadConfig("StyleChoice", 1, 1, 10) // מאפשר ספרה אחת בלבד ומתקדם מיד
                    .addState("voiceId", selectedVoiceId)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 4:
                // ====================================================================
                // שלב 4: פיצול הפקה (אם נבחר סגנון מובנה - ממתינים והמוזיקה מתנגנת!)
                // ====================================================================
                const styleChoice = query.StyleChoice;

                if (styleChoice === "4") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("אנא הקליטו את הנחיות הבמאי לסגנון ההקראה הרצוי ולאחר מכן הקישו סולמית")
                        .setRecordConfig("CustomStyleRecord", TEMP_FOLDER, `${ApiCallId}_style`, 2, 60)
                        .addState("voiceId", query.voiceId)
                        .addState("yemot_token", YEMOT_TOKEN);
                    break;
                } 
                
                // --- מוזיקה בהמתנה מופעלת עכשיו! ---
                // השרת נשאר פתוח ומחכה لج'מיני. ימות המשיח רואה שהשרת חושב, והיא תתחיל
                // לנגן את ztomao כפי שהגדרת ב-ext.ini!
                
                let emotionCue = "";
                if (styleChoice === "2") emotionCue = "Happy, upbeat, and very excited";
                else if (styleChoice === "3") emotionCue = "Serious, dramatic, and formal";

                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                const ttsAudioBuffer = await gemini.generateTTS(mainText, query.voiceId, emotionCue);
                
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

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
                        .addText("האם לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        .setReadConfig("UserChoiceAdditionalSave", 1, 1, 15) // ספרה אחת
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ. לשמירה בתיקייה הראשית הקישו אפס. ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderDefault", 15, 1, 15) // גמיש (שלוחה)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 5:
                // ====================================================================
                // שלב 5: חזרה מהקלטת הסגנון האישי - גם כאן המוזיקה מתנגנת בזמן ההמתנה
                // ====================================================================
                const styleBuffer = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_style.wav`);
                const customEmotionCue = await gemini.transcribeAudio(styleBuffer);
                const mainTextCustom = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
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
                        .addText("האם לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        .setReadConfig("UserChoiceAdditionalSave", 1, 1, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ. לשמירה בתיקייה הראשית הקישו אפס. ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderDefault", 15, 1, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 7:
                if (query.UserChoiceAdditionalSave === "1") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderCopy", 15, 1, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/");
                }
                break;

            case 8:  
            case 85: 
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                if (!targetFolder || targetFolder === "") { 
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/"); 
                    break; 
                }
                
                // הלקוח הקיש 0 כדי לשמור בתיקייה הראשית
                if (targetFolder === "0") targetFolder = "";
                
                const cleanFolder = targetFolder.replace(/\*/g, "/");
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder || "/");
                
                const uploadPath = cleanFolder ? `ivr2:/${cleanFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
                await yemot.uploadFile(uploadPath, ttsForSave);

                if (state === 85) { 
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText(`העותק נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addGoToFolder("/"); 
                } else { 
                    responseBuilder = new YemotBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו 1 לסיום הקישו 2")
                        .setReadConfig("SetDefaultChoice", 1, 1, 10)
                        .addState("targetFolder", cleanFolder)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 9:
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
