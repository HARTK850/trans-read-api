/**
 * @file api/index.js
 * @version 19.0.0 (Ultimate Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * 
 * 1. סידור מדויק של פרמטרי פקודת Read כדי למנוע את שגיאת "לא הקשתם מינימום".
 * 2. הסרה מוחלטת של "לאישור הקישו 1" על ידי הזנת "No" בפרמטר השביעי (PlaybackType).
 * 3. תפריט הקלטה מקורי של ימות (1 שמיעה, 2 אישור) הוחזר לפעולה.
 * 4. AI מזהה טון מההקלטה. אין יותר תפריט בחירת סגנון ארוך.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :[ "YOUR_DEFAULT_API_KEY_HERE" ];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות לתקן המחמיר של ימות המשיח
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action;
        this.contentBlocks = [];
        this.params = [];
        this.nextState = {};
        this.goToFolder = null;
    }

    cleanYemotText(text) {
        if (!text) return "";
        return text.toString()
            .replace(/[.,-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    addText(text) {
        const clean = this.cleanYemotText(text);
        if (clean) {
            this.contentBlocks.push(`t-${clean}`);
        }
        return this;
    }

    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    setReadDigitsAdvanced(
        varName,
        maxDigits,
        minDigits,
        timeout,
        disableConfirmation = true,
        allowStar = true,
        allowZero = true
    ) {
        this.params = [
            varName,                      // 1
            "no",                         // 2
            maxDigits.toString(),         // 3
            minDigits.toString(),         // 4
            timeout.toString(),           // 5
            "Digits",                     // 6
            disableConfirmation ? "No" : "Ok", // 7
            allowStar ? "yes" : "no",     // 8
            allowZero ? "yes" : "no"      // 9
        ];
        return this;
    }

    setRecordInput(varName, folder, fileName) {
        this.params = [
            varName,
            "no",
            "record",
            folder,
            fileName,
            "no",
            "yes",
            "no"
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

    if (this.action === "read") {
        res = `read=${textPart}`;

        if (this.params.length > 0) {
            res += `=${this.params.join(',')}`;
        }

    } else if (this.action === "id_list_message") {
        res = `id_list_message=${textPart}`;

    } else if (this.action === "go_to_folder") {
        res = `go_to_folder=${this.goToFolder || "/"}`;
    }

    // api_add
    let index = 0;
    for (const [key, value] of Object.entries(this.nextState)) {
        res += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
        index++;
    }

    if (this.goToFolder && this.action !== "go_to_folder") {
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
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "TargetFolderDefault", "TargetFolderCopy", "SetDefaultChoice", "WantCopySave"];
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
        
        // הגנת ניתוק - מונע שידור בחזרה לימות המשיח במקרה של טורק-טלפון
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
        
        // --- ניהול שלבים (State Machine) חכם וחסין באגים ---
        let state = 0;
        if (query.SetDefaultChoice !== undefined) state = 5;
        else if (query.TargetFolderCopy !== undefined) state = 55;
        else if (query.WantCopySave !== undefined) state = 4;
        else if (query.TargetFolderDefault !== undefined) state = 3;
        else if (query.VoiceIndex !== undefined) state = 2;
        else if (query.VoiceGender !== undefined) state = 1;
        else if (query.UserAudioRecord !== undefined) state = 100;

        TelemetryLogger.info("FlowController", "StateDetection", `שלב מזוהה: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת ובקשת הקלטה.
                // ====================================================================
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם")
                    .addText("אנא הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 100:
                // ====================================================================
                // שלב 1: STT חכם (עם ניתוח טון) ומעבר לבחירת גבר/אישה (ספרה 1 בלבד)
                // הלקוח מקיש 1 או 2 וטס הלאה בלי אישור.
                // ====================================================================
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                // ההקלטה מתומללת ע"י ה-AI שמבין את הטון בעצמו!
                const transcribedTextWithEmotion = await gemini.transcribeAudioWithEmotion(mainAudioBuffer);
                TelemetryLogger.info("MainHandler", "STT", `תומלל בהצלחה: ${transcribedTextWithEmotion}`);

                if (!transcribedTextWithEmotion || transcribedTextWithEmotion.length < 2) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    break;
                }

                // שמירת הטקסט בקובץ (כולל ההוראות בסוגריים) כדי לשלוף בשלב ה-TTS
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedTextWithEmotion);

                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול קריין גברי הקישו 1 לבחירת קול קריינית נשי הקישו 2")
                    // מקסימום 1, מינימום 1, ללא אישור (AskNo מופעל אוטומטית), חוסם אפס (allowZero=false)
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false); 
                break;

            case 1:
                // ====================================================================
                // שלב 2: תפריט הקולות הייעודי (15 קולות) - הקראת "אפס אחד"
                // ====================================================================
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false); 
                    break;
                }

                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
                
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; // הקראת "אפס אחד"
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }
                
                responseBuilder.addText("ובסיום הקישו סולמית");

                // מקסימום 2, מינימום 2. הלקוח מקיש "01" ועף הלאה!
                responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false);
                break;

            case 2:
                // ====================================================================
                // שלב 3: הלקוח בחר קול - יצירת ה-TTS המיידי (הסגנון מוסק אוטומטית)
                // השרת חושב בשקט. ימות תנגן את ztomao בינתיים!
                // ====================================================================
                const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                
                if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false);
                    break;
                }

                const selectedVoiceId = voiceListCheck[checkIdx].id;
                
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // ה-AI מייצר את ההקראה! (WavEncoder מבטיח שהקובץ תקין לטלפון)
                const ttsBuffer = await gemini.generateTTS(mainTextForTTS, selectedVoiceId);
                
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsBuffer);

                // ניתוב לשמירה
                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileNum = await yemot.getNextSequenceFileName(folder);
                    const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
                    
                    // שמירה אקטיבית ליעד המועדף
                    await yemot.uploadFile(finalPath, ttsBuffer);

                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`) 
                        .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
                        .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        // ספרה 1 בלבד, ללא אישור
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                } else {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                        .addText("נא הקישו את מספר השלוחה לשמירה למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        // מתיר אפס, מתיר כוכבית, ואנחנו נמיר כוכבית לסלש בפונקציית העזר שלנו 
                        // מקסימום 20, מינימום 1
                        .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true);
                }
                break;

            case 3:
                // ====================================================================
                // שלב 4: הלקוח (הוותיק) נשאל האם הוא מעוניין בעותק נוסף
                // ====================================================================
                if (query.WantCopySave === "1") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, true, true);
                } else if (query.WantCopySave === "2") {
                    responseBuilder = new YemotCommandBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                } else {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("לאישור יצירת עותק בשלוחה שאינה ברירת מחדל הקישו 1 לביטול הקישו 2")
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                }
                break;

            case 4:  // שמירה רגילה
            case 55: // שמירת עותק
                // ====================================================================
                // שלב 5 + 55: תיוק הקובץ בשלוחת היעד 
                // ====================================================================
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                
                if (targetFolder === undefined) { 
                    responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/"); 
                    break; 
                }
                
                if (targetFolder === "0") {
                    targetFolder = "";
                }
                
                const cleanFolder = cleanAndSanitizeFolder(targetFolder); 
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder || "/");
                
                const uploadPath = cleanFolder ? `ivr2:/${cleanFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
                await yemot.uploadFile(uploadPath, ttsForSave);

                if (state === 55) { 
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText(`העותק נשמר בהצלחה כקובץ מספר ${seqFileName} תודה ולהתראות`)
                        .addGoToFolder("/"); 
                } else { 
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                        .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו 1 לסיום הקישו 2")
                        .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false);
                }
                break;

            case 5:
                // ====================================================================
                // שלב 6: עדכון מועדפים במסד הנתונים ופרידה
                // ====================================================================
                if (query.SetDefaultChoice === "1" && query.TargetFolderDefault !== undefined) {
                    const prefPathTxt = `ivr2:/Preferences/${ApiPhone}.txt`;
                    const finalPrefs = cleanAndSanitizeFolder(query.TargetFolderDefault);
                    await yemot.uploadTextFile(prefPathTxt, finalPrefs);
                    
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("שלוחת ברירת המחדל עודכנה בהצלחה תודה ולהתראות")
                        .addGoToFolder("/");
                } else {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("תודה ולהתראות")
                        .addGoToFolder("/");
                }
                break;

            default:
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
        }

        // בניית תגובה סופית ושמירת משתני המצב לאורך כל השיחה
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
        TelemetryLogger.error("MainHandler", "CriticalError", "קריסת שרת:", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה קריטית במערכת אנו מתנצלים&go_to_folder=/");
    }
};
