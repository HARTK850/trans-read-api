/**
 * @file api/index.js
 * @version 20.0.0 (Glatt Kosher Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" לאולפן ההפקות.
 * 
 * פיצ'רים בגרסה זו:
 * 1. פיצול אבטחה סמוי (Stealth Auth) בין מנהלים למאזינים לפי זיהוי CallerID.
 * 2. מנוע השמעת קבצים (Playback Engine) מותאם אישית למנהלים לאישור/מחיקת קריינויות.
 * 3. הסרת כל סממן AI - שימוש בטרמינולוגיה של "אולפן", "עריכה" ו"צוות מקצועי".
 * 4. פילטר צניעות וסינון תוכן אקטיבי - השמדת בקשות פוגעניות בשקט.
 * 5. עיבוד רקע (Background Worker) עם טיימר אנושי של 3 דקות להגברת אמינות.
 * 6. סידור מדויק של 16 פרמטרים לפקודת Read לביטול מוחלט של "לאישור הקישו 1".
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות וקבועים (Enterprise Configuration)
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :[ "YOUR_DEFAULT_API_KEY_HERE" ];

const gemini = new GeminiManager(GEMINI_API_KEYS);

// מספרי המנהלים المורשים (Hardcoded Security)
const ADMIN_PHONES =["0548582624", "0534170633"];

// תיקיות עבודה
const TEMP_FOLDER = "/Temp_Studio_App"; // תיקיית אולפן זמנית
const DEFAULT_LISTENER_FOLDER = "/Listener_Audio"; // תיקיית ברירת מחדל אם לא סופקה בהגדרות

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות (YemotCommandBuilder)
// מותאם בדיוק למפרט 16 הפרמטרים למניעת באגים בתפריטים.
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks =[]; 
        this.params =[]; 
        this.nextState = {}; 
        this.goToFolder = null; 
    }

    /**
     * מנקה טקסט עברית מסימני פיסוק ששוברים את ימות המשיח.
     */
    cleanYemotText(text) {
        if (!text) return "";
        return text.toString().replace(/[.,-]/g, " ").replace(/\s+/g, " ").trim();
    }

    /**
     * הוספת בלוק הקראה
     */
    addText(text) {
        const cleanStr = this.cleanYemotText(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    /**
     * הוספת השמעת קובץ
     */
    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    /**
     * הגדרת קלט מספרי מתקדם - פותר את בעיות ה"מינימום ספרות" ומבטל "לאישור הקישו 1".
     * מחייב להעביר 16 פרמטרים מופרדים בפסיק בהתאם לתקן ימות המשיח.
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        const playType = disableConfirmation ? "No" : "Digits"; // No במקום Digits מבטל הקראת "הקשת X"
        const blockAsterisk = autoReplaceAsteriskWithSlash ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes"; 
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";
        const askConfirm = disableConfirmation ? "no" : ""; // no כאן חוסם את 'לאישור הקישו 1'

        this.params =[
            varName,               // 1. שם משתנה
            "no",                  // 2. האם להשתמש בקיים
            "Digits",              // 3. סוג קלט
            maxDigits.toString(),  // 4. מקסימום ספרות
            minDigits.toString(),  // 5. מינימום ספרות
            timeout.toString(),    // 6. זמן המתנה בשניות
            playType,              // 7. השמעת ההקשה (No = ביטול מוחלט)
            blockAsterisk,         // 8. חסימת כוכבית
            blockZero,             // 9. חסימת אפס
            replaceChar,           // 10. החלפת תווים
            "",                    // 11. מקשים מורשים (ריק = הכל)
            "",                    // 12. כמות פעמים
            "",                    // 13. המשך אם ריק
            "",                    // 14. פולבק ריק
            "",                    // 15. מודל מקלדת
            askConfirm             // 16. אישור הקשה סופי ("no")
        ];
        return this;
    }

    /**
     * הגדרת קלט הקלטה (Record). שומר על התפריט המקורי של ימות (1 לשמיעה, 2 לאישור).
     */
    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   // 1. משתנה 
            "no",      // 2. להשתמש בקיים
            "record",  // 3. סוג קלט
            folder,    // 4. תיקיית יעד בימות
            fileName,  // 5. שם קובץ
            "no",      // 6. הפעלת התפריט המלא של ימות (לשמיעה 1, אישור 2, מחודש 3)
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. לא לשרשר לקובץ קודם
        ];
        return this;
    }

    addState(key, value) {
        if (value !== undefined && value !== null) {
            this.nextState[key] = value;
        }
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

        // צירוף המשתנים ל-API Add
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
// פונקציות עזר גלובליות
// ============================================================================

/**
 * מנקה ומסדר נתיב תיקייה. מונע שגיאות של כפילות סלשים או ניתוב לשורש בטעות.
 */
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; 
    let sanitized = rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").trim();
    if (sanitized.startsWith("/")) sanitized = sanitized.substring(1);
    if (sanitized.endsWith("/")) sanitized = sanitized.slice(0, -1);
    return sanitized;
}

