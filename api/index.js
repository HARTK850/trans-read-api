/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR החכמה לתמלול והקראה.
 * הקובץ מנהל את ה-State של כל מאזין בהתאם להקשות ולשלבי ההתקדמות בשיחה.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES } = require('./core'); // הנחה ששני הקבצים באותה תיקייה. התאם נתיב אם core.js בתיקייה אחרת.

// ============================================================================
// קונפיגורציה והגדרות מערכת (יש לעדכן בסביבת הייצור / ב-Environment Variables)
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') :[
    "YOUR_GEMINI_API_KEY_1",
    "YOUR_GEMINI_API_KEY_2"
];

const YEMOT_TOKEN = query.yemot_token; // מקבל את הטוקן ישירות מהגדרות השלוחה
if (!YEMOT_TOKEN) {
    console.error("חסר טוקן של ימות המשיח בבקשה!");
}
const yemot = new YemotManager(YEMOT_TOKEN);


// בניית המנהלים
const gemini = new GeminiManager(GEMINI_API_KEYS);
const yemot = new YemotManager(YEMOT_TOKEN);

// נתיב זמני בימות המשיח לשמירת הקלטות שטרם עובדו
const TEMP_FOLDER = "ivr2:/Temp_Gemini_App";

// ============================================================================
// פונקציות עזר ליצירת תגובות בפורמט ימות המשיח
// ============================================================================

/**
 * יצירת מחרוזת תגובה תקינה לימות המשיח (ללא מרכאות כפולות, פורמט Read/Play וכו')
 * @param {string} action הפעולה הרצויה, למשל 'read' או 'id_list_message' או 'go_to_folder'
 * @param {string} content תוכן הפעולה
 * @param {object} nextState אובייקט המכיל את הפרמטרים שיוחזרו ב-Query בשלב הבא
 * @returns {string} 
 */
function buildYemotResponse(action, content, nextState = {}) {
    let response = `${action}=${content}`;
    
    // שרשור משתני ה-State שיחזרו אלינו בקריאה הבאה (API Add)
    let index = 0;
    for (const[key, value] of Object.entries(nextState)) {
        // בימות המשיח מגדירים פרמטרים נוספים על ידי api_add_X=key=value
        response += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
        index++;
    }
    return response;
}

// ============================================================================
// פונקציית הטיפול הראשית (Serverless Request Handler)
// ============================================================================

