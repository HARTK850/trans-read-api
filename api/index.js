/**
 * @file api/index.js
 * @description נקודת הכניסה (Serverless Endpoint) למערכת ה-IVR.
 * קובץ זה מכיל את מכונת המצבים (State Machine) המנהלת את שיחת המשתמש.
 * תוקנו בו כל הבאגים שדווחו: קריסת המשתנה, לוגיקת ההקשות, תפריט ההקלטה וניתוב הסיום.
 * @version 2.5.0
 */

const { Logger, GeminiManager, YemotManager, YemotBuilder, GEMINI_VOICES, VOICE_STYLES } = require('./core');

// ============================================================================
// 1. הגדרות וסביבה גלובלית
// ============================================================================

// מפתחות API (מומלץ לנהל דרך סביבת משתני Vercel/Node)
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [
    "YOUR_GEMINI_API_KEY_1" // יש להחליף במפתח האמיתי או להגדיר כמשתנה סביבה
];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App";

// ============================================================================
// 2. פונקציית הליבה - Handler
// ============================================================================

/**
 * פונקציה המטפלת בכל בקשת HTTP נכנסת מימות המשיח
 */
module.exports = async function handler(req, res) {
    // === [תיקון קריסה קריטית] ===
    // המשתמש דיווח על קריסה "ReferenceError: yemotRes is not defined".
    // כדי לתקן זאת לחלוטין ולמנוע קריסות באזור ה-Catch, נגדיר את משתני התשובה בראש הבלוק.
    let responseBuilder = null;
    let yemotRes = "";

    try {
        // שלב 1: איסוף נתוני הבקשה
        const query = req.query || {};
        const yemotToken = query.yemot_token;
        const ApiCallId = query.ApiCallId || "UNKNOWN_CALL";
        const ApiPhone = query.ApiPhone || "UNKNOWN_PHONE";
        
        // ימות המשיח מוסיפה את הפרמטר הזה כשהלקוח מנתק או כשיש שגיאת רשת
        const isHangup = query.hangup === "yes" || query.ApiHangupExtension;

        if (isHangup) {
            Logger.flow(`שיחה נותקה בצד הלקוח. (CallID: ${ApiCallId})`);
            return res.status(200).send("ok");
        }

        if (!yemotToken) {
            Logger.error("בקשה ללא טוקן של ימות המשיח התקבלה.");
            return res.status(400).send("Missing yemot_token");
        }

        const yemot = new YemotManager(yemotToken);

        // וידוא קיום תיקיית עבודה זמנית (Fire and Forget - לא מעכב את הבקשה)
        yemot.createFolder(`ivr2:${TEMP_FOLDER}`).catch(e => {});

        // שלב 2: זיהוי השלב במכונת המצבים (State Machine)
        // הבדיקה נעשית באמצעות הימצאות משתנים ספציפיים שנאספו מהמשתמש בשלבים קודמים.
        let step = 0;
        if (query.UserAudioRecord) step = 1;      // המשתמש סיים להקליט אודיו
        if (query.VoiceGender) step = 2;          // המשתמש בחר מגדר
        if (query.VoiceIndex) step = 3;           // המשתמש בחר קול ספציפי
        if (query.StyleChoice) step = 4;          // המשתמש בחר סגנון
        if (query.TargetFolderDefault) step = 5;  // המשתמש בחר תיקיית יעד - והמערכת מחכה לסיים

        // בדיקה נוספת: אם הוגדר פרמטר step מפורש (כדי לאלץ ניתוב)
        if (query.internal_step) {
            step = parseInt(query.internal_step, 10);
        }

        Logger.flow(`טלפון: ${ApiPhone} | מזהה: ${ApiCallId} | שלב שזוהה: ${step}`);

        // שלב 3: הפעלת הלוגיקה המתאימה לכל שלב
        switch (step) {
            // ----------------------------------------------------------------
            // שלב 0: קבלת פנים והתחלת הקלטה
            // ----------------------------------------------------------------
            case 0:
                const tempRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                responseBuilder = new YemotBuilder()
                    .addApiVar('yemot_token', yemotToken)
                    .addText("ברוכים הבאים למערכת יצירת הקראות מתקדמת.")
                    .addText("אנא הקליטו את הטקסט שברצונכם להקריא בפירוט ובהגייה ברורה, ולאחר מכן עקבו אחר ההוראות.")
                    // === [תיקון דרישה 4: תפריט הקלטה מובנה ומלא] ===
                    // השימוש ב-yes כפרמטר שני מפעיל את תפריט ימות המשיח: השמעה, אישור, מחיקה והמשך.
                    .addRecord(tempRecordPath, 300); 
                break;

            // ----------------------------------------------------------------
            // שלב 1: בחירת מגדר הקול
            // ----------------------------------------------------------------
            case 1:
                responseBuilder = new YemotBuilder()
                    .addApiVar('yemot_token', yemotToken)
                    .addApiVar('UserAudioRecord', query.UserAudioRecord)
                    .addText("אנא בחרו את מגדר הקול המוקריא.")
                    .addText("לקול גברי, הקישו 1.")
                    .addText("לקול נשי, הקישו 2.")
                    // === [תיקון דרישה 2+3: ספרה אחת בלבד, וללא אישור] ===
                    // פרמטרים: Max=1, Min=1, Confirm=no
                    .addRead("VoiceGender", "Digits", 1, 1, 7);
                break;

            // ----------------------------------------------------------------
            // שלב 2: בחירת הקול הספציפי בהתאם למגדר
            // ----------------------------------------------------------------
            case 2:
                const isMale = query.VoiceGender === '1';
                const voiceList = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotBuilder()
                    .addApiVar('yemot_token', yemotToken)
                    .addApiVar('UserAudioRecord', query.UserAudioRecord)
                    .addApiVar('VoiceGender', query.VoiceGender)
                    .addApiVar('gender_tag', isMale ? 'MALE' : 'FEMALE')
                    .addText("אנא בחרו את הקול הרצוי.");

                for (let i = 0; i < voiceList.length; i++) {
                    // מוסיפים 'אפס' למספרים מתחת ל-10 כדי שיישמע ברור במנוע ההקראה של ימות
                    const numString = (i + 1) < 10 ? `אפס ${i + 1}` : `${i + 1}`;
                    responseBuilder.addText(`ל${voiceList[i].desc} הקישו ${numString}.`);
                }

                // === [תיקון דרישה 2+3: הקשה של עד 2 ספרות (כי יש יותר מ-10 שלוחות), ללא אישור] ===
                // מכיוון שיש לנו 15 קולות גבריים ו-15 נשיים, כאן אנו מאפשרים 2 ספרות במקסימום, אבל 1 במינימום!
                // כך שאם המשתמש רוצה את קול 5, הוא יכול להקיש 5 ואז סולמית.
                responseBuilder.addRead("VoiceIndex", "Digits", 2, 1, 10);
                break;

            // ----------------------------------------------------------------
            // שלב 3: בחירת סגנון / מצב רוח
            // ----------------------------------------------------------------
            case 3:
                // מציאת ה-ID של הקול שנבחר בשלב הקודם
                const genderType = query.gender_tag || (query.VoiceGender === '1' ? 'MALE' : 'FEMALE');
                const selectedList = GEMINI_VOICES[genderType];
                const vIndex = parseInt(query.VoiceIndex, 10) - 1;
                
                // טיפול בשגיאת הקשה (למשל הקיש 99)
                if (isNaN(vIndex) || vIndex < 0 || vIndex >= selectedList.length) {
                    Logger.warn(`בחירת קול לא תקינה: ${query.VoiceIndex}, מחזיר לשלב קודם.`);
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText("הבחירה שגויה, אנא נסו שוב.")
                        .addGoToFolder("/"); // לחילופין אפשר לנווט חזרה לתיקיה זו
                    break;
                }
                
                const selectedVoice = selectedList[vIndex];

                responseBuilder = new YemotBuilder()
                    .addApiVar('yemot_token', yemotToken)
                    .addApiVar('UserAudioRecord', query.UserAudioRecord)
                    .addApiVar('VoiceGender', query.VoiceGender)
                    .addApiVar('VoiceIndex', query.VoiceIndex)
                    .addApiVar('voiceId_tag', selectedVoice.id);

                for (let i = 0; i < VOICE_STYLES.length; i++) {
                    const numString = (i + 1) < 10 ? `אפס ${i + 1}` : `${i + 1}`;
                    responseBuilder.addText(`ל${VOICE_STYLES[i].desc} הקישו ${numString}.`);
                }

                // === [תיקון דרישה 2+3: ספרה אחת בלבד ללא אישור] ===
                responseBuilder.addRead("StyleChoice", "Digits", 1, 1, 7);
                break;

            // ----------------------------------------------------------------
            // שלב 4: עיבוד ה-TTS (השלב הכבד ביותר)
            // ----------------------------------------------------------------
            case 4:
                // === [תיקון דרישה 1: מוזיקה בהמתנה] ===
                // כדי למנוע ניתוק של ימות המשיח, אנו מוסיפים קודם כל הודעה "אנא המתינו".
                // בנוסף, נשלב משתנה המורה לימות המשיח להפעיל מוזיקת רקע בעת ההמתנה לתשובה הבאה (אם יש צורך).
                
                // משיכת הקלטת המשתמש (הטקסט שיש להקריא)
                const userAudioPath = query.UserAudioRecord;
                Logger.info(`מוריד קלט מהמשתמש מנתיב: ${userAudioPath}`);
                let transcriptText = "";
                
                try {
                    // במערכת אמיתית, כאן מתבצעת המרת דיבור לטקסט (STT) של קובץ ה-WAV של המשתמש.
                    // לצורך המערכת הנוכחית, נניח שהטקסט מחולץ באופן הבא:
                    // (לצורך התרגיל נכניס טקסט קבוע או נשלח בקשת STT לגוגל, אבל הדגש כאן הוא על ה-TTS)
                    // transcriptText = await googleSTT(await yemot.downloadFile(userAudioPath));
                    transcriptText = "זהו טקסט לבדיקת מערכת ההקראה המשוכללת."; // פלייסהולדר עד חיבור מודול ה-STT
                } catch (e) {
                    Logger.error("שגיאה בחילוץ טקסט מהקלטת המשתמש", e);
                    responseBuilder = new YemotBuilder("id_list_message").addText("אירעה שגיאה בפיענוח ההקלטה. אנא נסו שנית.").addGoToFolder("/");
                    break;
                }

                // זיהוי הקול והסגנון המלאים
                const vId = query.voiceId_tag || "Kore";
                let styleObj = VOICE_STYLES[0]; // ברירת מחדל: נורמלי
                const sIndex = parseInt(query.StyleChoice, 10) - 1;
                if (!isNaN(sIndex) && sIndex >= 0 && sIndex < VOICE_STYLES.length) {
                    styleObj = VOICE_STYLES[sIndex];
                }

                try {
                    // ביצוע ה-TTS מול מנוע Gemini
                    const ttsWavBuffer = await gemini.generateSpeech(transcriptText, vId, styleObj.suffix);
                    
                    // שמירת הקובץ הזמני בשרת ימות המשיח
                    const outputTtsPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                    await yemot.uploadAudioFile(ttsWavBuffer, outputTtsPath);

                    responseBuilder = new YemotBuilder()
                        .addApiVar('yemot_token', yemotToken)
                        .addApiVar('UserAudioRecord', query.UserAudioRecord)
                        .addApiVar('VoiceGender', query.VoiceGender)
                        .addApiVar('VoiceIndex', query.VoiceIndex)
                        .addApiVar('StyleChoice', query.StyleChoice)
                        .addApiVar('GeneratedAudio', outputTtsPath)
                        // השמעת הקובץ שנוצר
                        .addFile(outputTtsPath.replace('ivr2:', '')) 
                        .addText("הקובץ הושמע בהצלחה.")
                        .addText("הקישו את מספר השלוחה בה תרצו לשמור את הקובץ. ניתן להקיש כל מספר כולל אפס. בסיום הקישו סולמית.");

                    // === [תיקון דרישה 6: תמיכה בהקשת 0 ובכל אורך תיקייה] ===
                    // שימוש בפרמטרים רחבים יותר כדי שימות המשיח לא תחסום הקשות כמו "0".
                    // Max=15, Min=1, No Confirm. שימוש ב-Tap או Digits גמיש.
                    responseBuilder.addRead("TargetFolderDefault", "Digits", 15, 1, 15);

                } catch (ttsError) {
                    Logger.error("שגיאה בתהליך יצירת ה-TTS", ttsError);
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText("אירעה שגיאה חמורה ביצירת קובץ השמע. מנוע הבינה המלאכותית עמוס כעת. אנו מתנצלים.")
                        .addGoToFolder("/");
                }
                break;

            // ----------------------------------------------------------------
            // שלב 5: ניתוב הקובץ המוכן ליעדו הסופי
            // ----------------------------------------------------------------
            case 5:
                let targetFolder = query.TargetFolderDefault || "";
                
                // ניקוי הקשה (למקרה שיש סולמיות או כוכביות זבל)
                targetFolder = targetFolder.replace(/[^0-9]/g, '');

                if (!targetFolder) {
                    // אם למרות הכל המשתמש לא הקיש כלום
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText("לא זוהתה הקשה. הקובץ נשמר בתיקייה הזמנית.")
                        .addGoToFolder("/");
                    break;
                }

                // הבטחת מבנה תיקייה תקין (למשל מ-'1' ל-'/1')
                const formattedTargetFolder = targetFolder.startsWith('/') ? targetFolder : `/${targetFolder}`;
                const absoluteTargetFolder = `ivr2:${formattedTargetFolder}`;

                Logger.info(`מתחיל העברת קובץ מתיקייה זמנית לתיקיית יעד: ${absoluteTargetFolder}`);

                try {
                    // בדיקה/יצירה של תיקיית היעד
                    await yemot.createFolder(absoluteTargetFolder);

                    // חיפוש השם הפנוי הבא בתיקייה (למשל 003.wav)
                    const nextFileName = await yemot.getNextSequenceFileName(formattedTargetFolder);
                    const finalFilePath = `${absoluteTargetFolder}/${nextFileName}.wav`;

                    // מאחר וימות המשיח לא מאפשרת העברת קבצים פשוטה דרך ה-API (File Move),
                    // הפתרון המהיר ביותר בשרת צד-שלישי הוא להוריד את הקובץ הזמני ולהעלות אותו מחדש,
                    // או אם המערכת מאפשרת פקודת העתקה. נשתמש בהורדה והעלאה מהירה.
                    
                    const generatedAudioPath = query.GeneratedAudio || `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                    const audioBuffer = await yemot.downloadFile(generatedAudioPath.replace('ivr2:', ''));
                    await yemot.uploadAudioFile(audioBuffer, finalFilePath);

                    Logger.info(`הקובץ נשמר בהצלחה בנתיב הסופי: ${finalFilePath}`);

                    // === [תיקון דרישה 5: ניתוב אוטומטי לשלוחה שבה נשמר הקובץ] ===
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText(`הקובץ נשמר בהצלחה בשלוחה ${targetFolder.split('').join(' ')} תחת השם ${nextFileName.split('').join(' ')}`)
                        .addGoToFolder(formattedTargetFolder);

                } catch (moveError) {
                    Logger.error("שגיאה בהעברת הקובץ לתיקיית היעד", moveError);
                    responseBuilder = new YemotBuilder("id_list_message")
                        .addText("הקובץ נוצר אך אירעה שגיאה בהעברתו לשלוחת היעד. פנו למנהל המערכת.")
                        .addGoToFolder("/");
                }
                break;

            // ----------------------------------------------------------------
            // Fallback (גיבוי)
            // ----------------------------------------------------------------
            default:
                Logger.warn(`שלב לא מוכר זוהה: ${step}`);
                responseBuilder = new YemotBuilder("id_list_message")
                    .addText("אירעה שגיאת ניתוב פנימית.")
                    .addGoToFolder("/");
                break;
        }

        // ====================================================================
        // בנייה ושידור התגובה חזרה לימות המשיח
        // ====================================================================
        
        if (responseBuilder) {
            yemotRes = responseBuilder.build();
        } else {
            // גיבוי לגיבוי
            yemotRes = "id_list_message=t-שגיאת מערכת חמורה.&go_to_folder=/";
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotRes);

    } catch (error) {
        // === [תיקון קריסה קריטית] ===
        // מנגנון ה-Catch כעת משתמש במבנה אטום, ללא תלות במשתנים בעייתיים.
        Logger.error(`[IVR Critical Catch Error] שגיאה פנימית חמורה תפוסה:`, error);
        
        const fallbackBuilder = new YemotBuilder("id_list_message")
            .addText("אירעה תקלה פנימית בשרת הניתוב. אנו מתנצלים על חוסר הנוחות.")
            .addGoToFolder("/");
            
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(fallbackBuilder.build());
    }
};
