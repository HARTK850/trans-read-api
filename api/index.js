/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR.
 * עודכן לחוויית משתמש (UX) חלקה, ללא תפריטי המתנה ועם חיתוך שלבים.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core');

const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') :["YOUR_GEMINI_API_KEY_1"];
const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App";

function buildYemotResponse(action, content, nextState = {}) {
    let response = `${action}=${content}`;
    let index = 0;
    for (const [key, value] of Object.entries(nextState)) {
        response += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
        index++;
    }
    return response;
}

module.exports = async function handler(req, res) {
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    if (query.hangup === "yes") {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(""); 
    }

    const YEMOT_TOKEN = query.yemot_token;
    const yemot = new YemotManager(YEMOT_TOKEN);
    const ApiPhone = query.ApiPhone || "Unknown";
    const ApiCallId = query.ApiCallId || "UnknownCall";
    
    // ניתוח המצב הנוכחי לפי הפרמטרים הקיימים
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
    
    try {
        let yemotRes = "";

        switch (state) {
            case 0:
                yemotRes = buildYemotResponse(
                    "read", 
                    `t-ברוכים הבאים למערכת היצירה הקולית.t-הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית=UserAudioRecord,no,record,${TEMP_FOLDER},${ApiCallId}_main,no,yes,no,2,120`,
                    { yemot_token: YEMOT_TOKEN }
                );
                break;

            case 1:
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                
                if (!transcribedText || transcribedText.length < 2) {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-לא הצלחנו להבין את ההקלטה אנא נסו שוב=UserAudioRecord,no,record,${TEMP_FOLDER},${ApiCallId}_main,no,yes,no,2,120`,
                        { yemot_token: YEMOT_TOKEN }
                    );
                    break;
                }

                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                yemotRes = buildYemotResponse(
                    "read",
                    `t-הטקסט נקלט בהצלחה.t-לבחירת קול של גבר הקישו 1.t-לבחירת קול של אישה הקישו 2=VoiceGender,no,Digits,1,1,10,No,yes`,
                    { yemot_token: YEMOT_TOKEN }
                );
                break;

            case 2:
                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                let menuPrompt = "t-אנא בחרו את הקול הרצוי ";
                for (let i = 0; i < voices.length; i++) {
                    menuPrompt += `t-ל${voices[i].desc} הקישו ${i + 1} `;
                }
                menuPrompt += "t-בסיום הקישו סולמית";

                yemotRes = buildYemotResponse(
                    "read",
                    `${menuPrompt}=VoiceIndex,no,Digits,2,1,15,No,yes`,
                    { gender: isMale ? "MALE" : "FEMALE", yemot_token: YEMOT_TOKEN }
                );
                break;

            case 3:
                const voiceList = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                const selectedVoiceId = (voiceIndex >= 0 && voiceIndex < voiceList.length) ? voiceList[voiceIndex].id : voiceList[0].id;

                const styleMenu = `t-לבחירת סגנון רגיל הקישו 1.t-לסגנון שמח ונלהב הקישו 2.t-לסגנון רציני הקישו 3.t-להגדרת סגנון מותאם אישית בהקלטה הקישו 4`;
                
                yemotRes = buildYemotResponse(
                    "read",
                    `${styleMenu}=StyleChoice,no,Digits,1,1,10,No,yes`,
                    { voiceId: selectedVoiceId, yemot_token: YEMOT_TOKEN }
                );
                break;

            case 4:
                // כאן הקסם: אם בחר 1, 2 או 3 - אנחנו מדלגים על בקשת אישור ומייצרים ישר את ה-TTS!
                const styleChoice = query.StyleChoice;
                const voiceId = query.voiceId;

                if (styleChoice === "4") {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-אנא הקליטו את הנחיות הבמאי לסגנון ההקראה הרצוי ולאחר מכן הקישו סולמית=CustomStyleRecord,no,record,${TEMP_FOLDER},${ApiCallId}_style,no,yes,no,2,60`,
                        { voiceId: voiceId, yemot_token: YEMOT_TOKEN }
                    );
                } else {
                    let sysInst = "";
                    if (styleChoice === "2") sysInst = "שמח, נלהב, קצבי ומלא אנרגיה";
                    if (styleChoice === "3") sysInst = "רציני, דרמטי, קודר ורשמי";
                    
                    // משיכת הטקסט שכבר שמרנו בשלב 1
                    const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                    
                    // יצירת האודיו מיד עכשיו! 
                    const ttsAudioBuffer = await gemini.generateTTS(mainText, voiceId, sysInst);
                    const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                    await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

                    // בדיקה האם יש שלוחת ברירת מחדל ושמירה אליה
                    const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                    const defaultFolder = await yemot.getTextFile(prefPath);

                    if (defaultFolder && defaultFolder.trim().length > 0) {
                        const folder = defaultFolder.trim();
                        const nextFileName = await yemot.getNextSequenceFileName(folder);
                        await yemot.uploadFile(`ivr2:/${folder}/${nextFileName}.wav`, ttsAudioBuffer);

                        yemotRes = buildYemotResponse("read", 
                            `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע ונשמר בהצלחה בשלוחה.t-האם לשמור במיקום נוסף לאישור הקישו 1 לביטול וחזרה לתפריט הראשי הקישו 2=UserChoiceAdditionalSave,no,Digits,1,1,10,No,yes`, 
                            { yemot_token: YEMOT_TOKEN }
                        );
                    } else {
                        yemotRes = buildYemotResponse("read", 
                            `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע בהצלחה.t-הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית=TargetFolderDefault,no,Digits,15,1,10,No,yes`, 
                            { yemot_token: YEMOT_TOKEN }
                        );
                    }
                }
                break;

            case 5:
                // אם הגענו לפה, הלקוח הקליט סגנון מותאם אישית
                const styleBuffer = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_style.wav`);
                const customSysInst = await gemini.transcribeAudio(styleBuffer);
                const mainTextCustom = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                
                const ttsAudioBufferCustom = await gemini.generateTTS(mainTextCustom, query.voiceId, customSysInst);
                await yemot.uploadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`, ttsAudioBufferCustom);

                const prefPathC = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolderC = await yemot.getTextFile(prefPathC);

                if (defaultFolderC && defaultFolderC.trim().length > 0) {
                    const folder = defaultFolderC.trim();
                    const nextFileName = await yemot.getNextSequenceFileName(folder);
                    await yemot.uploadFile(`ivr2:/${folder}/${nextFileName}.wav`, ttsAudioBufferCustom);

                    yemotRes = buildYemotResponse("read", 
                        `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע ונשמר בהצלחה בשלוחה.t-האם לשמור במיקום נוסף לאישור הקישו 1 לביטול וחזרה לתפריט הראשי הקישו 2=UserChoiceAdditionalSave,no,Digits,1,1,10,No,yes`, 
                        { yemot_token: YEMOT_TOKEN }
                    );
                } else {
                    yemotRes = buildYemotResponse("read", 
                        `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ הושמע בהצלחה.t-הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית=TargetFolderDefault,no,Digits,15,1,10,No,yes`, 
                        { yemot_token: YEMOT_TOKEN }
                    );
                }
                break;

            case 7:
                if (query.UserChoiceAdditionalSave === "1") {
                    yemotRes = buildYemotResponse("read", `t-הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית=TargetFolderCopy,no,Digits,15,1,10,No,yes`, { skipDefaultPrompt: "yes", yemot_token: YEMOT_TOKEN });
                } else {
                    yemotRes = `go_to_folder=/`; 
                }
                break;

            case 8: // שמירה בפעם הראשונה
            case 85: // שמירת עותק נוסף
                let targetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
                if (!targetFolder) { yemotRes = `go_to_folder=/`; break; }
                
                const cleanFolder = targetFolder.replace(/\*/g, "/");
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder);
                
                await yemot.uploadFile(`ivr2:/${cleanFolder}/${seqFileName}.wav`, ttsForSave);

                if (state === 85) { 
                    yemotRes = `id_list_message=t-העותק נשמר בהצלחה כקובץ מספר ${seqFileName}&go_to_folder=/`;
                } else { 
                    yemotRes = buildYemotResponse("read", `t-הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}.t-האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות. לאישור הקישו 1 לסיום הקישו 2=SetDefaultChoice,no,Digits,1,1,10,No,yes`, { targetFolder: cleanFolder, yemot_token: YEMOT_TOKEN });
                }
                break;

            case 9:
                if (query.SetDefaultChoice === "1" && query.targetFolder) {
                    await yemot.uploadTextFile(`ivr2:/Preferences/${ApiPhone}.txt`, query.targetFolder.replace(/\*/g, "/"));
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
        console.error(`[IVR Critical Error]`, error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(`id_list_message=t-אירעה שגיאה במערכת ההמרה אנו מתנצלים&go_to_folder=/`);
    }
};
