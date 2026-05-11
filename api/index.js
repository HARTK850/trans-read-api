/**
 * @file api/index.js
 * @version 21.0.0 (Glatt Kosher Enterprise Edition)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למחולל ההקראות.
 * 
 * פיצ'רים מרכזיים בגרסה זו:
 * 1. פיצול אבטחה סמוי (Stealth Auth) בין מנהלים למאזינים.
 * 2. מנוע השמעת קבצים למנהלים לאישור/מחיקת קריינויות מהאולפן.
 * 3. הסרת סממני רובוטיקה/בינה מלאכותית - שימוש במונחים מקצועיים ("מחולל ההקראות").
 * 4. פילטר צניעות ותוכן קפדני אקטיבי.
 * 5. עיבוד רקע אסינכרוני (Background Worker) עם השהיה לדימוי פעולה אנושית.
 * 6. סידור מדויק של 16 הפרמטרים לפקודת Read לביטול מוחלט של 'לאישור הקישו 1'.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger, SecurityManager } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות וקבועים (Enterprise Configuration)
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :[ "YOUR_DEFAULT_API_KEY_HERE" ];

const processor = new GeminiManager(GEMINI_API_KEYS);

const TEMP_FOLDER = "/Temp_Studio_App"; 
const DEFAULT_LISTENER_FOLDER = "/Listener_Audio"; 

// ============================================================================
// מנוע אובייקט-אוריינטד להרכבת תגובות (YemotCommandBuilder)
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
        // מסיר נקודות, פסיקים ומקפים כדי למנוע קריסת מערכת ימות המשיח
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
     * הגדרת קלט מספרי מתקדם - פותר את בעיות ה"מינימום ספרות" ומבטל "לאישור הקישו 1".
     * מחייב להעביר בדיוק 16 פרמטרים מופרדים בפסיק בהתאם לתקן ימות המשיח.
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        const playType = disableConfirmation ? "No" : "Digits"; // No מבטל הקראת "הקשת X"
        const blockAsterisk = autoReplaceAsteriskWithSlash ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes"; 
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";
        const askConfirm = disableConfirmation ? "no" : ""; // no כאן חוסם את 'לאישור הקישו 1' לחלוטין

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
            "",                    // 11. מקשים מורשים
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
            "no",      // 6. הפעלת התפריט המלא של ימות
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
 * מנקה משתנים ריקים כדי למנוע קריסות בלוגיקת השלבים (תיקון הבאג שציינת).
 */
function cleanupEmptyQueryVariables(query) {
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "ListenerWaitOrExit", "AdminMainMenu", "AdminManageCategorySelect", "AdminManageFileAction", "AdminCreateRecord"];
    for (const key of keys) {
        if (query[key] === "") delete query[key];
    }
}

// ============================================================================
// תהליכי רקע אסינכרוניים (Background Workers)
// ============================================================================

/**
 * מפיק את ההקראה ברקע עם השהיה אנושית מדומה של 3 דקות.
 */
