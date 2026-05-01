/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR החכמה לתמלול והקראה.
 * מותאם אישית לקבלת טוקן ישירות מימות המשיח.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// קונפיגורציה והגדרות מערכת
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [
    "YOUR_GEMINI_API_KEY_1"
];

// בניית מנהל Gemini בלבד ברמה הגלובלית
const gemini = new GeminiManager(GEMINI_API_KEYS);

// נתיב זמני בימות המשיח לשמירת הקלטות שטרם עובדו
const TEMP_FOLDER = "ivr2:/Temp_Gemini_App";

// ============================================================================
// פונקציות עזר ליצירת תגובות בפורמט ימות המשיח
// ============================================================================

function buildYemotResponse(action, content, nextState = {}) {
    let response = `${action}=${content}`;
    
    let index = 0;
    for (const [key, value] of Object.entries(nextState)) {
        response += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
        index++;
    }
    return response;
}

// ============================================================================
// פונקציית הטיפול הראשית (Serverless Request Handler)
// ============================================================================

module.exports = async function handler(req, res) {
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    // הגדרת מנהל ימות המשיח דינמית לפי הטוקן שמגיע מהבקשה
    const YEMOT_TOKEN = query.yemot_token;
    if (!YEMOT_TOKEN) {
        console.error("[Error] חסר טוקן של ימות המשיח בבקשה!");
    }
    const yemot = new YemotManager(YEMOT_TOKEN);

    const ApiPhone = query.ApiPhone || "Unknown";
    const ApiCallId = query.ApiCallId || "UnknownCall";
    
    // קריאת המצב הנוכחי (State). אם אין, אנחנו בהתחלה (שלב 0)
    const state = parseInt(query.state || "0", 10);
    
    console.log(`[IVR Request] שיחה: ${ApiCallId}, טלפון: ${ApiPhone}, שלב: ${state}`);

    try {
        let yemotRes = "";

        switch (state) {
            case 0:
                yemotRes = buildYemotResponse(
                    "read", 
                    `t-ברוכים_הבאים_למערכת_היצירה_הקולית_הקליטו_את_הטקסט_שברצונכם_להקריא_ולאחר_מכן_הקישו_סולמית=UserAudioRecord,no,1,1,15,record,${TEMP_FOLDER},${ApiCallId}_main,no,yes,yes`,
                    { state: 1, yemot_token: YEMOT_TOKEN }
                );
                break;

            case 1:
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[STT Success] טקסט שתומלל: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-לא_הצלחנו_להבין_את_ההקלטה_אנא_נסו_שוב=UserAudioRecord,no,1,1,15,record,${TEMP_FOLDER},${ApiCallId}_main,no,yes,yes`,
                        { state: 1, yemot_token: YEMOT_TOKEN }
                    );
                    break;
                }

                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                yemotRes = buildYemotResponse(
                    "read",
                    `t-הטקסט_נקלט_בהצלחה_לבחירת_קול_של_גבר_הקישו_1_לבחירת_קול_של_אישה_הקישו_2=VoiceGender,no,1,1,10,Digits,no`,
                    { state: 2, yemot_token: YEMOT_TOKEN }
                );
                break;

            case 2:
                const genderChoice = query.VoiceGender;
                let isMale = genderChoice === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                let menuPrompt = "t-אנא_בחרו_את_הקול_הרצוי.";
                for (let i = 0; i < voices.length; i++) {
                    const descSafe = voices[i].desc.replace(/ /g, "_");
                    menuPrompt += `t-ל${descSafe}_הקישו_${i + 1}.`;
                }
                menuPrompt += "t-בסיום_הקישו_סולמית";

                yemotRes = buildYemotResponse(
                    "read",
                    `${menuPrompt}=VoiceIndex,no,2,1,15,Number,no`,
                    { state: 3, gender: isMale ? "MALE" : "FEMALE", yemot_token: YEMOT_TOKEN }
                );
                break;

            case 3:
                const selectedGender = query.gender;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                const voiceList = GEMINI_VOICES[selectedGender];

                if (isNaN(voiceIndex) || voiceIndex < 0 || voiceIndex >= voiceList.length) {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-בחירה_שגויה_נא_נסו_שוב=VoiceIndex,no,2,1,10,Number,no`,
                        { state: 3, gender: selectedGender, yemot_token: YEMOT_TOKEN }
                    );
                    break;
                }

                const selectedVoiceId = voiceList[voiceIndex].id;

                const styleMenu = `t-לבחירת_סגנון_רגיל_הקישו_1.t-לסגנון_שמח_ונלהב_הקישו_2.t-לסגנון_רציני_הקישו_3.t-להגדרת_סגנון_מותאם_אישית_בהקלטה_הקישו_4`;
                
                yemotRes = buildYemotResponse(
                    "read",
                    `${styleMenu}=StyleChoice,no,1,1,10,Digits,no`,
                    { state: 4, voiceId: selectedVoiceId, yemot_token: YEMOT_TOKEN }
                );
                break;

            case 4:
                const styleChoice = query.StyleChoice;
                const voiceId = query.voiceId;

                if (styleChoice === "4") {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-אנא_הקליטו_את_הנחיות_הבמאי_לסגנון_ההקראה_הרצוי_ולאחר_מכן_הקישו_סולמית=CustomStyleRecord,no,1,1,15,record,${TEMP_FOLDER},${ApiCallId}_style,no,yes,yes`,
                        { state: 5, voiceId: voiceId, styleType: "custom", yemot_token: YEMOT_TOKEN }
                    );
                } else {
                    let systemInstruction = "";
                    if (styleChoice === "2") systemInstruction = "שמח, נלהב, קצבי ומלא אנרגיה";
                    if (styleChoice === "3") systemInstruction = "רציני, דרמטי, קודר ורשמי";
                    
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-אנו_מייצרים_כעת_את_קובץ_השמע_זה_עשוי_לקחת_מספר_שניות_להמשך_הקישו_1=ContinueToTTS,no,1,1,1,Digits,no`,
                        { state: 6, voiceId: voiceId, sysInst: systemInstruction, yemot_token: YEMOT_TOKEN }
                    );
                }
                break;

            case 5:
                const styleVoiceId = query.voiceId;
                const styleRecordPath = `${TEMP_FOLDER}/${ApiCallId}_style.wav`;
                const styleAudioBuffer = await yemot.downloadFile(`ivr2:${styleRecordPath}`);
                
                const transcribedStyleText = await gemini.transcribeAudio(styleAudioBuffer);
                console.log(`[STT Custom Style] סגנון מותאם אישית: ${transcribedStyleText}`);

                yemotRes = buildYemotResponse(
                    "read",
                    `t-הנחיית_הסגנון_נקלטה_אנו_מייצרים_את_קובץ_השמע_להמשך_הקישו_1=ContinueToTTS,no,1,1,1,Digits,no`,
                    { state: 6, voiceId: styleVoiceId, sysInst: transcribedStyleText, yemot_token: YEMOT_TOKEN }
                );
                break;

            case 6:
                const finalVoiceId = query.voiceId;
                const sysInst = query.sysInst || "";

                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                if (!mainText) {
                    throw new Error("הטקסט המקורי לא נמצא, ייתכן שהזמן תם.");
                }

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

                    const promptToUser = `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ_הושמע_ונשמר_בהצלחה_בשלוחה_${folder.replace(/\//g, "_")}_כקובץ_מספר_${nextFileName}.t-האם_לשמור_במיקום_נוסף_לאישור_הקישו_1_לביטול_וחזרה_לתפריט_הראשי_הקישו_2`;

                    yemotRes = buildYemotResponse(
                        "read",
                        `${promptToUser}=UserChoiceAdditionalSave,no,1,1,15,Digits,no`,
                        { state: 7, yemot_token: YEMOT_TOKEN }
                    );
                } else {
                    yemotRes = buildYemotResponse(
                        "read",
                        `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ_הושמע_בהצלחה_הקישו_את_מספר_השלוחה_בה_תרצו_לשמור_את_הקובץ_ובסיום_הקישו_סולמית=TargetFolder,no,1,10,15,Digits,no`,
                        { state: 8, yemot_token: YEMOT_TOKEN }
                    );
                }
                break;

            case 7:
                const userChoiceAdd = query.UserChoiceAdditionalSave;
                if (userChoiceAdd === "2") {
                    yemotRes = `go_to_folder=/`; 
                } else if (userChoiceAdd === "1") {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-הקישו_את_מספר_השלוחה_עבור_העותק_הנוסף_ובסיום_הקישו_סולמית=TargetFolder,no,1,10,15,Digits,no`,
                        { state: 8, skipDefaultPrompt: "yes", yemot_token: YEMOT_TOKEN }
                    );
                } else {
                    yemotRes = `go_to_folder=/`;
                }
                break;

            case 8:
                let targetFolder = query.TargetFolder;
                if (!targetFolder) {
                    yemotRes = `go_to_folder=/`;
                    break;
                }
                
                const cleanFolder = targetFolder.replace(/\*/g, "/");

                const ttsAudioBufferForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);

                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder);
                const destPath = `ivr2:/${cleanFolder}/${seqFileName}.wav`;

                await yemot.uploadFile(destPath, ttsAudioBufferForSave);

                const skipDefaultPrompt = query.skipDefaultPrompt === "yes";

                if (skipDefaultPrompt) {
                    yemotRes = `id_list_message=t-העותק_נשמר_בהצלחה_בשלוחה_${cleanFolder.replace(/\//g, "_")}_כקובץ_מספר_${seqFileName}.&go_to_folder=/`;
                } else {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-הקובץ_נשמר_בהצלחה_בשלוחה_${cleanFolder.replace(/\//g, "_")}_כקובץ_מספר_${seqFileName}.t-האם_תרצו_להגדיר_שלוחה_זו_כברירת_המחדל_לשמירות_הבאות_לאישור_הקישו_1_לסיום_הקישו_2=SetDefaultChoice,no,1,1,10,Digits,no`,
                        { state: 9, targetFolder: cleanFolder, yemot_token: YEMOT_TOKEN }
                    );
                }
                break;

            case 9:
                const setDefault = query.SetDefaultChoice;
                const folderToSave = query.targetFolder;

                if (setDefault === "1" && folderToSave) {
                    const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                    await yemot.uploadTextFile(prefPath, folderToSave);
                    
                    yemotRes = `id_list_message=t-שלוחת_ברירת_המחדל_עודכנה_בהצלחה_תודה_ולהתראות.&go_to_folder=/`;
                } else {
                    yemotRes = `id_list_message=t-תודה_ולהתראות.&go_to_folder=/`;
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
        res.status(200).send(`id_list_message=t-אירעה_שגיאה_במערכת_ההמרה_אנו_מתנצלים.&go_to_folder=/`);
    }
};
