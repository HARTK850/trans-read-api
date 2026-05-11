/**
 * @file api/index.js
 * @version 20.5.0 (Ultimate Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל.
 * 
 * יכולות חדשות בגרסה זו:
 * 1. Role-Based Access Control (RBAC): הפרדה שקטה בין מנהלים למאזינים.
 * 2. Admin Management Dashboard: קריאת קבצים מקוטלגים, מחיקה ומעבר בין קבצים.
 * 3. Haredi Content Filter: מנגנון סינון דתי פנימי בתוך ה-AI וזריקה שקטה החוצה במקרה של עבירה.
 * 4. Background Generation: שחרור המאזין מהמתנה בזמן שהקובץ מיוצר ונשמר ברקע.
 * 5. Dynamic Configuration: קריאת נתוני מספרי מנהלים ושלוחות יעד מתוך ext.ini.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');

const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// YemotCommandBuilder - בניית פקודות תקניות לימות המשיח
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks =[]; 
        this.params =[]; 
        this.nextState = {}; 
        this.goToFolder = null; 
    }

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
     * פונקציה חכמה למניעת בקשות אישור.
     * מבוסס על מבנה 9 פרמטרים. No מבטל "לאישור הקישו 1".
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = false) {
        const playType = disableConfirmation ? "No" : "Digits"; 
        const blockZero = allowZero ? "no" : "yes"; 

        this.params =[
            varName,               
            "no",                  
            "Digits",              
            maxDigits.toString(),  
            minDigits.toString(),  
            timeout.toString(),    
            playType,              
            "yes",                 // block asterisk
            blockZero              // block zero
        ];
        return this;
    }

    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   
            "no",      
            "record",  
            folder,    
            fileName,  
            "no",      // הפעלת תפריט מלא! (1 שמיעה, 2 אישור)
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

        if (this.action === "read" && this.params.length > 0) {
            res = `read=${textPart}=${this.params.join(',')}`;
        } else if (this.action === "id_list_message") {
            res = `id_list_message=${textPart}`;
        } else if (this.action === "go_to_folder") {
            res = `go_to_folder=${this.goToFolder || "/"}`;
        } else {
            res = `${this.action}=${textPart}`;
        }

        let index = 0;
        let apiAddStr = "";
        for (const [key, value] of Object.entries(this.nextState)) {
            apiAddStr += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
            index++;
        }

        res += apiAddStr;

        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// הליבה: Serverless Request Handler
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        if (query.hangup === "yes") {
            TelemetryLogger.info("MainHandler", "Hangup", "המאזין ניתק, עוצר.");
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        if (!YEMOT_TOKEN) {
            return res.status(200).send("id_list_message=t-תקלה במערכת חסר מפתח&hangup=yes");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        const ApiPhone = query.ApiPhone || "UnknownPhone";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        // שליפת הגדרות מה-ext.ini דרך ה-URL Query
        const adminPhonesStr = query.admin_phones || "";
        const adminPhonesList = adminPhonesStr.split(',').map(p => p.trim());
        const isAdmin = adminPhonesList.includes(ApiPhone);
        
        // תיקיית השמירה של המאזינים (מוגדר ב-ext.ini)
        const userSaveDir = query.user_tts_save_folder || "/";

        // זיהוי השלב הנוכחי
        let state = parseInt(query.state || "0", 10);
        
        // זיהוי התקדמות מנהל
        if (query.AdminChoice) state = 101;
        else if (query.AdminCatChoice) state = 102;
        else if (query.AdminFileAction) state = 104;
        
        // זיהוי התקדמות מאזין
        if (query.UserAudioRecord) state = 201;
        else if (query.UserWaitChoice) state = 202;
        else if (query.VoiceGender) state = 301;
        else if (query.VoiceIndex) state = 302;

        // ניתוב שקט התחלתי
        if (state === 0) {
            state = isAdmin ? 100 : 200;
        }

        TelemetryLogger.info("FlowController", "State", `טלפון: ${ApiPhone} | מנהל: ${isAdmin} | שלב: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            // ====================================================================
            // ========================= זרימת מנהלים =========================
            // ====================================================================
            case 100:
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("ברוך הבא מנהל המערכת")
                    .addText("לניהול הקראות מאזינים הקישו 1 ליצירת הקראה חדשה הקישו 2")
                    .setReadDigitsAdvanced("AdminChoice", 1, 1, 15, true, false);
                break;

            case 101:
                if (query.AdminChoice === "2") {
                    // מנהל בחר ליצור הקראה - נעביר אותו למסלול היצירה (סטייט 200)
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                        .addState("state", 200); // רושמים שזה State 200 לקריאה הבאה!
                    break;
                } else if (query.AdminChoice === "1") {
                    // מנהל בחר ניהול - נמשוך את מסד הנתונים של הקטגוריות
                    const registry = await yemot.getRegistry();
                    const categories = Object.keys(registry.categories);
                    
                    if (categories.length === 0) {
                        responseBuilder = new YemotCommandBuilder("id_list_message")
                            .addText("אין כרגע הקראות במערכת")
                            .addGoToFolder("/");
                        break;
                    }

                    responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו קטגוריה לניהול");
                    categories.forEach((cat, index) => {
                        responseBuilder.addText(`לקטגורית ${cat} הקישו ${index + 1}`);
                    });
                    
                    responseBuilder
                        .setReadDigitsAdvanced("AdminCatChoice", 2, 1, 15, true, false)
                        .addState("state", 101); // נשאר פה לקריאה הבאה
                    break;
                } else {
                    responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
                    break;
                }

            case 102:
                // מנהל בחר קטגוריה
                const registryCat = await yemot.getRegistry();
                const catKeys = Object.keys(registryCat.categories);
                const selectedCatIdx = parseInt(query.AdminCatChoice, 10) - 1;
                
                if (selectedCatIdx < 0 || selectedCatIdx >= catKeys.length) {
                    responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
                    break;
                }

                const selectedCatName = catKeys[selectedCatIdx];
                const filesInCat = registryCat.categories[selectedCatName];

                if (!filesInCat || filesInCat.length === 0) {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("אין קבצים בקטגוריה זו")
                        .addGoToFolder("/");
                    break;
                }

                // שומרים את מערך הקבצים המבוקשים לקובץ זמני כדי שנוכל לרוץ עליו בלולאה
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiPhone}_queue.txt`, JSON.stringify(filesInCat));

                // קופצים לסטייט ניגון הלולאה עם אינדקס 0
                yemotRes = `go_to_folder=.&api_add_0=state=103&api_add_1=fileIndex=0&api_add_2=catName=${encodeURIComponent(selectedCatName)}`;
                break;

            case 103:
                // לולאת הניגון למנהל
                const fileIndex = parseInt(query.fileIndex || "0", 10);
                const catName = query.catName;
                
                const queueData = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiPhone}_queue.txt`);
                const fileQueue = JSON.parse(queueData || "[]");

                if (fileIndex >= fileQueue.length) {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("אין עוד קבצים בקטגוריה זו")
                        .addGoToFolder("/");
                    break;
                }

                const fileToPlay = fileQueue[fileIndex];
                
                // שימו לב: משמיע את הקובץ ומיד שואל פעולה.
                responseBuilder = new YemotCommandBuilder("read")
                    .addFile(fileToPlay.replace("ivr2:/", "").replace("ivr2:", "")) // מנקה קידומת
                    .addText("להמשך לקובץ הבא הקישו 1 למחיקת הקובץ הקישו 2")
                    .setReadDigitsAdvanced("AdminFileAction", 1, 1, 10, true, false)
                    .addState("state", 103)
                    .addState("fileIndex", fileIndex)
                    .addState("catName", catName)
                    .addState("currentFile", fileToPlay);
                break;

            case 104:
                // פעולת מנהל על הקובץ (הבא או מחק)
                let nextIndex = parseInt(query.fileIndex, 10) + 1;
                const actCatName = query.catName;
                const currentFile = query.currentFile;

                if (query.AdminFileAction === "2") {
                    // מחיקה!
                    await yemot.deleteFile(currentFile);
                    await yemot.removeFromRegistry(actCatName, currentFile);
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("הקובץ נמחק בהצלחה מעביר לקובץ הבא")
                        .setReadDigitsAdvanced("AutoAdvance", 1, 1, 1, true, false) // פקודת דמה למעבר מהיר
                        .addState("state", 103)
                        .addState("fileIndex", nextIndex)
                        .addState("catName", actCatName);
                } else {
                    // המשך רגיל
                    yemotRes = `go_to_folder=.&api_add_0=state=103&api_add_1=fileIndex=${nextIndex}&api_add_2=catName=${encodeURIComponent(actCatName)}`;
                }
                break;

            // ====================================================================
            // ========================= זרימת מאזינים =========================
            // ====================================================================
            case 200:
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 201:
                // STT + Haredi Filter + Emotion & Category Extraction
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                const geminiOutput = await gemini.transcribeAndAnalyze(mainAudioBuffer);
                
                // בדיקת סינון חרדי קפדנית!
                if (geminiOutput === "[BLOCKED_HAREDI]") {
                    TelemetryLogger.warn("Security", "HarediFilter", `נחסם תוכן בעייתי מהמספר ${ApiPhone}`);
                    // זריקה שקטה החוצה בלי לחשוף שזה AI או סינון
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("הינך מוחזר לתפריט הראשי קובץ השמע יהיה מוכן בהמשך")
                        .addGoToFolder("/");
                    break;
                }

                if (!geminiOutput || geminiOutput.length < 2) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("ההקלטה לא הייתה ברורה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    break;
                }

                // חילוץ הקטגוריה והטקסט מתוך הפלט של ג'מיני
                let category = "כללי";
                let textForTTS = geminiOutput;
                
                const catMatch = geminiOutput.match(/\[CAT:\s*(.*?)\]/);
                if (catMatch) {
                    category = catMatch[1].trim();
                    textForTTS = geminiOutput.replace(/\[CAT:\s*(.*?)\]/, "").trim();
                }

                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, textForTTS);
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_cat.txt`, category);

                responseBuilder = new YemotCommandBuilder("read")
                    .addText("ההקלטה נקלטה בהצלחה")
                    .addText("הכנת קובץ השמע עשויה לקחת מספר דקות")
                    .addText("להמתנה על הקו עד שהקובץ יהיה מוכן הקישו 1")
                    .addText("לחזרה לתפריט הראשי וקבלת הקובץ בהמשך הקישו 2")
                    .setReadDigitsAdvanced("UserWaitChoice", 1, 1, 15, true, false);
                break;

            case 202:
                if (query.UserWaitChoice === "2") {
                    // בחירה בייצור ברקע ויציאה שקטה
                    // 1. אנו מחזירים לימות המשיח פקודת יציאה (כדי לשחרר את הלקוח).
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.status(200).send("id_list_message=t-הקובץ מוכן ברקע&go_to_folder=/");
                    
                    // 2. ממשיכים את הביצוע אסינכרונית מאחורי הקלעים ב-Vercel (Background processing)
                    // (שים לב שזה יעבוד מושלם בסביבות שתומכות בהמשך ריצה, או על Vercel Pro).
                    try {
                        const bgText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                        const bgCat = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_cat.txt`) || "כללי";
                        
                        // קול ברירת מחדל איכותי לגברים למי שיצא מוקדם
                        const bgBuffer = await gemini.generateTTS(bgText, "Charon");
                        
                        const bgSeq = await yemot.getNextSequenceFileName(userSaveDir);
                        const bgFinalPath = `ivr2:/${cleanAndSanitizeFolder(userSaveDir)}/${bgSeq}.wav`;
                        await yemot.uploadFile(bgFinalPath, bgBuffer);
                        
                        // עדכון מסד נתונים של מנהלים
                        await yemot.saveToRegistry(bgCat, bgFinalPath);
                        TelemetryLogger.info("Background", "Complete", `הופק ונשמר בהצלחה ברקע: ${bgFinalPath}`);
                    } catch (e) {
                        TelemetryLogger.error("Background", "Failed", "שגיאה בייצור רקע", e);
                    }
                    return; // סיימנו כאן, אין צורך להגיע לסוף הפונקציה

                } else {
                    // הלקוח בחר להמתין - עוברים לבחירת גבר/אישה
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("לבחירת קול קריין גברי הקישו 1 לבחירת קול קריינית נשית הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false)
                        .addState("state", 300); // שינוי שלב ידני כדי שיתאים לזרימה
                }
                break;

            case 301:
                // תפריט הקולות (2 ספרות - מקריא "אפס אחד")
                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקול הרצוי");
                for (let i = 0; i < voices.length; i++) {
                    const spokenNum = (i + 1) < 10 ? `אפס ${i + 1}` : `${i + 1}`;
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }
                responseBuilder.addText("ובסיום הקישו סולמית");

                responseBuilder
                    .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, false)
                    .addState("gender", isMale ? "MALE" : "FEMALE");
                break;

            case 302:
                // הלקוח בחר קול - יצירת ה-TTS המיידי (הסגנון מוסק מהסוגריים)
                const voiceListCheck = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                const selectedVoiceId = (checkIdx >= 0 && checkIdx < voiceListCheck.length) ? voiceListCheck[checkIdx].id : voiceListCheck[0].id;
                
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                const userCategory = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_cat.txt`) || "כללי";
                
                // ה-AI מייצר את ההקראה!
                const ttsBuffer = await gemini.generateTTS(mainTextForTTS, selectedVoiceId);
                
                const finalSeqFileName = await yemot.getNextSequenceFileName(userSaveDir);
                const destPath = `ivr2:/${cleanAndSanitizeFolder(userSaveDir)}/${finalSeqFileName}.wav`;

                await yemot.uploadFile(destPath, ttsBuffer);
                await yemot.saveToRegistry(userCategory, destPath); // עדכון DB מנהלים!

                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addFile(destPath.replace("ivr2:/", "").replace("ivr2:", "")) // משמיע לו את מה שהופק
                    .addText("קובץ השמע מוכן ונשמר במערכת תודה ולהתראות")
                    .addGoToFolder("/");
                break;

            default:
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
        }

        // שידור לימות המשיח עם שרשור פרמטרים חכם
        if (responseBuilder) {
            yemotFinalResponse = responseBuilder.build();
            // העברת משתני תצורה נסתרים
            const paramsToAdd = {
                yemot_token: YEMOT_TOKEN,
                admin_phones: adminPhonesStr,
                user_tts_save_folder: userSaveDir,
                state: responseBuilder.nextState.state || state
            };
            
            let idx = 90; // שומר מקום אחורה
            for (const[k, v] of Object.entries(paramsToAdd)) {
                if (v && yemotFinalResponse.includes("=")) {
                    yemotFinalResponse += `&api_add_${idx}=${k}=${encodeURIComponent(v)}`;
                    idx++;
                }
            }
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        TelemetryLogger.error("MainHandler", "CriticalError", "קריסת שרת", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה פנימית אנו מתנצלים&go_to_folder=/");
    }
};