async function processListenerAudioInBackground(yemot, ApiCallId, listenerFolder, voiceId) {
    try {
        TelemetryLogger.info("BackgroundWorker", "Start", `מתחיל תהליך רקע עבור: ${ApiCallId}. ממתין 3 דקות להדמיית עריכה.`);
        
        // השהיה אנושית של 3 דקות (180,000 מילישניות).
        // הערה ללקוח: אם ב-Vercel החינמי הפונקציה נקטעת, יש לשדרג לפרו או לעבוד ללא ההשהיה. הקוד עמיד.
        await new Promise(resolve => setTimeout(resolve, 180000));
        
        TelemetryLogger.info("BackgroundWorker", "Processing", `מתחיל ניתוח טקסט עבור: ${ApiCallId}`);
        const recordPath = `${TEMP_FOLDER}/${ApiCallId}_lis.wav`;
        const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);
        
        // 1. פענוח + סינון גלאט כושר
        const moderationResult = await processor.processAudioAndModerate(audioBuffer);
        
        // 2. הפעלת מנגנון הסינון הסמוי
        if (!moderationResult.is_kosher) {
            TelemetryLogger.warn("BackgroundWorker", "KosherFilter", `תוכן נפסל. מזהה: ${ApiCallId}. הטקסט: ${moderationResult.text}`);
            await yemot.deleteFile(`ivr2:${recordPath}`);
            return; // סיום שקט. הלקוח לא מקבל כלום והקובץ מושמד.
        }
        
        TelemetryLogger.info("BackgroundWorker", "KosherFilter", `תוכן אושר. קטגוריה: ${moderationResult.category}`);

        // 3. הפקת האודיו בעזרת המודל
        const ttsBuffer = await processor.generateVoiceAudio(moderationResult.text, voiceId, moderationResult.emotion);
        
        // 4. תיוק התיקייה הסופית לפי קטגוריה
        const cleanListenerFolder = cleanAndSanitizeFolder(listenerFolder);
        const categoryFolder = cleanListenerFolder ? `${cleanListenerFolder}/${moderationResult.category}` : moderationResult.category;
        
        const nextFileName = await yemot.getNextSequenceFileName(categoryFolder);
        const finalPath = `ivr2:/${categoryFolder}/${nextFileName}.wav`;
        
        // 5. שמירה ומחיקת זמניים
        await yemot.uploadFile(finalPath, ttsBuffer);
        TelemetryLogger.info("BackgroundWorker", "Done", `הקובץ הופק ונשמר בנתיב: ${finalPath}`);
        
        await yemot.deleteFile(`ivr2:${recordPath}`);
        
    } catch (error) {
        TelemetryLogger.error("BackgroundWorker", "Error", "כשל בתהליך הרקע.", error);
    }
}

// ============================================================================
// מערכות State פנימיות וניהול ניתוב
// ============================================================================

function extractContext(query) {
    return {
        ApiPhone: query.ApiPhone || "UnknownPhone",
        ApiCallId: query.ApiCallId || "UnknownCallId",
        isAdmin: SecurityManager.isAdministrator(query.ApiPhone),
        YemotToken: query.yemot_token || process.env.YEMOT_TOKEN,
        listenerFolder: query.listener_folder || DEFAULT_LISTENER_FOLDER 
    };
}