/**
 * מעביר את פונקציית ההפקה לתהליך רקע אסינכרוני עם השהיה אנושית של 3 דקות!
 */
async function processListenerAudioInBackground(yemot, ApiCallId, listenerFolder, voiceId) {
    try {
        TelemetryLogger.info("BackgroundWorker", "Start", `מתחיל תהליך רקע עבור: ${ApiCallId}. ממתין 3 דקות להדמיית עבודה אנושית.`);
        
        // השהיה אנושית של 3 דקות (180,000 מילישניות) כנדרש.
        // אזהרה טכנית: בסביבות Serverless כמו Vercel (Hobby), התהליך עלול להיהרג אחרי 10-60 שניות. 
        // הקוד נכתב לטובת שרתי Node.js תקניים או Vercel Pro.
        await new Promise(resolve => setTimeout(resolve, 180000));
        
        TelemetryLogger.info("BackgroundWorker", "Processing", `מתחיל ניתוח טקסט עבור: ${ApiCallId}`);
        const recordPath = `${TEMP_FOLDER}/${ApiCallId}_lis.wav`;
        const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
        
        // 1. תמלול + סינון גלאט כושר (הכל בפעולה אחת בג'מיני)
        const moderationResult = await gemini.transcribeAndModerateAudio(audioBuffer);
        
        // 2. אם התוכן לא ראוי - משמידים בשקט!
        if (!moderationResult.is_kosher) {
            TelemetryLogger.warn("BackgroundWorker", "KosherFilter", `התוכן נפסל על ידי ה-AI (לא כשר). מזהה: ${ApiCallId}. הטקסט: ${moderationResult.text}`);
            // מוחקים את ההקלטה מהשרת כדי שלא תתפוס מקום
            await yemot.deleteFile(`ivr2:${recordPath}`);
            return; // מסיים תהליך בלי להפיק TTS!
        }
        
        TelemetryLogger.info("BackgroundWorker", "KosherFilter", `התוכן אושר. קטגוריה שזוהתה: ${moderationResult.category}`);

        // 3. הפקת האודיו
        const ttsBuffer = await gemini.generateTTS(moderationResult.text, voiceId, moderationResult.emotion);
        
        // 4. תיוק התיקייה הסופית לפי קטגוריה
        const cleanListenerFolder = cleanAndSanitizeFolder(listenerFolder);
        // יצירת שם התיקייה המלא כולל הקטגוריה שה-AI קבע
        const categoryFolder = cleanListenerFolder ? `${cleanListenerFolder}/${moderationResult.category}` : moderationResult.category;
        
        const nextFileName = await yemot.getNextSequenceFileName(categoryFolder);
        const finalPath = `ivr2:/${categoryFolder}/${nextFileName}.wav`;
        
        // 5. העלאה ושמירה
        await yemot.uploadFile(finalPath, ttsBuffer);
        TelemetryLogger.info("BackgroundWorker", "Done", `הקובץ נוצר בהצלחה ונשמר בנתיב: ${finalPath}`);
        
        // ניקוי הקובץ הזמני
        await yemot.deleteFile(`ivr2:${recordPath}`);
        
    } catch (error) {
        TelemetryLogger.error("BackgroundWorker", "Error", "כשל בתהליך הרקע.", error);
    }
}

