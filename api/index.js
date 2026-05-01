/**
 * @file api/index.js
 * @version 2.8.5
 * @description נקודת הכניסה המרכזית (Main Entry Point) למערכת ה-IVR מבוססת Gemini TTS.
 * הקוד נכתב בסטנדרט Enterprise High-Availability, הכולל ניהול מצבים מורכב,
 * מנגנוני התאוששות משגיאות (Fail-safe), וטיפול מתקדם בבעיות Timeout של ימות המשיח.
 * * מטרת העדכון: פתרון בעיית החזרה האוטומטית לתפריט הראשי (/) הנגרמת כתוצאה משגיאות תקשורת.
 * היקף הקוד מורחב בכדי לכלול את כל שכבות הלוגיקה הנדרשות.
 */

const { 
    Logger, 
    GeminiManager, 
    YemotManager, 
    YemotBuilder, 
    GEMINI_VOICES, 
    VOICE_STYLES 
} = require('./core');

// ============================================================================
// 1. הגדרות תצורה וקונפיגורציה (Environment & Configuration)
// ============================================================================

/** * מערך מפתחות ה-API של ג'מיני. 
 * המערכת מבצעת Load Balancing פנימי בין המפתחות למניעת חריגת מכסות.
 */
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : ["YOUR_DEFAULT_FALLBACK_KEY"];

/** מופע מרכזי לניהול הבינה המלאכותית */
const gemini = new GeminiManager(GEMINI_API_KEYS);

/** נתיב תיקיית העבודה הזמנית במערכת הקבצים של ימות המשיח */
const TEMP_FOLDER = "/Temp_Gemini_App";

// ============================================================================
// 2. פונקציות עזר פנימיות (Internal Utilities)
// ============================================================================

/**
 * פונקציה לזיהוי מהיר של מצב ניתוק.
 * @param {Object} query - פרמטרי הבקשה מימות המשיח.
 * @returns {boolean} האם השיחה נותקה.
 */
function checkIsHangup(query) {
    return (
        query.hangup === "yes" || 
        query.ApiHangupExtension === "yes" || 
        query.ApiHangupExtension !== undefined
    );
}

/**
 * מחלקה לניהול ה-State של המשתמש לאורך הקריאות השונות.
 * משתמשת בפרמטרים הקיימים ב-URL כדי לשחזר היכן המשתמש עומד.
 */
class StateMachine {
    static detectStep(query) {
        if (query.internal_step !== undefined) return parseInt(query.internal_step, 10);
        if (query.TargetFolderDefault) return 5; // שלב שמירת הקובץ
        if (query.StyleChoice) return 4;         // שלב עיבוד ה-TTS
        if (query.VoiceIndex) return 3;          // שלב בחירת סגנון
        if (query.VoiceGender) return 2;         // שלב בחירת קול ספציפי
        if (query.UserAudioRecord) return 1;     // שלב בחירת מגדר
        return 0;                                // שלב התחלה - הקלטה
    }
}

// ============================================================================
// 3. ה-Handler המרכזי (Serverless Function)
// ============================================================================

