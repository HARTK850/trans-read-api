/**
 * @file api/index.js
 * @description מנהל השלבים (State Machine) של ה-IVR עבור Vercel Serverless.
 * קובץ זה תוכנן לספק את חווית המשתמש המהירה, הנקייה והמדויקת ביותר האפשרית בימות המשיח.
 * משתמש במחלקת YemotBuilder כדי ליצור תחביר שמונע שגיאות סריקה.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות סביבה וקונפיגורציה גלובלית
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [
    "YOUR_GEMINI_API_KEY_1"
];
const gemini = new GeminiManager(GEMINI_API_KEYS);

const TEMP_FOLDER = "/Temp_Gemini_App"; // תיקיית עבודה זמנית בימות

// ============================================================================
// מנוע לבניית מחרוזות לימות המשיח בצורה בטוחה
// ============================================================================
class YemotBuilder {
    constructor(action) {
        this.action = action; // 'read', 'id_list_message', 'go_to_folder'
        this.contentBlocks =[];
        this.params =[];
        this.nextState = {};
    }

    /**
     * הוספת הודעת טקסט להקראה. מנקה תווים אסורים שעלולים לשבור את הפקודה.
     */
    addText(text) {
        // מחיקת כל הנקודות, פסיקים ומקפים מהטקסט הפנימי כדי שימות לא יתבלבל!
        const cleanText = text.replace(/[-.(),]/g, "");
        this.contentBlocks.push(`t-${cleanText}`);
        return this;
    }

    /**
     * הוספת השמעת קובץ קיים
     */
    addFile(filePath) {
        this.contentBlocks.push(`f-${filePath}`);
        return this;
    }

    /**
     * הגדרת מאפייני בקשת קלט (עבור read) - מקפיד על ביטול "לאישור הקישו 1"
     */
    setReadConfig(varName, type, maxDigits, minDigits, timeout) {
        // הסדר המחמיר של ימות המשיח לפקודת read:
        // שם, האם להשתמש בקיים, סוג (Digits/record), מקסימום, מינימום, שניות חריגה, PlaybackType, בלוק כוכבית.
        // PlaybackType = No -> מבטל את השמעת "הקשת X, לאישור הקישו 1".
        this.params =[
            varName, 
            "no",           // useExisting
            type,           // Digits / record
            maxDigits, 
            minDigits, 
            timeout, 
            type === "Digits" ? "No" : "no", // Playback disabled!
            "yes"           // Block asterisk
        ];
        return this;
    }

    /**
     * הגדרת מאפיינים ייחודיים להקלטה (record)
     */
    setRecordConfig(varName, folder, fileName, minSec, maxSec) {
        // הסדר המדויק להקלטה: 
        // שם, קיים(no), סוג(record), נתיב, קובץ, אישור בסולמית(yes), שמירה בניתוק(yes), הוספה לקיים(no), מינימום, מקסימום.
        this.params =[
            varName,
            "no",
            "record",
            folder,
            fileName,
            "yes", // אישור בסולמית מיידי - מונע תפריט אישור של ימות!
            "yes", // חובה לשמור בניתוק
            "no",  // לא לשרשר לקובץ קודם
            minSec,
            maxSec
        ];
        return this;
    }

    /**
     * הוספת משתני סביבה שיוחזרו אלינו בקריאה הבאה (API Add)
     */
    addState(key, value) {
        this.nextState[key] = value;
        return this;
    }

    /**
     * הפקת המחרוזת הסופית והבטוחה
     */
    build() {
        let res = `${this.action}=`;
        
        // חיבור בלוקי התוכן עם נקודה (כמפריד פקודות של ימות בלבד)
        if (this.contentBlocks.length > 0) {
            res += this.contentBlocks.join('.');
        }

        // חיבור פרמטרי קלט אם ישנם (עבור read)
        if (this.params.length > 0) {
            res += "=" + this.params.join(',');
        }

        // שרשור API ADD
        let index = 0;
        for (const [key, value] of Object.entries(this.nextState)) {
            res += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
            index++;
        }
        return res;
    }
}

// ============================================================================
// פונקציית השרת (Serverless Request Handler)
// ============================================================================