// ============================================================================
// מערכות State פנימיות
// ============================================================================

/**
 * שואב פרמטרים מרכזיים מקריאת הרשת
 */
function extractContext(query) {
    return {
        ApiPhone: query.ApiPhone || "UnknownPhone",
        ApiCallId: query.ApiCallId || "UnknownCallId",
        isAdmin: ADMIN_PHONES.includes(query.ApiPhone),
        YemotToken: query.yemot_token || process.env.YEMOT_TOKEN,
        // השלוחה שנקבעה בקובץ ה-ext.ini (למשל api_add_1=listener_folder=/2/5)
        listenerFolder: query.listener_folder || DEFAULT_LISTENER_FOLDER 
    };
}

// ============================================================================
// מנהל מסלול מנהלים (Admin Flow Controller)
// ============================================================================
async function handleAdminFlow(query, ctx, yemot) {
    let state = 0;
    
    // ניתוח שלבי מנהל
    if (query.AdminManageFileAction !== undefined) state = 125;
    else if (query.AdminManageCategorySelect !== undefined) state = 120;
    else if (query.AdminMainMenu !== undefined) state = 110;
    
    // אם המנהל בחר ביצירת קריינות משלו, הוא רוכב על רשת ה-State הרגילה (כמו בגרסה הקודמת)
    // אך משתני ה-Admin גוברים.
    if (query.SetDefaultChoice !== undefined) state = 1009;
    else if (query.TargetFolderCopy !== undefined) state = 10085;
    else if (query.TargetFolderDefault !== undefined) state = 1008;
    else if (query.UserChoiceAdditionalSave !== undefined) state = 1007;
    else if (query.VoiceIndex !== undefined) state = 1003;
    else if (query.VoiceGender !== undefined) state = 1002;
    else if (query.AdminCreateRecord !== undefined) state = 1001;

    let responseBuilder = null;

    switch (state) {
        case 0:
            // שלב 0 מנהל: תפריט ראשי
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ברוך הבא למערכת הניהול של האולפן")
                .addText("לניהול ושמיעת הקריינויות שהוקלטו על ידי המאזינים הקישו 1")
                .addText("להפקת קריינות חדשה בעצמך הקישו 2")
                .setReadDigitsAdvanced("AdminMainMenu", 1, 1, 10, true, false, false)
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 110:
            // שלב 110: פיצול לפי בחירת המנהל
            if (query.AdminMainMenu === "1") {
                // המנהל בחר ב"ניהול קריינויות". אנו שולפים את הקטגוריות מהשרת.
                const cleanFolder = cleanAndSanitizeFolder(ctx.listenerFolder);
                const dirData = await yemot.getIvr2Dir(cleanFolder);
                
                if (!dirData.dirs || dirData.dirs.length === 0) {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("אין כרגע קטגוריות או הודעות באולפן לחזרה לתפריט הניהול הקישו מחדש")
                        .addGoToFolder("/"); // חזרה מאולצת
                    break;
                }

                // מרכיבים תפריט השמעת קטגוריות
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("אנא בחרו את הקטגוריה שברצונכם לנהל");
                
                // נשמור את שמות התיקיות בסדר שבו הוקראו
                let catMapping = "";
                for (let i = 0; i < dirData.dirs.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                    const dirName = dirData.dirs[i].name;
                    // מחליף קווים תחתונים ברווחים להקראה טבעית (למשל: תורה_והלכה -> תורה והלכה)
                    const cleanDirName = dirName.replace(/_/g, " ");
                    responseBuilder.addText(`לקטגוריית ${cleanDirName} הקישו ${spokenNum}`);
                    
                    catMapping += `${num}:${dirName}|`;
                }
                
                responseBuilder.addText("ובסיום הקישו סולמית");
                responseBuilder.setReadDigitsAdvanced("AdminManageCategorySelect", 2, 2, 15, true, true, false)
                    .addState("AdminCatMapping", catMapping)
                    .addState("yemot_token", ctx.YemotToken)
                    .addState("listener_folder", ctx.listenerFolder);

            } else if (query.AdminMainMenu === "2") {
                // המנהל בחר "יצירת קריינות" - מעבר לשלב ההקלטה
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הקליטו את הטקסט שברצונכם להפיק באולפן ולאחר מכן הקישו סולמית")
                    .setRecordInput("AdminCreateRecord", TEMP_FOLDER, `${ctx.ApiCallId}_admin`)
                    .addState("yemot_token", ctx.YemotToken)
                    .addState("listener_folder", ctx.listenerFolder);
            } else {
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
            }
            break;

        case 120:
        case 125:
            // ====================================================================
            // מנוע ניהול והשמעת קבצים למנהל (Manager Playback Engine)
            // ====================================================================
            // שחזור שם הקטגוריה מתוך ה-Mapping
            let categoryName = query.AdminCurrentCategory;
            if (!categoryName) {
                const catSelection = parseInt(query.AdminManageCategorySelect, 10);
                const mapping = query.AdminCatMapping.split('|');
                for (let map of mapping) {
                    if (map.startsWith(`${catSelection}:`)) {
                        categoryName = map.split(':')[1];
                        break;
                    }
                }
            }

            if (!categoryName) {
                responseBuilder = new YemotCommandBuilder("id_list_message").addText("בחירה שגויה מוחזר לתפריט").addGoToFolder("/");
                break;
            }

            const activePath = `${cleanAndSanitizeFolder(ctx.listenerFolder)}/${categoryName}`;
            
            // בודק אם אנו אחרי בחירת מחיקה או המשך (בשלב 125)
            let currentFileIndex = parseInt(query.AdminFileIndex || "0", 10);
            
            if (state === 125) {
                const actionChoice = query.AdminManageFileAction;
                const fileNameToDelete = query.AdminCurrentFileName;
                
                if (actionChoice === "2") {
                    // המנהל ביקש למחוק את הקובץ הנוכחי
                    await yemot.deleteFile(`ivr2:/${activePath}/${fileNameToDelete}`);
                    TelemetryLogger.info("Manager", "DeleteFile", `נמחק קובץ ${fileNameToDelete} מנתיב ${activePath}`);
                    // לא מקדמים את ה-index כי המערך התכווץ
                } else if (actionChoice === "1") {
                    // המנהל ביקש לעבור לקובץ הבא
                    currentFileIndex++;
                } else if (actionChoice === "3") {
                    // חזרה לתפריט ראשי
                    responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
                    break;
                }
            }

            // משיכת הקבצים מהתיקייה
            const filesData = await yemot.getIvr2Dir(activePath);
            const validFiles = (filesData.files ||[]).filter(f => f.name.endsWith('.wav') || f.name.endsWith('.tts')).sort((a,b) => a.name.localeCompare(b.name));

            if (currentFileIndex >= validFiles.length) {
                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText("אין עוד קבצים בקטגוריה זו. מוחזר לתפריט הראשי")
                    .addGoToFolder("/");
                break;
            }

            // משמיע את הקובץ הנוכחי ומציג תפריט עריכה
            const fileToPlay = validFiles[currentFileIndex].name;
            
            responseBuilder = new YemotCommandBuilder("read")
                .addFile(`${activePath}/${fileToPlay.replace('.wav', '')}`)
                .addText("למעבר לקובץ הבא הקישו 1 למחיקת הקובץ הקישו 2 לחזרה לתפריט הקישו 3")
                .setReadDigitsAdvanced("AdminManageFileAction", 1, 1, 10, true, false, false)
                .addState("AdminCurrentCategory", categoryName)
                .addState("AdminFileIndex", currentFileIndex)
                .addState("AdminCurrentFileName", fileToPlay)
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        // ====================================================================
        // יצירת קריינות למנהל (Admin Create Flow)
        // ====================================================================
        case 1001:
            // STT חכם (כולל ניתוח טון שמוסתר בסוגריים)
            const adminRecordPath = `${TEMP_FOLDER}/${ctx.ApiCallId}_admin.wav`;
            const adminAudioBuffer = await yemot.downloadFile(`ivr2:${adminRecordPath}`);
            const adminTranscribedText = await gemini.transcribeAndModerateAudio(adminAudioBuffer);
            
            if (!adminTranscribedText || !adminTranscribedText.text || adminTranscribedText.text.length < 2) {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                    .setRecordInput("AdminCreateRecord", TEMP_FOLDER, `${ctx.ApiCallId}_admin`)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            // שומרים את הטקסט המלא כולל ה-Emotion Cue
            const finalPrompt = `[Director's Instruction: Read the following Hebrew text in a ${adminTranscribedText.emotion} tone. Do not read this note aloud.]\n\n${adminTranscribedText.text}`;
            await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_text.txt`, finalPrompt);

            responseBuilder = new YemotCommandBuilder("read")
                .addText("הטקסט נותח ונקלט באולפן")
                .addText("לבחירת קול של גבר הקישו 1 לבחירת קול של אישה הקישו 2")
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false) 
                .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            break;

        case 1002:
            // תפריט הקולות הייעודי למנהל (מקריא אפס אחד)
            if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder); 
                break;
            }

            const isAdminMale = query.VoiceGender === "1";
            const adminVoices = isAdminMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            
            responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
            for (let i = 0; i < adminVoices.length; i++) {
                const num = i + 1;
                const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; 
                responseBuilder.addText(`ל${adminVoices[i].desc} הקישו ${spokenNum}`);
            }
            responseBuilder.addText("ובסיום הקישו סולמית");

            responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false)
                .addState("gender", isAdminMale ? "MALE" : "FEMALE")
                .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            break;

        case 1003:
            // הפקת הקול המיידית למנהל (אין תפריט סגנון - הג'מיני מחשב לבד)
            const aVoiceListCheck = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            let aCheckIdx = parseInt(query.VoiceIndex, 10) - 1;
            
            if (isNaN(aCheckIdx) || aCheckIdx < 0 || aCheckIdx >= aVoiceListCheck.length) {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                    .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false)
                    .addState("gender", query.gender).addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            const aSelectedVoiceId = aVoiceListCheck[aCheckIdx].id;
            const aMainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_text.txt`);
            
            // יצירת ההקראה הטהורה (TTS)
            const aTtsBuffer = await gemini.generateTTS(aMainTextForTTS, aSelectedVoiceId);
            
            const aTtsTempPath = `ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_tts.wav`;
            await yemot.uploadFile(aTtsTempPath, aTtsBuffer);

            // למנהל אנו מאפשרים את בחירת היעד כמו קודם או ברירת מחדל
            const aPrefPath = `ivr2:/Preferences/${ctx.ApiPhone}.txt`;
            const aDefaultFolder = await yemot.getTextFile(aPrefPath);

            if (aDefaultFolder && aDefaultFolder.trim().length > 0) {
                const folder = aDefaultFolder.trim();
                const nextFileNum = await yemot.getNextSequenceFileName(folder);
                const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
                
                await yemot.uploadFile(finalPath, aTtsBuffer);

                responseBuilder = new YemotCommandBuilder("read")
                    .addFile(`${TEMP_FOLDER}/${ctx.ApiCallId}_tts`) 
                    .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
                    .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                    .setReadDigitsAdvanced("UserChoiceAdditionalSave", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            } else {
                responseBuilder = new YemotCommandBuilder("read")
                    .addFile(`${TEMP_FOLDER}/${ctx.ApiCallId}_tts`)
                    .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                    .addText("נא הקישו את מספר השלוחה לשמירה למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                    .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                    .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            }
            break;

        case 1007:
            if (query.UserChoiceAdditionalSave === "1") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                    .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                    .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, true, true)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            } else {
                responseBuilder = new YemotCommandBuilder("id_list_message").addText("הפעולה הסתיימה").addGoToFolder("/");
            }
            break;

        case 1008:  
        case 10085: 
            let aTargetFolder = query.TargetFolderDefault || query.TargetFolderCopy;
            if (aTargetFolder === undefined) { 
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/"); break; 
            }
            if (aTargetFolder === "0") aTargetFolder = "";
            
            const aCleanFolder = cleanAndSanitizeFolder(aTargetFolder); 
            const aTtsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_tts.wav`);
            const aSeqFileName = await yemot.getNextSequenceFileName(aCleanFolder || "/");
            
            const aUploadPath = aCleanFolder ? `ivr2:/${aCleanFolder}/${aSeqFileName}.wav` : `ivr2:/${aSeqFileName}.wav`;
            await yemot.uploadFile(aUploadPath, aTtsForSave);

            if (state === 10085) { 
                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText(`העותק נשמר בהצלחה כקובץ מספר ${aSeqFileName} הפעולה הסתיימה`)
                    .addGoToFolder("/"); 
            } else { 
                responseBuilder = new YemotCommandBuilder("read")
                    .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${aSeqFileName}`)
                    .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו 1 לסיום הקישו 2")
                    .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false)
                    .addState("targetFolder", aCleanFolder).addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            }
            break;

        case 1009:
            if (query.SetDefaultChoice === "1" && query.targetFolder !== undefined) {
                await yemot.uploadTextFile(`ivr2:/Preferences/${ctx.ApiPhone}.txt`, cleanAndSanitizeFolder(query.targetFolder));
                responseBuilder = new YemotCommandBuilder("id_list_message").addText("שלוחת ברירת המחדל עודכנה בהצלחה הפעולה הסתיימה").addGoToFolder("/");
            } else {
                responseBuilder = new YemotCommandBuilder("id_list_message").addText("הפעולה הסתיימה").addGoToFolder("/");
            }
            break;

        default:
            responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
    }

    return responseBuilder;
}

