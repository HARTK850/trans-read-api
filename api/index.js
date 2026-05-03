/**
 * @file api/index.js
 * @version 8.0.0 (Ultimate Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות סביבה (Environment Variables) וקונפיגורציה
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App";

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות ל-API של ימות המשיח (YemotBuilder)
// ============================================================================
class YemotBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks = []; 
        this.params =[]; 
        this.goToFolder = null; 
    }

    /**
     * פונקציה ממוקדת לניקוי הטקסט.
     * מסירה רק נקודות (.) ומקפים (-) ששוברים את הפקודות של ימות המשיח, 
     * אך משאירה רווחים כדי שה-TTS של ימות המשיח יקריא את המילים בצורה ברורה!
     */
    cleanYemotText(text) {
        if (!text) return "";
        return text.toString().replace(/[.,-]/g, " ").replace(/\s+/g, " ").trim();
    }

    addText(text) {
        const cleanStr = this.cleanYemotText(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    /**
     * פונקציה חכמה להגדרת בקשת ספרות (Digits) בסדר המדויק למניעת באגים.
     * @param {string} varName - שם המשתנה שיוחזר לשרת
     * @param {number} maxDigits - מקסימום ספרות
     * @param {number} minDigits - מינימום ספרות (מומלץ 1)
     * @param {number} timeout - שניות להמתנה לפני Timeout
     * @param {boolean} disableConfirmation - אם true, שולח AskNo כדי לבטל 'לאישור הקישו 1'
     * @param {boolean} allowAsterisk - חסימת כוכבית
     * @param {boolean} allowZero - חסימת אפס (חובה לאפשר אם שומרים תיקייה)
     * @param {boolean} autoReplaceAsteriskWithSlash - ממיר כוכבית לסלש (לנתיבים)
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowAsterisk = false, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        // בימות המשיח - כדי למנוע את 'לאישור הקישו 1' צריך להכניס את המילה AskNo בפרמטר השביעי!
        const playType = disableConfirmation ? "AskNo" : "Digits";
        const blockAsterisk = allowAsterisk ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes";
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";

        this.params =[
            varName,               // 1. פרמטר
            "no",                  // 2. להשתמש בקיים
            "Digits",              // 3. סוג
            maxDigits.toString(),  // 4. מקסימום
            minDigits.toString(),  // 5. מינימום
            timeout.toString(),    // 6. זמן המתנה
            playType,              // 7. צורת השמעה (AskNo מבטל 'לאישור הקישו 1')
            blockAsterisk,         // 8. חסימת כוכבית
            blockZero,             // 9. חסימת אפס
            replaceChar,           // 10. החלפת כוכבית בסלש
            "",                    // 11. מקשים מורשים
            "",                    // 12. כמות פעמים לפני יציאה
            "",                    // 13. המשך אם ריק
            "",                    // 14. מודל מקלדת
            "no"                   // 15. אישור הקשה נוסף (NO)
        ];
        return this;
    }

    /**
     * הגדרת קלט מסוג הקלטה (Record). מפעיל את תפריט ההקלטה הסטנדרטי המלא.
     */
    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   // 1. שם המשתנה 
            "no",      // 2. שימוש בקיים
            "record",  // 3. סוג (הקלטה קולית)
            folder,    // 4. תיקייה
            fileName,  // 5. שם קובץ
            "",        // 6. ביטול תפריט אישור? ריק אומר *כן* להשמיע תפריט מלא (1 לשמיעה, 2 לאישור וכו')
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. שרשור לקובץ קיים
        ];
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

// ============================================================================
// ליבת המערכת - State Machine Controller
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        const ApiPhone = query.ApiPhone || "UnknownPhone";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        // הגנת ניתוק
        if (query.hangup === "yes") {
            console.log(`[Hangup Event] המאזין ניתק את השיחה. עוצר הליכים.`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        if (!YEMOT_TOKEN) {
            console.error("חסר YEMOT_TOKEN!");
            return res.status(200).send("id_list_message=t-תקלה במערכת&hangup=yes");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        
        // --- ניהול שלבים (State Machine) חכם ---
        let state = 1;
        if (query.SetDefaultChoice !== undefined) state = 6;
        else if (query.TargetFolderCopy !== undefined) state = 55;
        else if (query.TargetFolderDefault !== undefined) state = 5;
        else if (query.WantCopySave !== undefined) state = 4;
        else if (query.VoiceIndex !== undefined) state = 3;
        else if (query.VoiceGender !== undefined) state = 2;

        console.log(`[Flow Controller] שלב: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            case 1:
                // ====================================================================
                // שלב 1: פתיח המערכת והקלטת הודעת המקור
                // ====================================================================
                responseBuilder = new YemotBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 2:
                // ====================================================================
                // שלב 2: תמלול (STT) של ההקלטה, ובחירת גבר/אישה (1 ספרה)
                // ====================================================================
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                const transcribedText = await gemini.transcribeAudio(mainAudioBuffer);
                
                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    break;
                }

                console.log(`[STT] תומלל: ${transcribedText}`);
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                responseBuilder = new YemotBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול קריין גברי הקישו 1 לבחירת קול קריינית נשית הקישו 2")
                    // 1 מקסימום, 1 מינימום. ללא "לאישור הקישו 1".
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false); 
                break;

            case 3:
                // ====================================================================
                // שלב 3: המאזין בחר מגדר - מקריאים לו את תפריט הקולות (2 ספרות)
                // ====================================================================
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false, false); 
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

                // מחייב 2 ספרות (למשל 01). מבטל "לאישור הקישו 1".
                responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false, false);
                break;

            case 4:
                // ====================================================================
                // שלב 4: הלקוח בחר קול - יצירת ה-TTS המיידי (הסגנון מוסק אוטומטית)
                // ====================================================================
                const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                    responseBuilder = new YemotBuilder("read")
                        .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false, false, false);
                    break;
                }

                const selectedVoiceId = voiceListCheck[checkIdx].id;
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                // השרת עכשיו חושב ומפיק את ה-TTS. המוזיקה ששמת ב-ext.ini תנגן!
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
                        .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה לתפריט הראשי הקישו 2")
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 15, true, false, false, false);
                } else {
                    responseBuilder = new YemotBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts`)
                        .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                        .addText("נא הקישו את מספר השלוחה לשמירה למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        // מתיר אפס, מתיר כוכבית, ממיר כוכבית לסלש אוטומטית. (20 ספרות מקסימום, 1 מינימום)
                        .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true, true);
                }
                break;

            case 5:
                // ====================================================================
                // שלב 5: (ללא ברירת מחדל קודמת) תיוק בנתיב המבוקש ובקשת קביעת ברירת מחדל
                // ====================================================================
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
                    .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                    .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו 1 לסיום הקישו 2")
                    .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false, false);
                break;

            case 55:
                // ====================================================================
                // שלב 5.5: (יש ברירת מחדל קודמת) הלקוח רוצה לשמור עותק בנתיב שונה
                // ====================================================================
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
                    .addText(`העותק נשמר בהצלחה כקובץ מספר ${copyFileName} תודה ולהתראות`)
                    .addGoToFolder("/");
                break;

            case 6:
                // ====================================================================
                // שלב 6: שמירת העדפת ברירת המחדל וסיום השיחה.
                // ====================================================================
                if (query.SetDefaultChoice === "1" && query.TargetFolderDefault !== undefined) {
                    const prefPathTxt = `ivr2:/Preferences/${ApiPhone}.txt`;
                    const safeSavedFolder = cleanAndSanitizeFolder(query.TargetFolderDefault);
                    
                    await yemot.uploadTextFile(prefPathTxt, safeSavedFolder);
                    
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
            
            // שימור המשתנים שהצטברו לאורך הדרך כדי שה-State ישמר
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