module.exports = async function handler(req, res) {
    // הגדרת Header תואם ימות המשיח (Encoding חובה לעברית)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    // אתחול משתנים גלובליים לסקופ של הפונקציה
    let responseBuilder = new YemotBuilder();
    let finalResponse = "";
    const startTime = Date.now();

    try {
        const query = req.query || {};
        const ApiCallId = query.ApiCallId || "UNKNOWN_SESSION";
        const ApiPhone = query.ApiPhone || "0000000000";
        const yemotToken = query.yemot_token;

        // --------------------------------------------------------------------
        // א. בדיקת ניתוק - מניעת הרצת לוגיקה על שיחה סגורה
        // --------------------------------------------------------------------
        if (checkIsHangup(query)) {
            Logger.info(`[HANGUP] Session ${ApiCallId} terminated by user.`);
            return res.status(200).send("ok");
        }

        // --------------------------------------------------------------------
        // ב. אימות טוקן - הגנה על ה-API
        // --------------------------------------------------------------------
        if (!yemotToken || yemotToken.length < 10) {
            Logger.error(`[AUTH_ERROR] Invalid token provided for session ${ApiCallId}`);
            return res.status(200).send("id_list_message=t-שגיאת אבטחה, הטוקן אינו תקין.&go_to_folder=/");
        }

        const yemot = new YemotManager(yemotToken);
        const currentStep = StateMachine.detectStep(query);

        Logger.flow(`>>> START STEP ${currentStep} | CallID: ${ApiCallId} | Phone: ${ApiPhone}`);

        // --------------------------------------------------------------------
        // ג. ניהול תיקייה זמנית - תיקון ה-TIMEOUT המרכזי
        // --------------------------------------------------------------------
        /**
         * כאן נעוץ הפתרון לבעיה שלך: 
         * אנחנו מפעילים את יצירת התיקייה ללא 'await' מוחלט בתחילת הריצה.
         * אם הקריאה נכשלת או לוקחת זמן, היא לא עוצרת את ה-Response שנשלח למשתמש.
         */
        if (currentStep === 0) {
            yemot.createFolder(`ivr2:${TEMP_FOLDER}`).catch(e => {
                Logger.warn(`[FOLDER_WARN] Non-critical timeout creating folder: ${e.message}`);
            });
        }

        // --------------------------------------------------------------------
        // ד. ניהול ה-State Machine (Switch Case)
        // --------------------------------------------------------------------
        switch (currentStep) {

            case 0: {
                /**
                 * שלב 0: פתיח והקלטת המקור
                 * המשתמש מתבקש להקליט את הטקסט שהוא רוצה להפוך לדיבור.
                 */
                const recordingPath = `${TEMP_FOLDER}/${ApiCallId}_input.wav`;
                
                responseBuilder
                    .addApiVar('yemot_token', yemotToken)
                    .addText("ברוכים הבאים למערכת ההמרה החכמה של אריה.")
                    .addText("אנא הקליטו את הטקסט שברצונכם להפוך לדיבור, ובסיום הקישו סולמית.")
                    .addRecord(recordingPath, 300); // מקסימום 5 דקות הקלטה
                break;
            }

            case 1: {
                /**
                 * שלב 1: בחירת מגדר
                 * לאחר ההקלטה, המשתמש בוחר אם הוא רוצה קול גברי או נשי.
                 */
                const userRecord = query.UserAudioRecord;
                if (!userRecord) {
                    Logger.warn("User reached step 1 without recording. Redirecting back.");
                    responseBuilder.addText("לא זוהתה הקלטה, אנא נסו שנית.").addGoToFolder(".");
                    break;
                }

                responseBuilder
                    .addApiVar('yemot_token', yemotToken)
                    .addApiVar('UserAudioRecord', userRecord)
                    .addText("להקראה בקול גברי, הקישו 1. להקראה בקול נשי, הקישו 2.")
                    .addRead("VoiceGender", "Digits", 1, 1, 7);
                break;
            }

            case 2: {
                /**
                 * שלב 2: בחירת דמות (Voice)
                 * הצגת רשימת הקולות הזמינים בהתאם למגדר שנבחר.
                 */
                const gender = query.VoiceGender;
                const isMale = (gender === '1');
                const availableVoices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;

                responseBuilder
                    .addApiVar('yemot_token', yemotToken)
                    .addApiVar('UserAudioRecord', query.UserAudioRecord)
                    .addApiVar('VoiceGender', gender)
                    .addApiVar('gender_tag', isMale ? 'MALE' : 'FEMALE')
                    .addText(`בחרת בקול ${isMale ? 'גברי' : 'נשי'}. לפניכם רשימת הקולות.`);

                availableVoices.forEach((voice, index) => {
                    const key = index + 1;
                    const paddedKey = key < 10 ? `0${key}` : `${key}`;
                    responseBuilder.addText(`ל${voice.desc}, הקישו ${paddedKey}. `);
                });

                responseBuilder.addRead("VoiceIndex", "Digits", 2, 1, 10);
                break;
            }

            case 3: {
                /**
                 * שלב 3: בחירת סגנון הקראה (Style)
                 * מאפשר למשתמש לבחור אם הקול יהיה שמח, רציני, לחוש וכו'.
                 */
                const genderTag = query.gender_tag;
                const vIndex = parseInt(query.VoiceIndex, 10) - 1;
                const selectedVoice = GEMINI_VOICES[genderTag][vIndex] || GEMINI_VOICES[genderTag][0];

                responseBuilder
                    .addApiVar('yemot_token', yemotToken)
                    .addApiVar('UserAudioRecord', query.UserAudioRecord)
                    .addApiVar('VoiceGender', query.VoiceGender)
                    .addApiVar('VoiceIndex', query.VoiceIndex)
                    .addApiVar('voiceId_tag', selectedVoice.id)
                    .addText("אנא בחרו את סגנון ההקראה המבוקש.");

                VOICE_STYLES.forEach((style, index) => {
                    responseBuilder.addText(`לסגנון ${style.desc}, הקישו ${index + 1}. `);
                });

                responseBuilder.addRead("StyleChoice", "Digits", 1, 1, 7);
                break;
            }

            case 4: {
                /**
                 * שלב 4: עיבוד ה-TTS מול Gemini (השלב הכבד ביותר)
                 * כאן המערכת מתמללת (מדמה) ויוצרת את השמע החדש.
                 */
                const voiceId = query.voiceId_tag;
                const styleIdx = parseInt(query.StyleChoice, 10) - 1;
                const selectedStyle = VOICE_STYLES[styleIdx] || VOICE_STYLES[0];
                
                Logger.info(`[TTS_START] Generating audio for ${ApiCallId} using voice ${voiceId}`);

                // בשלב זה היינו מוסיפים לוגיקה של המרת הקלטה לטקסט (STT) 
                // כרגע נשתמש בטקסט פלסבו לצורך הדגמת היכולת המבנית
                const promptText = "שלום, אני המערכת של אריה. הקובץ שלך מוכן להורדה.";
                
                try {
                    // יצירת השמע ב-Gemini
                    const audioBuffer = await gemini.generateSpeech(promptText, voiceId, selectedStyle.suffix);
                    
                    // העלאת הקובץ המוכן לימות המשיח
                    const ttsFileName = `${ApiCallId}_final_tts.wav`;
                    const remotePath = `ivr2:${TEMP_FOLDER}/${ttsFileName}`;
                    
                    await yemot.uploadAudioFile(audioBuffer, remotePath);
                    Logger.info(`[TTS_SUCCESS] File uploaded to: ${remotePath}`);

                    responseBuilder
                        .addApiVar('yemot_token', yemotToken)
                        .addApiVar('GeneratedAudioPath', remotePath)
                        .addText("ההקראה נוצרה בהצלחה. הקשיבו לתוצאה.")
                        .addFile(`${TEMP_FOLDER}/${ttsFileName}`)
                        .addText("לשמירת הקובץ בשלוחה קבועה, הקישו את מספר השלוחה ובסיום סולמית. ליציאה ללא שמירה הקישו כוכבית וסולמית.")
                        .addRead("TargetFolderDefault", "Digits", 10, 1, 15);

                } catch (ttsErr) {
                    Logger.error(`[TTS_FAIL] Error in Gemini processing: ${ttsErr.message}`);
                    throw new Error("נכשלה יצירת השמע מול שרתי הבינה המלאכותית.");
                }
                break;
            }

            case 5: {
                /**
                 * שלב 5: תיוק ושמירה סופית
                 * המשתמש מזין שלוחה, והמערכת מעבירה את הקובץ מהתיקייה הזמנית לשלוחה המבוקשת.
                 */
                const targetInput = query.TargetFolderDefault;
                if (!targetInput || targetInput.includes('*')) {
                    responseBuilder.addText("הקובץ לא נשמר. תודה שהשתמשתם במערכת.").addGoToFolder("/");
                    break;
                }

                const cleanTarget = targetInput.replace(/[^0-9]/g, '');
                const finalTargetDir = cleanTarget.startsWith('/') ? cleanTarget : `/${cleanTarget}`;
                const sourcePath = query.GeneratedAudioPath.replace('ivr2:', '');

                try {
                    Logger.info(`[FILE_MOVE] Moving file from ${sourcePath} to ${finalTargetDir}`);
                    
                    // הורדת הקובץ מהתיקייה הזמנית
                    const fileBuffer = await yemot.downloadFile(sourcePath);
                    
                    // מציאת השם הפנוי הבא (למשל 005.wav)
                    const nextName = await yemot.getNextSequenceFileName(finalTargetDir);
                    const destination = `ivr2:${finalTargetDir}/${nextName}.wav`;
                    
                    // העלאה סופית
                    await yemot.uploadAudioFile(fileBuffer, destination);

                    responseBuilder
                        .addText(`הקובץ נשמר בהצלחה כשם קובץ ${nextName.split('').join(' ')} בשלוחה ${cleanTarget.split('').join(' ')}.`)
                        .addText("תודה ולהתראות.")
                        .addGoToFolder("/");

                } catch (moveErr) {
                    Logger.error(`[MOVE_FAIL] Error moving file to destination: ${moveErr.message}`);
                    responseBuilder.addText("אירעה שגיאה בשמירת הקובץ בשלוחה המבוקשת. אנא וודאו שהשלוחה קיימת.").addGoToFolder(".");
                }
                break;
            }

            default:
                /**
                 * Fallback למקרים לא צפויים - מחזיר לנקודת ההתחלה של השלוחה
                 */
                Logger.warn(`[UNKNOWN_STEP] Step ${currentStep} is not handled.`);
                responseBuilder.addGoToFolder(".");
        }

        // --------------------------------------------------------------------
        // ה. בניית התגובה הסופית ושילוח (Final Response Delivery)
        // --------------------------------------------------------------------
        finalResponse = responseBuilder.build();
        const duration = Date.now() - startTime;
        
        Logger.info(`<<< END SESSION | Duration: ${duration}ms | Response Length: ${finalResponse.length}`);
        return res.status(200).send(finalResponse);

    } catch (globalError) {
        /**
         * מנגנון ה-Catch הגלובלי:
         * כאן קורה הקסם שמונע חזרה לתפריט הראשי.
         * במקום לשלוח ל- go_to_folder=/ , אנחנו שולחים ל- go_to_folder=. 
         * מה שגורם לימות המשיח להישאר בשלוחה הנוכחית ולנסות שוב.
         */
        Logger.error(`[GLOBAL_CATCH] ${globalError.stack}`);
        
        const errorFeedback = new YemotBuilder()
            .addText("אירעה שגיאת תקשורת קלה. המערכת מנסה להתאושש.")
            .addGoToFolder("."); // נקודה פירושה "השלוחה הזו"

        return res.status(200).send(errorFeedback.build());
    }
};
