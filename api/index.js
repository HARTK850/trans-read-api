/**
 * @file api/index.js
 * @description נקודת הכניסה למערכת ה-IVR מבוססת Gemini API עבור ימות המשיח.
 * תוקן: הגדרות ספרות בתפריטים, ביטול אישור הקשה, מעבר אוטומטי, ותפריט הקלטה מלא.
 */

const { GeminiManager, YemotManager, YemotBuilder, GEMINI_VOICES } = require('./core');

// ============================================================================
// הגדרות והתחלת מופעים
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [
    "YOUR_GEMINI_API_KEY_1" // שים כאן את המפתח האמיתי שלך בסביבת Vercel
];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App";

module.exports = async function handler(req, res) {
    // אתחול משתנה התשובה לימות המשיח כדי למנוע את קריסת ה-ReferenceError שהייתה
    let yemotRes = ""; 
    let responseBuilder = null;

    try {
        const query = req.method === 'POST' ? req.body : req.query;
        
        // תיעוד הבקשה
        console.log(`[Incoming Request] Phone: ${query.ApiPhone} | CallID: ${query.ApiCallId}`);

        if (query.hangup === 'yes') {
            console.log(`[Hangup Event] שיחה נותקה בצד הלקוח. (CallID: ${query.ApiCallId})`);
            return res.status(200).send("");
        }

        const yemot = new YemotManager(query.yemot_token);
        
        // ============================================================================
        // לוגיקת "משתנים מתגלגלים" עבור תפריט ההקלטה (למניעת לולאות אינסופיות ללא איפוס)
        // ============================================================================
        let currentRecordMenuValue = null;
        let currentRecordMenuKey = 'RecordMenu1'; // ברירת מחדל לשלב הראשון
        
        for (let i = 1; i <= 20; i++) {
            if (query[`RecordMenu${i}`]) {
                currentRecordMenuValue = query[`RecordMenu${i}`];
                // אם מצאנו משתנה קיים, נכין את המפתח הבא למקרה שנצטרך לשאול שוב
                currentRecordMenuKey = `RecordMenu${i + 1}`; 
            }
        }

        // ============================================================================
        // State Machine - ניהול שלבי השיחה
        // ============================================================================

        // שלב 0: קבלת קובץ ההקלטה וניהול התפריט המובנה
        if (query.UserAudioRecord) {
            
            // אם המאזין עדיין לא בחר מה לעשות עם ההקלטה
            if (!currentRecordMenuValue) {
                let menuText = "t-ההקלטה הסתיימה בהצלחה. לשמיעת ההקלטה הקישו 1. לאישור ההקלטה הקישו 2. להקלטה מחדש הקישו 3. להקלטת המשך הקישו 4.";
                responseBuilder = new YemotBuilder()
                    // דורש רק ספרה 1, ללא אישור (no)
                    .addGetUserInput(currentRecordMenuKey, menuText, 1, 1, 7);
                
                yemotRes = responseBuilder.build();
                return res.status(200).send(yemotRes);
            }

            // ניהול בחירות המאזין בתפריט ההקלטה:
            if (currentRecordMenuValue === '1') {
                // המאזין בחר לשמוע את ההקלטה.
                // נשמיע אותה (f-נתיב), ומיד נשאל אותו שוב באמצעות משתנה ה-RecordMenu הבא בתור.
                let nextMenuText = `f-${query.UserAudioRecord}.t-לאישור ההקלטה הקישו 2. להקלטה מחדש הקישו 3. להקלטת המשך הקישו 4. לשמיעה חוזרת הקישו 1.`;
                responseBuilder = new YemotBuilder()
                    .addGetUserInput(currentRecordMenuKey, nextMenuText, 1, 1, 7);
                yemotRes = responseBuilder.build();
                return res.status(200).send(yemotRes);
            }
            else if (currentRecordMenuValue === '3' || currentRecordMenuValue === '4') {
                // המאזין בחר להקליט מחדש (3) או להקליט המשך (4)
                // הדרך הבטוחה ביותר לאפשר זאת היא לנתב אותו מחדש לשלוחה הנוכחית כדי לאפס את תהליך ההקלטה המובנה
                responseBuilder = new YemotBuilder()
                    .addIdListMessage("t-אנא המתינו")
                    .addGoToFolder(`/${query.ApiExtension}`);
                yemotRes = responseBuilder.build();
                return res.status(200).send(yemotRes);
            }
            else if (currentRecordMenuValue === '2') {
                // המאזין אישר את ההקלטה! ממשיכים לשלב בחירת הקול.
                // עוברים לשלב הבא (המערכת תדלג ל-VoiceIndex למטה כי אין החזרה כאן)
            }
        } else {
            // אם אין עדיין הקלטה, מחזירים לשלוחה (או מפעילים מודול הקלטה אם זה היה דרך ה-API)
            // במקרה הזה, ימות המשיח כבר אמור לספק את ההקלטה לפני הכניסה ל-API.
            responseBuilder = new YemotBuilder()
                .addIdListMessage("t-לא נמצאה הקלטה במערכת")
                .addGoToFolder(`/${query.ApiExtension}`);
            yemotRes = responseBuilder.build();
            return res.status(200).send(yemotRes);
        }

        // שלב 1: בחירת הקול (VoiceIndex)
        if (!query.VoiceIndex) {
            let voicesText = "t-אנא בחרו את הקול הרצוי. ";
            GEMINI_VOICES.MALE.forEach((v, index) => {
                // התאמת המספר לתצוגה שמעית (01, 02...)
                let numStr = (index + 1).toString().padStart(2, '0');
                voicesText += `t-${v.desc} הקישו ${numStr}. `;
            });

            responseBuilder = new YemotBuilder()
                // כאן אנו דורשים 2 ספרות בדיוק (כי יש 15 קולות), ללא אישור (no)
                .addGetUserInput("VoiceIndex", voicesText, 2, 2, 10);
            
            yemotRes = responseBuilder.build();
            return res.status(200).send(yemotRes);
        }

        // שלב 2: בחירת סגנון / טון (StyleChoice)
        if (!query.StyleChoice) {
            let styleText = "t-לבחירת סגנון רגיל הקישו 1. t-לסגנון שמח ונלהב הקישו 2. t-לסגנון רציני הקישו 3. t-לסגנון מותאם אישית הקישו 4.";
            responseBuilder = new YemotBuilder()
                // דורש רק ספרה 1, ללא אישור (no)
                .addGetUserInput("StyleChoice", styleText, 1, 1, 7);
            
            yemotRes = responseBuilder.build();
            return res.status(200).send(yemotRes);
        }

        // שלב 3 ו-4: המרה, שמירה ובחירת שלוחת יעד
        if (!query.TargetFolder && query.TargetFolder !== '0') {
            
            // לפני שמבקשים את שלוחת היעד, אנחנו נבצע את ההמרה. 
            // ימות המשיח ישמיע את מוזיקת ההמתנה (api_wait_play) כל עוד בקשת ה-HTTP הזו פתוחה וללא שגיאות.
            const voiceIndexInt = parseInt(query.VoiceIndex, 10) - 1;
            const selectedVoice = GEMINI_VOICES.MALE[voiceIndexInt] || GEMINI_VOICES.MALE[0];
            
            // המרת אודיו לטקסט (בפרויקט מלא משתמשים במודל זיהוי דיבור, כאן נדמה שיש לנו את הטקסט)
            // נוריד את קובץ האודיו שהמאזין הקליט
            const userAudioBuffer = await yemot.downloadFile(query.UserAudioRecord);
            
            // הערה: יש לבצע כאן תמלול של userAudioBuffer בעזרת Gemini או STT אחר.
            // לצורך ההדגמה והרצף, נניח שהטקסט תומלל בהצלחה:
            const transcribedText = "זהו טקסט דוגמה שהומר מהקלטת המשתמש. " + selectedVoice.desc; 

            // הפעלת מנוע ה-TTS של ג'מיני - ייקח מספר שניות
            const ttsAudioBuffer = await gemini.generateTTS(transcribedText, selectedVoice.id, selectedVoice.promptCue);
            
            // העלאת הקובץ לתיקייה הזמנית בימות המשיח
            const tempFilePath = `${TEMP_FOLDER}/${query.ApiCallId}_tts.wav`;
            await yemot.uploadFile(tempFilePath, ttsAudioBuffer);

            // כעת נבקש מהמאזין את שלוחת היעד
            let targetText = `f-${tempFilePath}.t-הקובץ הושמע בהצלחה. הקישו את מספר השלוחה בה תרצו לשמור את הקובץ ובסיום הקישו סולמית.`;
            
            responseBuilder = new YemotBuilder()
                // מוגדר למינימום 1 ספרות, מקסימום 10. מקבל '0', ומסתיים בהקשת סולמית. ללא אישור נוסף.
                .addGetUserInput("TargetFolder", targetText, 10, 1, 15);
            
            yemotRes = responseBuilder.build();
            return res.status(200).send(yemotRes);
        }

        // שלב אחרון: העברת הקובץ לשלוחת היעד שסיפק המשתמש והעברה אוטומטית אליה
        if (query.TargetFolder || query.TargetFolder === '0') {
            // מסדרים את הנתיב אם המשתמש הקיש כוכבית (שמתורגמת ללוכסן)
            const finalFolder = query.TargetFolder.replace(/\*/g, "/");
            const tempFilePath = `${TEMP_FOLDER}/${query.ApiCallId}_tts.wav`;
            
            // בדרך כלל נמצא את המספר הסידורי הבא בשלוחה - בקוד מלא נשתמש ב-getNextSequenceFileName
            const finalFilePath = `ivr2:/${finalFolder}/000.wav`; 
            
            await yemot.moveFile(tempFilePath, finalFilePath);

            // סיום השיחה ב-API והעברה *אוטומטית* לשלוחה שבה נשמר הקובץ
            responseBuilder = new YemotBuilder()
                .addIdListMessage("t-הקובץ נוצר ונשמר בהצלחה")
                .addGoToFolder(`/${finalFolder}`);
            
            yemotRes = responseBuilder.build();
            return res.status(200).send(yemotRes);
        }

    } catch (error) {
        // מנגנון תפיסת שגיאות קריטיות מתוקן - מונע קריסת שרת
        console.error(`[IVR Critical Catch Error]`, error);
        responseBuilder = new YemotBuilder()
            .addIdListMessage("t-אירעה שגיאה במערכת אנו מתנצלים")
            .addGoToFolder(`/`);
        yemotRes = responseBuilder.build();
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(yemotRes);
    }
};
