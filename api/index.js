/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR החכמה לתמלול והקראה.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

// ============================================================================
// קונפיגורציה והגדרות מערכת
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [
    "YOUR_GEMINI_API_KEY_1"
];

// בניית מנהל Gemini
const gemini = new GeminiManager(GEMINI_API_KEYS);

// נתיב זמני בימות המשיח לשמירת הקלטות שטרם עובדו (ללא הקידומת ivr2: עבור פקודת ההקלטה)
const TEMP_FOLDER = "/Temp_Gemini_App";

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

    const YEMOT_TOKEN = query.yemot_token;
    if (!YEMOT_TOKEN) {
        console.error("[Error] חסר טוקן של ימות המשיח בבקשה!");
    }
    const yemot = new YemotManager(YEMOT_TOKEN);

    const ApiPhone = query.ApiPhone || "Unknown";
    const ApiCallId = query.ApiCallId || "UnknownCall";
    
    const state = parseInt(query.state || "0", 10);
    
    console.log(`[IVR Request] שיחה: ${ApiCallId}, טלפון: ${ApiPhone}, שלב: ${state}`);

    try {
        let yemotRes = "";

        switch (state) {
            case 0:
                // שלב 0: הקלטת הטקסט.
                // פרמטרים לפי התיעוד: 1:שם, 2:שימוש_בקיים(no), 3:סוג(record), 4:נתיב, 5:שם_קובץ, 6:סיום_בסולמית(yes), 7:שמירה_בניתוק(yes), 8:הוספה_לקיים(no), 9:מינימום_שניות, 10:מקסימום_שניות
                yemotRes = buildYemotResponse(
                    "read", 
                    `t-ברוכים הבאים למערכת היצירה הקולית. הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית=UserAudioRecord,no,record,${TEMP_FOLDER},${ApiCallId}_main,yes,yes,no,2,120`,
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
                        `t-לא הצלחנו להבין את ההקלטה אנא נסו שוב=UserAudioRecord,no,record,${TEMP_FOLDER},${ApiCallId}_main,yes,yes,no,2,120`,
                        { state: 1, yemot_token: YEMOT_TOKEN }
                    );
                    break;
                }

                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                // פרמטרי Digits: 1:שם, 2:קיים(no), 3:סוג(Digits), 4:מקסימום_ספרות(1), 5:מינימום(1), 6:זמן_המתנה(10), 7:הקראה_חזרה(No), 8:חסימת_כוכבית(yes)
                yemotRes = buildYemotResponse(
                    "read",
                    `t-הטקסט נקלט בהצלחה. t-לבחירת קול של גבר הקישו 1. t-לבחירת קול של אישה הקישו 2=VoiceGender,no,Digits,1,1,10,No,yes`,
                    { state: 2, yemot_token: YEMOT_TOKEN }
                );
                break;

            case 2:
                const genderChoice = query.VoiceGender;
                let isMale = genderChoice === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                let menuPrompt = "t-אנא בחרו את הקול הרצוי. ";
                for (let i = 0; i < voices.length; i++) {
                    menuPrompt += `t-ל${voices[i].desc} הקישו ${i + 1}. `;
                }
                menuPrompt += "t-בסיום הקישו סולמית";

                yemotRes = buildYemotResponse(
                    "read",
                    `${menuPrompt}=VoiceIndex,no,Digits,2,1,15,No,yes`,
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
                        `t-בחירה שגויה נא נסו שוב=VoiceIndex,no,Digits,2,1,10,No,yes`,
                        { state: 3, gender: selectedGender, yemot_token: YEMOT_TOKEN }
                    );
                    break;
                }

                const selectedVoiceId = voiceList[voiceIndex].id;

                const styleMenu = `t-לבחירת סגנון רגיל הקישו 1. t-לסגנון שמח ונלהב הקישו 2. t-לסגנון רציני הקישו 3. t-להגדרת סגנון מותאם אישית בהקלטה הקישו 4`;
                
                yemotRes = buildYemotResponse(
                    "read",
                    `${styleMenu}=StyleChoice,no,Digits,1,1,10,No,yes`,
                    { state: 4, voiceId: selectedVoiceId, yemot_token: YEMOT_TOKEN }
                );
                break;

            case 4:
                const styleChoice = query.StyleChoice;
                const voiceId = query.voiceId;

                if (styleChoice === "4") {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-אנא הקליטו את הנחיות הבמאי לסגנון ההקראה הרצוי ולאחר מכן הקישו סולמית=CustomStyleRecord,no,record,${TEMP_FOLDER},${ApiCallId}_style,yes,yes,no,2,60`,
                        { state: 5, voiceId: voiceId, styleType: "custom", yemot_token: YEMOT_TOKEN }
                    );
                } else {
                    let systemInstruction = "";
                    if (styleChoice === "2") systemInstruction = "שמח, נלהב, קצבי ומלא אנרגיה";
                    if (styleChoice === "3") systemInstruction = "רציני, דרמטי, קודר ורשמי";
                    
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-אנו מייצרים כעת את קובץ השמע זה עשוי לקחת מספר שניות. להמשך הקישו 1=ContinueToTTS,no,Digits,1,1,5,No,yes`,
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
                    `t-הנחיית הסגנון נקלטה אנו מייצרים את קובץ השמע. להמשך הקישו 1=ContinueToTTS,no,Digits,1,1,5,No,yes`,
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

                    // השמעת הקובץ שנוצר באמצעות הפקודה f-
                    const promptToUser = `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע ונשמר בהצלחה בשלוחה. t-האם לשמור במיקום נוסף לאישור הקישו 1 לביטול וחזרה לתפריט הראשי הקישו 2`;

                    yemotRes = buildYemotResponse(
                        "read",
                        `${promptToUser}=UserChoiceAdditionalSave,no,Digits,1,1,15,No,yes`,
                        { state: 7, yemot_token: YEMOT_TOKEN }
                    );
                } else {
                    yemotRes = buildYemotResponse(
                        "read",
                        `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע בהצלחה. הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית=TargetFolder,no,Digits,15,1,15,No,yes`,
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
                        `t-הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית=TargetFolder,no,Digits,15,1,15,No,yes`,
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
                    yemotRes = `id_list_message=t-העותק נשמר בהצלחה כקובץ מספר ${seqFileName}.&go_to_folder=/`;
                } else {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}. t-האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו 1 לסיום הקישו 2=SetDefaultChoice,no,Digits,1,1,10,No,yes`,
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
                    
                    yemotRes = `id_list_message=t-שלוחת ברירת המחדל עודכנה בהצלחה. תודה ולהתראות.&go_to_folder=/`;
                } else {
                    yemotRes = `id_list_message=t-תודה ולהתראות.&go_to_folder=/`;
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
        res.status(200).send(`id_list_message=t-אירעה שגיאה במערכת ההמרה אנו מתנצלים.&go_to_folder=/`);
    }
};