// ============================================================================
// מנהל מסלול מנהלים (Admin Flow Controller)
// ============================================================================
async function handleAdminFlow(query, ctx, yemot) {
    let state = 0;
    
    // ניתוח שלבי מנהל פנימיים
    if (query.AdminManageFileAction !== undefined) state = 125;
    else if (query.AdminManageCategorySelect !== undefined) state = 120;
    else if (query.AdminMainMenu !== undefined) state = 110;
    
    // מצבי הפקת קריינות על ידי מנהל (משתמש במנגנון המיידי)
    if (query.VoiceIndex !== undefined) state = 1003;
    else if (query.VoiceGender !== undefined) state = 1002;
    else if (query.AdminCreateRecord !== undefined) state = 1001;

    let responseBuilder = null;

    switch (state) {
        case 0:
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ברוך הבא למערכת הניהול של מחולל ההקראות")
                .addText("לניהול ושמיעת הקריינויות שהוקלטו על ידי המאזינים הקישו 1")
                .addText("להפקת קריינות חדשה בעצמך הקישו 2")
                .setReadDigitsAdvanced("AdminMainMenu", 1, 1, 10, true, false, false)
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 110:
            if (query.AdminMainMenu === "1") {
                const cleanFolder = cleanAndSanitizeFolder(ctx.listenerFolder);
                const dirData = await yemot.getIvr2Dir(cleanFolder);
                
                if (!dirData.dirs || dirData.dirs.length === 0) {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("אין כרגע קטגוריות או הודעות במערכת מוחזר לתפריט הראשי")
                        .addGoToFolder("/"); 
                    break;
                }

                responseBuilder = new YemotCommandBuilder("read")
                    .addText("אנא בחרו את הקטגוריה שברצונכם לנהל");
                
                let catMapping = "";
                for (let i = 0; i < dirData.dirs.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                    const dirName = dirData.dirs[i].name;
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
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הקליטו את הטקסט שברצונכם להפיק במערכת ולאחר מכן הקישו סולמית")
                    .setRecordInput("AdminCreateRecord", TEMP_FOLDER, `${ctx.ApiCallId}_admin`)
                    .addState("yemot_token", ctx.YemotToken)
                    .addState("listener_folder", ctx.listenerFolder);
            } else {
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
            }
            break;

        case 120:
        case 125:
            // מנוע נגן קבצים למנהלים (Playback Engine)
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
            let currentFileIndex = parseInt(query.AdminFileIndex || "0", 10);
            
            if (state === 125) {
                const actionChoice = query.AdminManageFileAction;
                const fileNameToDelete = query.AdminCurrentFileName;
                
                if (actionChoice === "2") {
                    await yemot.deleteFile(`ivr2:/${activePath}/${fileNameToDelete}`);
                    TelemetryLogger.info("Manager", "DeleteFile", `נמחק ${fileNameToDelete}`);
                } else if (actionChoice === "1") {
                    currentFileIndex++;
                } else if (actionChoice === "3") {
                    responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
                    break;
                }
            }

            const filesData = await yemot.getIvr2Dir(activePath);
            const validFiles = (filesData.files ||[]).filter(f => f.name.endsWith('.wav') || f.name.endsWith('.tts')).sort((a,b) => a.name.localeCompare(b.name));

            if (currentFileIndex >= validFiles.length) {
                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText("אין עוד קבצים בקטגוריה זו. מוחזר לתפריט הראשי")
                    .addGoToFolder("/");
                break;
            }

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

        case 1001:
            // STT מתקדם למנהלים בלבד
            const adminRecordPath = `${TEMP_FOLDER}/${ctx.ApiCallId}_admin.wav`;
            const adminAudioBuffer = await yemot.downloadFile(`ivr2:${adminRecordPath}`);
            const adminTranscribedData = await processor.processAudioAndModerate(adminAudioBuffer);
            
            if (!adminTranscribedData || !adminTranscribedData.text || adminTranscribedData.text.length < 2) {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                    .setRecordInput("AdminCreateRecord", TEMP_FOLDER, `${ctx.ApiCallId}_admin`)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            // שמירת הטקסט העשיר בקובץ עבודה
            await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_text.txt`, JSON.stringify(adminTranscribedData));

            responseBuilder = new YemotCommandBuilder("read")
                .addText("הטקסט נותח ונקלט במערכת")
                .addText("לבחירת קול של גבר הקישו 1 לבחירת קול של אישה הקישו 2")
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false) 
                .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
            break;

        case 1002:
            if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder); 
                break;
            }

            const isAdminMale = query.VoiceGender === "1";
            const adminVoices = isAdminMale ? VOICES_REGISTRY.MALE : VOICES_REGISTRY.FEMALE;
            
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
            const aVoiceListCheck = query.gender === "MALE" ? VOICES_REGISTRY.MALE : VOICES_REGISTRY.FEMALE;
            let aCheckIdx = parseInt(query.VoiceIndex, 10) - 1;
            
            if (isNaN(aCheckIdx) || aCheckIdx < 0 || aCheckIdx >= aVoiceListCheck.length) {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                    .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false)
                    .addState("gender", query.gender).addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            const aSelectedVoiceId = aVoiceListCheck[aCheckIdx].id;
            const adminRawData = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_text.txt`);
            const adminParsed = JSON.parse(adminRawData);
            
            // יצירת ההקראה המיידית למנהל
            const aTtsBuffer = await processor.generateVoiceAudio(adminParsed.text, aSelectedVoiceId, adminParsed.emotion);
            
            // תיוק לקטגוריה הנדרשת
            const adminFinalFolder = `${cleanAndSanitizeFolder(ctx.listenerFolder)}/${adminParsed.category}`;
            const nextFileNum = await yemot.getNextSequenceFileName(adminFinalFolder);
            const finalPath = `ivr2:/${adminFinalFolder}/${nextFileNum}.wav`;
            
            await yemot.uploadFile(finalPath, aTtsBuffer);

            responseBuilder = new YemotCommandBuilder("id_list_message")
                .addText(`הקובץ הופק בהצלחה תויק בקטגוריית ${adminParsed.category} כקובץ מספר ${nextFileNum} הפעולה הסתיימה`)
                .addGoToFolder("/");
            break;

        default:
            responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
    }

    return responseBuilder;
}

// ============================================================================
// מנהל מסלול מאזינים פשוטים (Listener Flow Controller)
// נטול סממני רובוטיקה, עם פילטר צניעות חרדי והפקה ברקע אסינכרונית.
// ============================================================================
async function handleListenerFlow(query, ctx, yemot) {
    let state = 0;
    
    // ניתוח השלבים למאזינים (חלק וזריז)
    if (query.ListenerWaitOrExit !== undefined) state = 2030;
    else if (query.VoiceIndex !== undefined) state = 2020;
    else if (query.VoiceGender !== undefined) state = 2010;
    else if (query.UserAudioRecord !== undefined) state = 2000;

    let responseBuilder = null;

    switch (state) {
        case 0:
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ברוכים הבאים למחולל ההקראות")
                .addText("מערכות האולפן ערוכות לקליטת התוכן שלכם")
                .addText("אנא הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ctx.ApiCallId}_lis`)
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2000:
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ההקלטה נקלטה במערכת")
                .addText("לבחירת קריין גבר הקישו 1 לבחירת קריינית אישה הקישו 2")
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false) 
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2010:
            if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית לבחירת קריין גבר הקישו 1 לקול נשי הקישו 2")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            const isMale = query.VoiceGender === "1";
            const voices = isMale ? VOICES_REGISTRY.MALE : VOICES_REGISTRY.FEMALE;
            
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
            const voiceListCheck = query.gender === "MALE" ? VOICES_REGISTRY.MALE : VOICES_REGISTRY.FEMALE;
            let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
            const selectedVoiceId = (checkIdx >= 0 && checkIdx < voiceListCheck.length) ? voiceListCheck[checkIdx].id : voiceListCheck[0].id;

            responseBuilder = new YemotCommandBuilder("read")
                .addText("הנתונים נשלחו לעיבוד")
                .addText("תהליך ההפקה אורך מספר דקות")
                .addText("להמתנה על הקו להשלמת ההפקה הקישו 1")
                .addText("כדי שההפקה תתבצע ברקע ולהמשיך הלאה במערכת הקישו 2")
                .setReadDigitsAdvanced("ListenerWaitOrExit", 1, 1, 10, true, false, false)
                .addState("voiceId", selectedVoiceId)
                .addState("yemot_token", ctx.YemotToken)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2030:
            const waitChoice = query.ListenerWaitOrExit;
            const chosenVoiceId = query.voiceId;
            
            // תיוג לתהליך רקע אסינכרוני עם השהיה אנושית של 3 דקות והפעלת מסנן החרדי!
            processListenerAudioInBackground(yemot, ctx.ApiCallId, ctx.listenerFolder, chosenVoiceId);

            if (waitChoice === "1") {
                // המאזין בחר להמתין. מאחר שמגבלת הפסקסק היא 45 שניות, אין מנוס אלא לשחרר אותו.
                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText("עקב עומס במערכות ההפקה תתבצע ברקע וניתן לחזור אליה מאוחר יותר")
                    .addText("הינך מוחזר לתפריט הראשי ההפקה תהיה מוכנה בעוד מספר דקות")
                    .addGoToFolder("/");
            } else {
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
// פונקציית הנתב הראשית (Main Routing Handler)
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // הגנת ניתוק
        if (query.hangup === "yes") {
            TelemetryLogger.info("MainHandler", "Hangup", `הלקוח ניתק. (CallID: ${query.ApiCallId})`);
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

        // הנתב הראשי
        if (ctx.isAdmin) {
            TelemetryLogger.info("Router", "AdminFlow", `נכנס מנהל: ${ctx.ApiPhone}`);
            responseBuilder = await handleAdminFlow(query, ctx, yemot);
        } else {
            TelemetryLogger.info("Router", "ListenerFlow", `נכנס מאזין: ${ctx.ApiPhone}`);
            responseBuilder = await handleListenerFlow(query, ctx, yemot);
        }

        yemotFinalResponse = responseBuilder.build();
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        TelemetryLogger.error("MainHandler", "CriticalError", "קריסת שרת:", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה במערכת אנו מתנצלים&go_to_folder=/");
    }
};