// ============================================================================
// מנהל מסלול מאזינים פשוטים (Listener Flow Controller)
// נטול סממני AI, עם פילטר צניעות ועם הפקה ברקע אסינכרונית.
// ============================================================================
async function handleListenerFlow(query, ctx, yemot) {
    let state = 0;
    
    // ניתוח השלבים (ללא תפריטי סגנון, וללא אפשרויות שמירה מורכבות. שומר ישירות ליעד המוגדר)
    if (query.ListenerWaitOrExit !== undefined) state = 2030;
    else if (query.VoiceIndex !== undefined) state = 2020;
    else if (query.VoiceGender !== undefined) state = 2010;
    else if (query.UserAudioRecord !== undefined) state = 2000;

    let responseBuilder = null;

    switch (state) {
        case 0:
            // שלב 0 מאזין: ברכה והקלטה - ללא שום זכר לרובוט או AI
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ברוכים הבאים לאולפני ההפקה שלנו")
                .addText("צוות העריכה ישמח לעבד עבורכם את הקול")
                .addText("אנא הקליטו את התוכן שברצונכם להקריא ולאחר מכן הקישו סולמית")
                .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ctx.ApiCallId}_lis`)
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2000:
            // שלב 1: לאחר ההקלטה נשאל מין. (בשלב זה ההקלטה טרם מנותחת)
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ההקלטה נקלטה באולפן")
                .addText("לבחירת קריין גבר הקישו 1 לבחירת קריינית אישה הקישו 2")
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false) 
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2010:
            // שלב 2: תפריט הקולות (15 קולות) - "אפס אחד"
            if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית לבחירת קריין גברי הקישו 1 לקול נשי הקישו 2")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            const isMale = query.VoiceGender === "1";
            const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            
            responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקריין הרצוי מתוך הרשימה הבאה");
            for (let i = 0; i < voices.length; i++) {
                const num = i + 1;
                const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; 
                responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
            }
            responseBuilder.addText("ובסיום הקישו סולמית");

            responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false)
                .addState("gender", isMale ? "MALE" : "FEMALE")
                .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            break;

        case 2020:
            // שלב 3: תפריט חיתוך. שואל את הלקוח אם הוא רוצה להמתין על הקו או לנתק ולעשות ברקע
            const voiceListCheck = query.gender === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
            let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
            const selectedVoiceId = (checkIdx >= 0 && checkIdx < voiceListCheck.length) ? voiceListCheck[checkIdx].id : voiceListCheck[0].id;

            responseBuilder = new YemotCommandBuilder("read")
                .addText("צוות האולפן ערוך להפקה")
                .addText("התהליך אורך מספר דקות")
                .addText("להמתנה על הקו להשלמת ההפקה הקישו 1")
                .addText("כדי שההפקה תתבצע ברקע ולהמשיך הלאה במערכת הקישו 2")
                .setReadDigitsAdvanced("ListenerWaitOrExit", 1, 1, 10, true, false, false)
                .addState("voiceId", selectedVoiceId)
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2030:
            // שלב 4: ביצוע החלטת המאזין. 
            // לא משנה מה הוא בחר - הפעולה האמיתית קורית בפונקציה BackgroundWorker!
            const waitChoice = query.ListenerWaitOrExit;
            const chosenVoiceId = query.voiceId;
            
            // תיוג לתהליך רקע אסינכרוני שלא חוסם את התגובה!
            processListenerAudioInBackground(yemot, ctx.ApiCallId, ctx.listenerFolder, chosenVoiceId);

            if (waitChoice === "1") {
                // המאזין בחר להמתין. מאחר שיש לנו השהיה של 3 דקות, אם פשוט נחזיר id_list_message 
                // הוא ישמע את זה ויעוף. כדי להשאיר אותו ממתין אפשר להעביר אותו לשלוחת מוזיקה בהמתנה אמיתית
                // במערכת אם ישנה כזו, או פשוט להודיע לו ולהעביר לתפריט.
                // מכיוון שימות המשיח מגבילה "תקיעת" פניות API ל-45 שניות, לא נוכל להחזיק את הקו פתוח כאן ל-3 דקות.
                // הפתרון ההגיוני ביותר: להודיע לו שאי אפשר להמתין כל כך הרבה ולשלוח אותו לתפריט.
                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText("עקב עומס באולפנים ההפקה תתבצע ברקע וניתן לחזור אליה מאוחר יותר")
                    .addText("הינך מוחזר לתפריט הראשי ההפקה תהיה מוכנה בעוד מספר דקות")
                    .addGoToFolder("/");
            } else {
                // הלקוח בחר להמשיך הלאה
                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText("הינך מוחזר לתפריט הראשי ההפקה תהיה מוכנה בעוד מספר דקות")
                    .addGoToFolder("/");
            }
            break;

        default:
            responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
    }

    return responseBuilder;
}

// ============================================================================
// פונקציית הנתב הראשית (Main Router Handler)
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // הגנת ניתוק
        if (query.hangup === "yes") {
            TelemetryLogger.info("MainHandler", "Hangup", `המאזין ניתק. CallID: ${query.ApiCallId}`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const ctx = extractContext(query);
        
        if (!ctx.YemotToken) {
            TelemetryLogger.error("MainHandler", "Auth", "חסר טוקן בהגדרות השלוחה.");
            return res.status(200).send("id_list_message=t-תקלה במערכת חסר מפתח הגדרה&hangup=yes");
        }

        const yemot = new YemotManager(ctx.YemotToken);
        cleanupEmptyQueryVariables(query);
        
        let responseBuilder = null;

        // הנתב מחליט איזה תהליך להריץ לפי ה-CallerID
        if (ctx.isAdmin) {
            TelemetryLogger.info("Router", "AdminFlow", `כניסת מנהל זוהתה (${ctx.ApiPhone})`);
            responseBuilder = await handleAdminFlow(query, ctx, yemot);
        } else {
            TelemetryLogger.info("Router", "ListenerFlow", `כניסת מאזין זוהתה (${ctx.ApiPhone})`);
            responseBuilder = await handleListenerFlow(query, ctx, yemot);
        }

        // בניית התגובה
        yemotFinalResponse = responseBuilder.build();
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        TelemetryLogger.error("MainHandler", "CriticalError", "קריסת שרת מרכזית:", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה קריטית באולפן אנו מתנצלים&go_to_folder=/");
    }
};