module.exports = async function handler(req, res) {
    // איחוד כל פרמטרי הבקשה (תומך גם ב-GET וגם ב-POST של ימות המשיח)
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    // 1. חסימת ביצוע במקרה של דיווח ניתוק, מונע לולאות קטלניות!
    if (query.hangup === "yes") {
        console.log(`[Flow] שיחה نותקה. מזדהה: ${query.ApiCallId}. עוצר ביצוע.`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(""); 
    }

    // 2. אתחול מנהל ימות המשיח מהטוקן שמועבר אלינו
    const YEMOT_TOKEN = query.yemot_token;
    if (!YEMOT_TOKEN) {
        console.error("[Fatal Error] חסר טוקן של ימות המשיח בבקשה. המערכת תקרוס תכף.");
    }
    const yemot = new YemotManager(YEMOT_TOKEN);

    const ApiPhone = query.ApiPhone || "UnknownPhone";
    const ApiCallId = query.ApiCallId || "UnknownCallID";
    
    // 3. זיהוי חכם של שלב השיחה (Stateless Tracker)
    // אנחנו מזהים באיזה שלב אנחנו לפי הנתון האחרון שהלקוח הקיש ונוסף ל-URL.
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
    
    console.log(`[IVR Controller] התקבלה בקשה | שלב: ${state} | טלפון: ${ApiPhone} | מזהה: ${ApiCallId}`);

    try {
        let responseBuilder;

        switch (state) {
            case 0:
                // ====================================================================
                // שלב 0: הקלטת הטקסט המקורי.
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למערכת היצירה הקולית")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 1:
                // ====================================================================
                // שלב 1: עיבוד ההקלטה (DSP -> STT) ובקשת מין הקול.
                // *חווית משתמש:* דורשים 2 ספרות מדויקות ("01" או "02") כדי לדלג מיד בלי לאשר.
                // ====================================================================
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[Process] תומלל בהצלחה: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                        .setRecordConfig("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`, 2, 120)
                        .addState("yemot_token", YEMOT_TOKEN);
                    break;
                }

                // שמירת הטקסט לשימוש מאוחר יותר
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נקלט בהצלחה")
                    .addText("לבחירת קול של גבר הקישו אפס אחד")
                    .addText("לבחירת קול של אישה הקישו אפס שתיים")
                    .setReadConfig("VoiceGender", "Digits", 2, 2, 10) // Min=2, Max=2. לקוח חייב להקיש 01 או 02. מעבר מיידי!
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 2:
                // ====================================================================
                // שלב 2: פריסת תפריט הקולות. 
                // גם כאן, מינימום ומקסימום 2 ספרות כדי לקבל תגובה מהירה לחלוטין.
                // ====================================================================
                const isMale = query.VoiceGender === "01";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder("read").addText("אנא בחרו את הקול הרצוי");
                
                for (let i = 0; i < voices.length; i++) {
                    const digitStr = String(i + 1).padStart(2, '0'); // הופך 1 ל-"01"
                    const spokenDigitStr = digitStr.replace("0", "אפס "); // מקריא "אפס אחד"
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenDigitStr}`);
                }

                responseBuilder
                    .setReadConfig("VoiceIndex", "Digits", 2, 2, 15) // Max 2, Min 2.
                    .addState("gender", isMale ? "MALE" : "FEMALE")
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 3:
                // ====================================================================
                // שלב 3: בחירת הסגנון (4 אפשרויות) -> דורש 2 ספרות.
                // ====================================================================
                const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                // אבטחת טווח: אם הקיש משהו לא הגיוני, ניקח את הקול הראשון כברירת מחדל בלי לשגע אותו עם הודעות שגיאה
                const selectedVoiceId = (voiceIndex >= 0 && voiceIndex < voiceList.length) ? voiceList[voiceIndex].id : voiceList[0].id;

                responseBuilder = new YemotBuilder("read")
                    .addText("לבחירת סגנון רגיל הקישו אפס אחד")
                    .addText("לסגנון שמח ונלהב הקישו אפס שתיים")
                    .addText("לסגנון רציני הקישו אפס שלוש")
                    .addText("להגדרת סגנון מותאם אישית בהקלטה הקישו אפס ארבע")
                    .setReadConfig("StyleChoice", "Digits", 2, 2, 10) // 01, 02, 03, 04
                    .addState("voiceId", selectedVoiceId)
                    .addState("yemot_token", YEMOT_TOKEN);
                break;

            case 4:
                // ====================================================================
                // שלב 4: פיצול לוגיקה - הקלטה או הפקה מיידית
                // *חווית משתמש:* אנחנו לא משמיעים "אנא המתינו"! ימות תנגן מוזיקת המתנה לבד אם היא מוגדרת ב-ext.ini!
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
                
                // הלקוח בחר סגנון מובנה. מכינים את ה-Prompt Cue של ה-Emotion.
                let emotionCue = "";
                if (styleChoice === "02") emotionCue = "Happy, upbeat, and very excited";
                else if (styleChoice === "03") emotionCue = "Serious, dramatic, and formal";

                // משיכת הטקסט להקראה שישב לנו במערכת
                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // הפקת האודיו מ-Gemini (שימו לב: emotionCue עובר בפרומפט, לא ב-systemInstruction!)
                const ttsAudioBuffer = await gemini.generateTTS(mainText, query.voiceId, emotionCue);
                
                // שמירה בימות לתיקייה זמנית
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

                // ניתוב לשמירה בהתאם להעדפות
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
                        .setReadConfig("UserChoiceAdditionalSave", "Digits", 2, 2, 15) // 01, 02
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderDefault", "Digits", 15, 1, 15) // כאן מאפשרים אורך גמיש כי זו שלוחה
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 5:
                // ====================================================================
                // שלב 5: חזרה מהקלטת הסגנון האישי - ביצוע ההפקה
                // ====================================================================
                const styleBuffer = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_style.wav`);
                const customEmotionCue = await gemini.transcribeAudio(styleBuffer);
                const customText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                const customTTSBuffer = await gemini.generateTTS(customText, query.voiceId, customEmotionCue);
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
                        .setReadConfig("UserChoiceAdditionalSave", "Digits", 2, 2, 15) // 01, 02
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
                // הלקוח נשאל אם לשמור עותק נוסף
                if (query.UserChoiceAdditionalSave === "01") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .setReadConfig("TargetFolderCopy", "Digits", 15, 1, 15)
                        .addState("yemot_token", YEMOT_TOKEN);
                } else {
                    // הקיש 02 - חזרה לשורש המערכת
                    responseBuilder = new YemotBuilder("go_to_folder").addText("/");
                }
                break;

            case 8: // פעם ראשונה
            case 85: // שמירת עותק
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
                        .addText("העותק נשמר בהצלחה")
                        .addState("yemot_token", YEMOT_TOKEN);
                    // הוספה חכמה של go_to_folder באותה תשובה
                    yemotRes = responseBuilder.build() + "&go_to_folder=/";
                    break; // אנחנו מדלגים על ה-build הרגיל בסוף ויוצאים ישירות
                } else { 
                    responseBuilder = new YemotBuilder("read")
                        .addText("הקובץ נשמר בהצלחה")
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו אפס אחד לסיום הקישו אפס שתיים")
                        .setReadConfig("SetDefaultChoice", "Digits", 2, 2, 10) // 01, 02
                        .addState("targetFolder", cleanFolder)
                        .addState("yemot_token", YEMOT_TOKEN);
                }
                break;

            case 9:
                if (query.SetDefaultChoice === "01" && query.targetFolder) {
                    await yemot.uploadTextFile(`ivr2:/Preferences/${ApiPhone}.txt`, query.targetFolder.replace(/\*/g, "/"));
                    responseBuilder = new YemotBuilder("id_list_message").addText("שלוחת ברירת המחדל עודכנה בהצלחה תודה ולהתראות");
                } else {
                    responseBuilder = new YemotBuilder("id_list_message").addText("תודה ולהתראות");
                }
                yemotRes = responseBuilder.build() + "&go_to_folder=/";
                break;

            default:
                yemotRes = `go_to_folder=/`;
        }

        if (!yemotRes && responseBuilder) {
            yemotRes = responseBuilder.build();
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotRes);

    } catch (error) {
        console.error(`[IVR Critical Error]`, error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(`id_list_message=t-אירעה שגיאה במערכת ההמרה אנו מתנצלים&go_to_folder=/`);
    }
};
