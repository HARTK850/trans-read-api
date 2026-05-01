/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR החכמה לתמלול והקראה.
 * עובד בשיטת "צבירת משתנים" טבעית של ימות המשיח למניעת לולאות שגיאה.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// קונפיגורציה והגדרות מערכת
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') :[
    "YOUR_GEMINI_API_KEY_1"
];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; // נתיב זמני (ללא ivr2: בפקודת ההקלטה)

// פונקציית עזר לניקוי טקסט מסימנים שגורמים לימות המשיח לקרוס
function cleanYemotText(text) {
    return text.replace(/[-.(),]/g, "");
}

// ============================================================================
// פונקציית הטיפול הראשית
// ============================================================================

module.exports = async function handler(req, res) {
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    // 1. עצירת פעולה מיידית אם הלקוח ניתק את השיחה (מונע שגיאות שרת ולולאות)
    if (query.hangup === "yes") {
        console.log(`[Hangup] שיחה نותקה על ידי הלקוח.`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(""); 
    }

    const YEMOT_TOKEN = query.yemot_token;
    if (!YEMOT_TOKEN) {
        console.error("[Error] חסר טוקן של ימות המשיח בבקשה!");
    }
    const yemot = new YemotManager(YEMOT_TOKEN);

    const ApiPhone = query.ApiPhone || "Unknown";
    const ApiCallId = query.ApiCallId || "UnknownCall";
    
    // ============================================================================
    // זיהוי שלב השיחה (State) מתוך המשתנים שימות המשיח צברה ב-URL
    // ============================================================================
    let state = 0;
    if (query.SetDefaultChoice) state = 9;
    else if (query.TargetFolderCopy) state = 85; // שלב 8.5 (עותק נוסף)
    else if (query.TargetFolderDefault) state = 8;
    else if (query.UserChoiceAdditionalSave) state = 7;
    else if (query.ContinueToTTS) state = 6;
    else if (query.CustomStyleRecord) state = 5;
    else if (query.StyleChoice) state = 4;
    else if (query.VoiceIndex) state = 3;
    else if (query.VoiceGender) state = 2;
    else if (query.UserAudioRecord) state = 1;
    
    console.log(`[IVR Request] שיחה: ${ApiCallId}, טלפון: ${ApiPhone}, זוהה שלב: ${state}`);

    try {
        let yemotRes = "";

        switch (state) {
            case 0:
                // שלב 0: בקשת הקלטה. (פרמטרים: שם משתנה, לא להשתמש בקיים, סוג הקלטה, תיקייה, שם קובץ, אישור מיידי בסולמית, שמירה בניתוק, לא להוסיף לקובץ קיים, מינימום 2 שניות, מקסימום 120)
                yemotRes = `read=t-ברוכים הבאים למערכת היצירה הקולית.t-הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית=UserAudioRecord,no,record,${TEMP_FOLDER},${ApiCallId}_main,yes,yes,no,2,120`;
                break;

            case 1:
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[STT Success] טקסט שתומלל: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    yemotRes = `read=t-לא הצלחנו להבין את ההקלטה אנא נסו שוב=UserAudioRecord,no,record,${TEMP_FOLDER},${ApiCallId}_main,yes,yes,no,2,120`;
                    break;
                }

                // שומרים את הטקסט במערכת כדי למשוך אותו בשלב ה-TTS
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                // מעבר לבחירת גבר/אישה (Digits)
                yemotRes = `read=t-הטקסט נקלט בהצלחה.t-לבחירת קול של גבר הקישו 1.t-לבחירת קול של אישה הקישו 2=VoiceGender,no,Digits,1,1,10,No,yes`;
                break;

            case 2:
                const genderChoice = query.VoiceGender;
                let isMale = genderChoice === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                let menuPrompt = "t-אנא בחרו את הקול הרצוי";
                for (let i = 0; i < voices.length; i++) {
                    const safeDesc = cleanYemotText(voices[i].desc);
                    menuPrompt += `.t-ל${safeDesc} הקישו ${i + 1}`;
                }
                menuPrompt += ".t-בסיום הקישו סולמית";

                yemotRes = `read=${menuPrompt}=VoiceIndex,no,Digits,2,1,15,No,yes`;
                break;

            case 3:
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                const voiceList = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;

                if (isNaN(voiceIndex) || voiceIndex < 0 || voiceIndex >= voiceList.length) {
                    // אם הקיש מספר לא חוקי, ניתן לו קול ברירת מחדל כדי לא לתקוע את המערכת
                    console.log(`[Warning] בחירה שגויה של קול (${query.VoiceIndex}), ממשיך עם קול ברירת מחדל.`);
                }

                const styleMenu = `t-לבחירת סגנון רגיל הקישו 1.t-לסגנון שמח ונלהב הקישו 2.t-לסגנון רציני הקישו 3.t-להגדרת סגנון מותאם אישית בהקלטה הקישו 4`;
                yemotRes = `read=${styleMenu}=StyleChoice,no,Digits,1,1,10,No,yes`;
                break;

            case 4:
                const styleChoice = query.StyleChoice;

                if (styleChoice === "4") {
                    // הקלטת סגנון
                    yemotRes = `read=t-אנא הקליטו את הנחיות הבמאי לסגנון ההקראה הרצוי ולאחר מכן הקישו סולמית=CustomStyleRecord,no,record,${TEMP_FOLDER},${ApiCallId}_style,yes,yes,no,2,60`;
                } else {
                    // מדלגים ישר ליצירת TTS
                    yemotRes = `read=t-אנו מייצרים כעת את קובץ השמע.t-זה עשוי לקחת מספר שניות.t-להמשך הקישו 1=ContinueToTTS,no,Digits,1,1,15,No,yes`;
                }
                break;

            case 5:
                const styleRecordPath = `${TEMP_FOLDER}/${ApiCallId}_style.wav`;
                const styleAudioBuffer = await yemot.downloadFile(`ivr2:${styleRecordPath}`);
                const transcribedStyleText = await gemini.transcribeAudio(styleAudioBuffer);
                console.log(`[STT Custom Style] סגנון מותאם אישית: ${transcribedStyleText}`);

                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_styletext.txt`, transcribedStyleText);

                yemotRes = `read=t-הנחיית הסגנון נקלטה אנו מייצרים את קובץ השמע.t-להמשך הקישו 1=ContinueToTTS,no,Digits,1,1,15,No,yes`;
                break;

            case 6:
                // שליפת נתונים רטרואקטיבית מה-URL שהצטבר
                const vList = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const vIndex = parseInt(query.VoiceIndex, 10) - 1;
                const finalVoiceId = (vIndex >= 0 && vIndex < vList.length) ? vList[vIndex].id : vList[0].id;
                
                let sysInst = "";
                if (query.StyleChoice === "2") sysInst = "שמח, נלהב, קצבי ומלא אנרגיה";
                else if (query.StyleChoice === "3") sysInst = "רציני, דרמטי, קודר ורשמי";
                else if (query.StyleChoice === "4") sysInst = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_styletext.txt`);

                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                if (!mainText) throw new Error("הטקסט המקורי לא נמצא.");

                const ttsAudioBuffer = await gemini.generateTTS(mainText, finalVoiceId, sysInst);

                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileName = await yemot.getNextSequenceFileName(folder);
                    const finalSavedPath = `ivr2:/${folder}/${nextFileName}.wav`;
                    
                    await yemot.uploadFile(finalSavedPath, ttsAudioBuffer);

                    const promptToUser = `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע ונשמר בהצלחה בשלוחה.t-האם לשמור במיקום נוסף לאישור הקישו 1 לביטול וחזרה לתפריט הראשי הקישו 2`;
                    yemotRes = `read=${promptToUser}=UserChoiceAdditionalSave,no,Digits,1,1,15,No,yes`;
                } else {
                    yemotRes = `read=f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע בהצלחה.t-הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית=TargetFolderDefault,no,Digits,15,1,15,No,yes`;
                }
                break;

            case 7:
                if (query.UserChoiceAdditionalSave === "1") {
                    yemotRes = `read=t-הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית=TargetFolderCopy,no,Digits,15,1,15,No,yes`;
                } else {
                    yemotRes = `go_to_folder=/`;
                }
                break;

            case 8: // הגעה משמירה בפעם הראשונה
            case 85: // הגעה משמירת עותק נוסף
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                if (!targetFolder) {
                    yemotRes = `go_to_folder=/`;
                    break;
                }
                
                const cleanFolder = targetFolder.replace(/\*/g, "/");
                const ttsAudioBufferForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);

                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder);
                const destPath = `ivr2:/${cleanFolder}/${seqFileName}.wav`;

                await yemot.uploadFile(destPath, ttsAudioBufferForSave);

                if (state === 85) { // עותק נוסף
                    yemotRes = `id_list_message=t-העותק נשמר בהצלחה כקובץ מספר ${seqFileName}&go_to_folder=/`;
                } else { // פעם ראשונה
                    yemotRes = `read=t-הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}.t-האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו 1 לסיום הקישו 2=SetDefaultChoice,no,Digits,1,1,10,No,yes`;
                }
                break;

            case 9:
                if (query.SetDefaultChoice === "1" && query.TargetFolderDefault) {
                    const folderToSave = query.TargetFolderDefault.replace(/\*/g, "/");
                    const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                    await yemot.uploadTextFile(prefPath, folderToSave);
                    yemotRes = `id_list_message=t-שלוחת ברירת המחדל עודכנה בהצלחה תודה ולהתראות&go_to_folder=/`;
                } else {
                    yemotRes = `id_list_message=t-תודה ולהתראות&go_to_folder=/`;
                }
                break;

            default:
                yemotRes = `go_to_folder=/`;
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotRes);

    } catch (error) {
        console.error(`[IVR Critical Error] ${error.message}`, error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(`id_list_message=t-אירעה שגיאה במערכת ההמרה אנו מתנצלים&go_to_folder=/`);
    }
};