module.exports = async function handler(req, res) {
    // ימות המשיח תומכים גם ב-GET וגם ב-POST, נעבוד עם ה-Query Parameters.
    // ב-POST של ימות, הנתונים יכולים להגיע גם כ-Form urlencoded או Query String.
    const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;

    const ApiPhone = query.ApiPhone || "Unknown";
    const ApiCallId = query.ApiCallId || "UnknownCall";
    
    // קריאת המצב הנוכחי (State). אם אין, אנחנו בהתחלה (שלב 0)
    const state = parseInt(query.state || "0", 10);
    
    console.log(`[IVR Request] שיחה: ${ApiCallId}, טלפון: ${ApiPhone}, שלב: ${state}`);

    try {
        let yemotRes = "";

        switch (state) {
            case 0:
                // ====================================================================
                // שלב 0: ברוכים הבאים ובקשה להקלטת הטקסט לתמלול
                // ====================================================================
                // אנחנו נשתמש ב-record, ונשמור בנתיב הזמני.
                // פרמטרי read: השמעה=שם_המשתנה, האם_לשמור_נתון_קיים(no), מקסימום_ספרות(1), מינימום_ספרות(1), זמן_המתנה(7), סוג(record), נתיב_לשמירה
                yemotRes = buildYemotResponse(
                    "read", 
                    `t-ברוכים_הבאים_למערכת_היצירה_הקולית_הקליטו_את_הטקסט_שברצונכם_להקריא_ולאחר_מכן_הקישו_סולמית=UserAudioRecord,no,1,1,15,record,${TEMP_FOLDER},${ApiCallId}_main,no,yes,yes`,
                    { state: 1 }
                );
                break;

            case 1:
                // ====================================================================
                // שלב 1: עיבוד ההקלטה (STT) ושמירת הטקסט, ומעבר לבחירת מגדר לקול
                // ====================================================================
                // קובץ האודיו נשמר בימות. אנו נוריד אותו ונשלח ל-Gemini.
                const recordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
                
                // תמלול באמצעות Gemini STT
                const transcribedText = await gemini.transcribeAudio(audioBuffer);
                console.log(`[STT Success] טקסט שתומלל: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-לא_הצלחנו_להבין_את_ההקלטה_אנא_נסו_שוב=UserAudioRecord,no,1,1,15,record,${TEMP_FOLDER},${ApiCallId}_main,no,yes,yes`,
                        { state: 1 }
                    );
                    break;
                }

                // שמירת הטקסט בקובץ העדפות זמני כדי לא לאבד אותו בין הבקשות (מאחר ש-URL מוגבל באורכו)
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                // תפריט מגדר לקול
                yemotRes = buildYemotResponse(
                    "read",
                    `t-הטקסט_נקלט_בהצלחה_לבחירת_קול_של_גבר_הקישו_1_לבחירת_קול_של_אישה_הקישו_2=VoiceGender,no,1,1,10,Digits,no`,
                    { state: 2 }
                );
                break;

            case 2:
                // ====================================================================
                // שלב 2: משתמש בחר מגדר - הקראת רשימת הקולות הזמינים
                // ====================================================================
                const genderChoice = query.VoiceGender;
                let isMale = genderChoice === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                // בגלל שיש 15 קולות בכל מגדר, נקריא למשתמש רק את ה-9 הראשונים מטעמי נוחות ב-IVR,
                // או שנעשה תפריט שלוחה של כל ה-15.
                // ניצור מחרוזת תפריט ארוכה שמקריאה את התיאור של כל קול ודורשת הקשה מ-1 עד 15.
                // שימוש ב-Number מאפשר הקשה של יותר ממוספרת אחת (עבור דו-ספרתי).
                
                let menuPrompt = "t-אנא_בחרו_את_הקול_הרצוי.";
                for (let i = 0; i < voices.length; i++) {
                    // ימות המשיח לא תומך ברווחים בהקראת טקסט, נחליף בקו תחתון
                    const descSafe = voices[i].desc.replace(/ /g, "_");
                    menuPrompt += `t-ל${descSafe}_הקישו_${i + 1}.`;
                }
                menuPrompt += "t-בסיום_הקישו_סולמית";

                yemotRes = buildYemotResponse(
                    "read",
                    `${menuPrompt}=VoiceIndex,no,2,1,15,Number,no`,
                    { state: 3, gender: isMale ? "MALE" : "FEMALE" }
                );
                break;

            case 3:
                // ====================================================================
                // שלב 3: המשתמש בחר קול ספציפי - מעבר לבחירת סגנון הקראה
                // ====================================================================
                const selectedGender = query.gender;
                const voiceIndex = parseInt(query.VoiceIndex, 10) - 1;
                const voiceList = GEMINI_VOICES[selectedGender];

                if (isNaN(voiceIndex) || voiceIndex < 0 || voiceIndex >= voiceList.length) {
                    // בחירה שגויה, חזרה
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-בחירה_שגויה_נא_נסו_שוב=VoiceIndex,no,2,1,10,Number,no`,
                        { state: 3, gender: selectedGender }
                    );
                    break;
                }

                const selectedVoiceId = voiceList[voiceIndex].id;

                // תפריט סגנונות
                // 1. רגיל (ניטרלי)
                // 2. שמח ונלהב
                // 3. רציני ודרמטי
                // 4. סגנון מותאם אישית (הקלטה)
                const styleMenu = `t-לבחירת_סגנון_רגיל_הקישו_1.t-לסגנון_שמח_ונלהב_הקישו_2.t-לסגנון_רציני_הקישו_3.t-להגדרת_סגנון_מותאם_אישית_בהקלטה_הקישו_4`;
                
                yemotRes = buildYemotResponse(
                    "read",
                    `${styleMenu}=StyleChoice,no,1,1,10,Digits,no`,
                    { state: 4, voiceId: selectedVoiceId }
                );
                break;

            case 4:
                // ====================================================================
                // שלב 4: המשתמש בחר סגנון כללי, נבדוק אם בחר 4 (מותאם אישית) או רגיל
                // ====================================================================
                const styleChoice = query.StyleChoice;
                const voiceId = query.voiceId;

                if (styleChoice === "4") {
                    // סגנון מותאם אישית - נבקש שיקליט
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-אנא_הקליטו_את_הנחיות_הבמאי_לסגנון_ההקראה_הרצוי_ולאחר_מכן_הקישו_סולמית=CustomStyleRecord,no,1,1,15,record,${TEMP_FOLDER},${ApiCallId}_style,no,yes,yes`,
                        { state: 5, voiceId: voiceId, styleType: "custom" }
                    );
                } else {
                    // סגנון מוגדר מראש
                    let systemInstruction = "";
                    if (styleChoice === "2") systemInstruction = "שמח, נלהב, קצבי ומלא אנרגיה";
                    if (styleChoice === "3") systemInstruction = "רציני, דרמטי, קודר ורשמי";
                    
                    // מעבר מידי ליצירת ה-TTS (שלב 6, כי נדלג על תמלול הסגנון)
                    // ב-Yemot כדי לעשות קפיצה פנימית אוטומטית שולחים read דמה או מעבירים לשלב הבא ישירות ע"י השמעת בקשה להמתנה
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-אנו_מייצרים_כעת_את_קובץ_השמע_זה_עשוי_לקחת_מספר_שניות_להמשך_הקישו_1=ContinueToTTS,no,1,1,1,Digits,no`,
                        { state: 6, voiceId: voiceId, sysInst: systemInstruction }
                    );
                }
                break;

            case 5:
                // ====================================================================
                // שלב 5: תמלול ההנחיה המותאמת אישית של המשתמש לסגנון (Director's Notes)
                // ====================================================================
                const styleVoiceId = query.voiceId;
                
                const styleRecordPath = `${TEMP_FOLDER}/${ApiCallId}_style.wav`;
                const styleAudioBuffer = await yemot.downloadFile(`ivr2:${styleRecordPath}`);
                
                // תמלול הסגנון (STT)
                const transcribedStyleText = await gemini.transcribeAudio(styleAudioBuffer);
                console.log(`[STT Custom Style] סגנון מותאם אישית: ${transcribedStyleText}`);

                // מעבר לשלב ה-TTS
                yemotRes = buildYemotResponse(
                    "read",
                    `t-הנחיית_הסגנון_נקלטה_אנו_מייצרים_את_קובץ_השמע_להמשך_הקישו_1=ContinueToTTS,no,1,1,1,Digits,no`,
                    { state: 6, voiceId: styleVoiceId, sysInst: transcribedStyleText }
                );
                break;

            case 6:
                // ====================================================================
                // שלב 6: יצירת ה-TTS מ-Gemini, העלאתו לימות, השמעתו ושמירתו
                // ====================================================================
                const finalVoiceId = query.voiceId;
                const sysInst = query.sysInst || "";

                // שליפת הטקסט המקורי שתומלל בשלב 1
                const mainText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                if (!mainText) {
                    throw new Error("הטקסט המקורי לא נמצא, ייתכן שהזמן תם.");
                }

                // פנייה ל-Gemini ליצירת ה-TTS
                const ttsAudioBuffer = await gemini.generateTTS(mainText, finalVoiceId, sysInst);

                // העלאת ה-TTS לתיקייה זמנית בימות המשיח להשמעה
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsAudioBuffer);

                // בדיקה האם ללקוח הזה כבר מוגדרת "שלוחת ברירת מחדל" לשמירה
                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                if (defaultFolder && defaultFolder.trim().length > 0) {
                    // ==============================================
                    // יש שלוחת ברירת מחדל! (לפי דרישות הפרומפט)
                    // ==============================================
                    const folder = defaultFolder.trim();
                    const nextFileName = await yemot.getNextSequenceFileName(folder);
                    const finalSavedPath = `ivr2:/${folder}/${nextFileName}.wav`;
                    
                    // נעתיק את הקובץ למיקום הסופי
                    await yemot.uploadFile(finalSavedPath, ttsAudioBuffer);

                    // נוסח התגובה שנדרש בדיוק בפרומפט:
                    const promptToUser = `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ_הושמע_ונשמר_בהצלחה_בשלוחה_${folder.replace(/\//g, "_")}_כקובץ_מספר_${nextFileName}.t-האם_לשמור_במיקום_נוסף_לאישור_הקישו_1_לביטול_וחזרה_לתפריט_הראשי_הקישו_2`;

                    yemotRes = buildYemotResponse(
                        "read",
                        `${promptToUser}=UserChoiceAdditionalSave,no,1,1,15,Digits,no`,
                        { state: 7 } // יעבור ללוגיקת שמירה נוספת
                    );
                } else {
                    // ==============================================
                    // אין שלוחת ברירת מחדל.
                    // נשמיע את הקובץ ונשאל לאן לשמור
                    // ==============================================
                    yemotRes = buildYemotResponse(
                        "read",
                        `f-${TEMP_FOLDER}/${ApiCallId}_tts.t-הקובץ_הושמע_בהצלחה_הקישו_את_מספר_השלוחה_בה_תרצו_לשמור_את_הקובץ_ובסיום_הקישו_סולמית=TargetFolder,no,1,10,15,Digits,no`,
                        { state: 8 } // יעבור לשמירה רגילה
                    );
                }
                break;

            case 7:
                // ====================================================================
                // שלב 7: הלקוח נשאל האם לשמור מיקום נוסף כעותק (אחרי שמירת ברירת מחדל)
                // ====================================================================
                const userChoiceAdd = query.UserChoiceAdditionalSave;
                if (userChoiceAdd === "2") {
                    // הקיש 2 -> חזרה לתפריט ראשי של ימות המשיח
                    yemotRes = `go_to_folder=/`; 
                } else if (userChoiceAdd === "1") {
                    // הקיש 1 -> מעבר להקשת שלוחה להעתק
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-הקישו_את_מספר_השלוחה_עבור_העותק_הנוסף_ובסיום_הקישו_סולמית=TargetFolder,no,1,10,15,Digits,no`,
                        { state: 8, skipDefaultPrompt: "yes" } // העברה לשלב שמירה ללא הצעת ברירת מחדל
                    );
                } else {
                    // ברירת מחדל למקרה של הקשה לא חוקית
                    yemotRes = `go_to_folder=/`;
                }
                break;

            case 8:
                // ====================================================================
                // שלב 8: הלקוח הקיש שלוחה לשמירה (רגילה או עותק נוסף)
                // ====================================================================
                let targetFolder = query.TargetFolder;
                if (!targetFolder) {
                    yemotRes = `go_to_folder=/`;
                    break;
                }
                
                // המרת הקשת הלקוח לנתיב, המשתמש מקיש למשל 125, נתרגם ל-1/2/5 או 125 בהתאם למבנה השלוחות שלך
                // נניח שימות המשיח מצפה לנתיב עם סלשים: '1/2/5'
                // אפשר להמיר את המספר לנתיב באמצעות הוספת '/' בין כל ספרה (תלוי בהגדרת המערכת שלך)
                // במערכות רגילות אם המשתמש מקיש 125 זה יכול להיות תיקייה ששמה 125, נשמור ככה:
                const cleanFolder = targetFolder.replace(/\*/g, "/"); // אם המשתמש מקיש כוכבית כמפריד תיקיות

                // השגת הבאפר מהתיקייה הזמנית ששמרנו בשלב 6
                const ttsAudioBufferForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);

                // מציאת השם הפנוי בתיקיית היעד
                const seqFileName = await yemot.getNextSequenceFileName(cleanFolder);
                const destPath = `ivr2:/${cleanFolder}/${seqFileName}.wav`;

                // שמירה ביעד הסופי
                await yemot.uploadFile(destPath, ttsAudioBufferForSave);

                const skipDefaultPrompt = query.skipDefaultPrompt === "yes";

                if (skipDefaultPrompt) {
                    // אם זה היה שביל "עותק נוסף", אנחנו לא מציעים לו לשמור כברירת מחדל, רק נפרדים
                    yemotRes = `id_list_message=t-העותק_נשמר_בהצלחה_בשלוחה_${cleanFolder.replace(/\//g, "_")}_כקובץ_מספר_${seqFileName}.&go_to_folder=/`;
                } else {
                    // נציע למשתמש להפוך את השלוחה הזו לברירת המחדל שלו
                    yemotRes = buildYemotResponse(
                        "read",
                        `t-הקובץ_נשמר_בהצלחה_בשלוחה_${cleanFolder.replace(/\//g, "_")}_כקובץ_מספר_${seqFileName}.t-האם_תרצו_להגדיר_שלוחה_זו_כברירת_המחדל_לשמירות_הבאות_לאישור_הקישו_1_לסיום_הקישו_2=SetDefaultChoice,no,1,1,10,Digits,no`,
                        { state: 9, targetFolder: cleanFolder }
                    );
                }
                break;

            case 9:
                // ====================================================================
                // שלב 9: טיפול בתשובת הגדרת ברירת המחדל
                // ====================================================================
                const setDefault = query.SetDefaultChoice;
                const folderToSave = query.targetFolder;

                if (setDefault === "1" && folderToSave) {
                    // שמירת התיקייה בקובץ העדפות אישי על בסיס הטלפון של הלקוח
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

        // שליחת התשובה בחזרה לימות המשיח (התשובה חייבת להיות טקסט רגיל)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotRes);

    } catch (error) {
        console.error(`[IVR Critical Error] ${error.message}`, error);
        // במקרה של קריסת השרת או שגיאת API, נשמיע הודעת שגיאה ונחזיר למסך הראשי
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(`id_list_message=t-אירעה_שגיאה_במערכת_ההמרה_אנו_מתנצלים.&go_to_folder=/`);
    }
};
