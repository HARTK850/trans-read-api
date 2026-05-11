
const { GeminiManager, YemotManager, VOICES_REGISTRY, TelemetryLogger, SecurityManager, InputValidator } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות וקבועים
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :[ "YOUR_DEFAULT_API_KEY_HERE" ];

const processor = new GeminiManager(GEMINI_API_KEYS);

const TEMP_FOLDER = "/Temp_Studio_App"; 
const DEFAULT_LISTENER_FOLDER = "/Listener_Audio"; 

// ============================================================================
// מנוע להרכבת תגובות לתקן המחמיר של ימות המשיח
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
        // הסרת כל סימני הפיסוק שיכולים לשבור את פקודות ימות המשיח
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
     * פונקציה חכמה למניעת בקשות אישור וטיפול בשגיאות.
     * מבוסס על שרשור מדויק של פרמטרים. 'No' בפרמטר השביעי (השישי במערך כי מתחילים מ-0) 
     * הוא זה שמבטל את הקראת ה'הקשת X', ואילו 'no' בפרמטר ה-16 (ה-15 במערך) מבטל אישור סופי.
     */
    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout) {
    this.params = [
        varName,
        "no",
        "Digits",
        maxDigits.toString(),
        minDigits.toString(),
        timeout.toString(),
        "No",
        "yes",
        "yes",
        "",
        "",
        "",
        "",
        "",
        "",
        "no"
    ];
    return this;
}

    /**
     * הגדרת קלט הקלטה (Record). מחזיר את התפריט הרשמי של ימות ("לשמיעה הקישו 1..").
     */
    setRecordInput(varName, folder, fileName) {
        this.params =[
            varName,   // 1
            "no",      // 2
            "record",  // 3
            folder,    // 4
            fileName,  // 5
            "no",      // 6. הפעלת תפריט ימות
            "yes",     // 7
            "no"       // 8
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
// פונקציות עזר 
// ============================================================================
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; 
    let sanitized = rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").trim();
    if (sanitized.startsWith("/")) sanitized = sanitized.substring(1);
    if (sanitized.endsWith("/")) sanitized = sanitized.slice(0, -1);
    return sanitized;
}

function cleanupEmptyQueryVariables(query) {
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "ListenerWaitOrExit", "AdminMainMenu", "AdminManageCategorySelect", "AdminManageFileAction", "AdminCreateRecord"];
    for (const key of keys) {
        if (query[key] === "") delete query[key];
    }
}

// ============================================================================
// תהליכי רקע אסינכרוניים (Background Workers) למאזינים
// ============================================================================
async function processListenerAudioInBackground(yemot, ApiCallId, listenerFolder, voiceId) {
    try {
        TelemetryLogger.info("BackgroundWorker", "Start", `מתחיל עיבוד מיידי: ${ApiCallId}`);

        const recordPath = `${TEMP_FOLDER}/${ApiCallId}_lis.wav`;

        const audioBuffer = await yemot.downloadFile(`ivr2:${recordPath}`);

        const moderationResult = await processor.transcribeSimple(audioBuffer);

        if (!moderationResult || !moderationResult.is_kosher || !moderationResult.text) {
            TelemetryLogger.warn("BackgroundWorker", "Rejected", `תוכן נפסל ${ApiCallId}`);
            return false;
        }

        const ttsBuffer = await processor.generateTTS(
            moderationResult.text,
            voiceId,
            null
        );

        const cleanFolder = cleanAndSanitizeFolder(listenerFolder);
        const category = moderationResult.category || "כללי";

        const finalFolder = cleanFolder
            ? `/${cleanFolder}/${category}`
            : `/${category}`;

        const nextNum = await yemot.getNextSequenceFileName(finalFolder);

        const finalPath = `ivr2:${finalFolder}/${nextNum}.wav`;

        await yemot.uploadFile(finalPath, ttsBuffer);

        await yemot.deleteFile(`ivr2:${recordPath}`);

        TelemetryLogger.info("BackgroundWorker", "Done", finalPath);

        return true;

    } catch (error) {
        TelemetryLogger.error("BackgroundWorker", "Crash", "קריסה", error);
        return false;
    }
}

// ============================================================================
// נתבים לוגיים (Routers)
// ============================================================================
function extractContext(query) {
    return {
        ApiPhone: query.ApiPhone || "UnknownPhone",
        ApiCallId: query.ApiCallId || "UnknownCallId",
        isAdmin: SecurityManager.isAdministrator(query.ApiPhone, query.admin_phones),
        YemotToken: query.yemot_token || process.env.YEMOT_TOKEN,
        listenerFolder: query.listener_folder || DEFAULT_LISTENER_FOLDER 
    };
}

// ==================== מנהל מסלול מנהלים (Admin Flow) ====================
async function handleAdminFlow(query, ctx, yemot) {
    let state = 0;
    
    if (query.AdminManageFileAction !== undefined) state = 125;
    else if (query.AdminManageCategorySelect !== undefined) state = 120;
    else if (query.AdminMainMenu !== undefined) state = 110;
    
    if (query.VoiceIndex !== undefined) state = 1003;
    else if (query.VoiceGender !== undefined) state = 1002;
    else if (query.AdminCreateRecord !== undefined) state = 1001;

    let responseBuilder = null;

    switch (state) {
        case 0:
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ברוך הבא למערכת הניהול של מחולל ההקראות")
                .addText("לניהול ושמיעת הקריינויות שהוקלטו על ידי המשתמשים הקישו 1")
                .addText("להפקת קריינות חדשה הקישו 2")
                .setReadDigitsAdvanced("AdminMainMenu", 1, 1, 10, true, false, false)
                .addState("yemot_token", ctx.YemotToken)
                .addState("admin_phones", query.admin_phones)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 110:
            const adminMainMenuChoice = InputValidator.getFirstDigit(query.AdminMainMenu);
            if (adminMainMenuChoice === "1") {
                const cleanFolder = cleanAndSanitizeFolder(ctx.listenerFolder);
                const dirData = await yemot.getIvr2Dir(cleanFolder);
                
                if (!dirData.dirs || dirData.dirs.length === 0) {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("אין כרגע קטגוריות או הודעות במערכת מוחזר לתפריט הראשי")
                        .addGoToFolder("/"); 
                    break;
                }

                responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקטגוריה שברצונכם לנהל");
                let catMapping = "";
                for (let i = 0; i < dirData.dirs.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                    const dirName = dirData.dirs[i].name;
                    responseBuilder.addText(`לקטגוריית ${dirName.replace(/_/g, " ")} הקישו ${spokenNum}`);
                    catMapping += `${num}:${dirName}|`;
                }
                
                responseBuilder.addText("ובסיום הקישו סולמית");
                responseBuilder.setReadDigitsAdvanced("AdminManageCategorySelect", 2, 2, 15, true, true, false)
                    .addState("AdminCatMapping", catMapping)
                    .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones)
                    .addState("listener_folder", ctx.listenerFolder);

            } else if (adminMainMenuChoice === "2") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הקליטו את הטקסט שברצונכם להפיק במערכת ולאחר מכן הקישו סולמית")
                    .setRecordInput("AdminCreateRecord", TEMP_FOLDER, `${ctx.ApiCallId}_admin`)
                    .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones)
                    .addState("listener_folder", ctx.listenerFolder);
            } else {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית. לניהול הקישו 1 להפקה הקישו 2")
                    .setReadDigitsAdvanced("AdminMainMenu", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones)
                    .addState("listener_folder", ctx.listenerFolder);
            }
            break;

        case 120:
        case 125:
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
                const actionChoice = InputValidator.getFirstDigit(query.AdminManageFileAction);
                const fileNameToDelete = query.AdminCurrentFileName;
                
                if (actionChoice === "2") {
                    await yemot.deleteFile(`ivr2:/${activePath}/${fileNameToDelete}`);
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
                    .addText("אין עוד קבצים בקטגוריה זו מוחזר לתפריט הראשי").addGoToFolder("/");
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
                .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 1001:
            // STT חכם עם רגש למנהלים
            const adminRecordPath = `${TEMP_FOLDER}/${ctx.ApiCallId}_admin.wav`;
            const adminAudioBuffer = await yemot.downloadFile(`ivr2:${adminRecordPath}`);
            const adminTranscribedData = await processor.transcribeWithEmotion(adminAudioBuffer);
            
            if (!adminTranscribedData || !adminTranscribedData.text || adminTranscribedData.text.length < 2) {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("לא הצלחנו להבין את ההקלטה אנא נסו שוב")
                    .setRecordInput("AdminCreateRecord", TEMP_FOLDER, `${ctx.ApiCallId}_admin`)
                    .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_text.txt`, JSON.stringify(adminTranscribedData));

            responseBuilder = new YemotCommandBuilder("read")
                .addText("הטקסט נותח ונקלט במערכת")
                .addText("לבחירת קול של גבר הקישו 1 לבחירת קול של אישה הקישו 2")
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false) 
                .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder);
            break;

        case 1002:
            const adminGenderChoice = InputValidator.getFirstDigit(query.VoiceGender);
            if (adminGenderChoice !== "1" && adminGenderChoice !== "2") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder); 
                break;
            }

            const isAdminMale = adminGenderChoice === "1";
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
                .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder);
            break;

        case 1003:
            const aVoiceListCheck = query.gender === "MALE" ? VOICES_REGISTRY.MALE : VOICES_REGISTRY.FEMALE;
            let aCheckIdx = parseInt(query.VoiceIndex, 10) - 1;
            
            if (isNaN(aCheckIdx) || aCheckIdx < 0 || aCheckIdx >= aVoiceListCheck.length) {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                    .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false)
                    .addState("gender", query.gender).addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            const aSelectedVoiceId = aVoiceListCheck[aCheckIdx].id;
            const adminRawData = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ctx.ApiCallId}_text.txt`);
            const adminParsed = JSON.parse(adminRawData);
            
            const aTtsBuffer = await processor.generateTTS(adminParsed.text, aSelectedVoiceId, adminParsed.emotion);
            
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

// ==================== מנהל מסלול מאזינים (Listener Flow) ====================
async function handleListenerFlow(query, ctx, yemot) {
    let state = 0;
    
    if (query.ListenerWaitOrExit !== undefined) state = 2030;
    else if (query.VoiceIndex !== undefined) state = 2020;
    else if (query.VoiceGender !== undefined) state = 2010;
    else if (query.UserAudioRecord !== undefined) state = 2000;

    let responseBuilder = null;

    switch (state) {
        case 0:
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ברוכים הבאים למחולל ההקראות")
                .addText("המערכות ערוכות לקליטת הנתונים שלכם")
                .addText("אנא הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ctx.ApiCallId}_lis`)
                .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2000:
            responseBuilder = new YemotCommandBuilder("read")
                .addText("ההקלטה נקלטה במערכת")
                .addText("לבחירת קריין גבר הקישו 1 לבחירת קריינית אישה הקישו 2")
                .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false) 
                .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2010:
            const lisGenderChoice = InputValidator.getFirstDigit(query.VoiceGender);
            if (lisGenderChoice !== "1" && lisGenderChoice !== "2") {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית לבחירת קריין גבר הקישו 1 לקול נשי הקישו 2")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false)
                    .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            const isMale = lisGenderChoice === "1";
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
                .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder);
            break;

        case 2020:
            const voiceListCheck = query.gender === "MALE" ? VOICES_REGISTRY.MALE : VOICES_REGISTRY.FEMALE;
            let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
            
            if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                    .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false)
                    .addState("gender", query.gender).addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones).addState("listener_folder", ctx.listenerFolder);
                break;
            }

            const selectedVoiceId = voiceListCheck[checkIdx].id;

            responseBuilder = new YemotCommandBuilder("read")
                .addText("הנתונים נשלחו לעיבוד המערכות")
                .addText("תהליך העיבוד אורך מספר דקות")
                .addText("להמתנה על הקו להשלמת העיבוד הקישו 1")
                .addText("כדי שההליך יתבצע ברקע ולהמשיך הלאה במערכת הקישו 2")
                .setReadDigitsAdvanced("ListenerWaitOrExit", 1, 1, 10, true, false, false)
                .addState("voiceId", selectedVoiceId)
                .addState("yemot_token", ctx.YemotToken).addState("admin_phones", query.admin_phones)
                .addState("listener_folder", ctx.listenerFolder);
            break;

        case 2030:
    const waitChoice = InputValidator.getFirstDigit(query.ListenerWaitOrExit);
    const chosenVoiceId = query.voiceId;

    if (waitChoice === "1") {

        responseBuilder = new YemotCommandBuilder("id_list_message")
            .addText("המערכת מעבדת כעת את ההקלטה נא להמתין");

        const success = await processListenerAudioInBackground(
            yemot,
            ctx.ApiCallId,
            ctx.listenerFolder,
            chosenVoiceId
        );

        if (success) {
            responseBuilder = new YemotCommandBuilder("id_list_message")
                .addText("הקובץ הוכן בהצלחה ונשמר בשלוחה")
                .addGoToFolder("/");
        } else {
            responseBuilder = new YemotCommandBuilder("id_list_message")
                .addText("העיבוד נכשל נסו שוב מאוחר יותר")
                .addGoToFolder("/");
        }

    } else if (waitChoice === "2") {

        processListenerAudioInBackground(
            yemot,
            ctx.ApiCallId,
            ctx.listenerFolder,
            chosenVoiceId
        );

        responseBuilder = new YemotCommandBuilder("id_list_message")
            .addText("הקובץ יוכן ברקע ויופיע בעוד זמן קצר")
            .addGoToFolder("/");

    } else {

        responseBuilder = new YemotCommandBuilder("read")
            .addText("בחירה לא חוקית להמתנה הקישו 1 לעיבוד ברקע הקישו 2")
            .setReadDigitsAdvanced("ListenerWaitOrExit", 1, 1, 10)
            .addState("voiceId", chosenVoiceId)
            .addState("yemot_token", ctx.YemotToken)
            .addState("admin_phones", query.admin_phones)
            .addState("listener_folder", ctx.listenerFolder);
    }
    break;

        default:
            responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
    }

    return responseBuilder;
}

// ============================================================================
// נתב ראשי (Main Entry Point)
// ============================================================================
module.exports = async (req, res) => {
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        if (query.hangup === "yes") {
            TelemetryLogger.info("Main", "Hangup", `נותק ע"י לקוח. ID: ${query.ApiCallId}`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const ctx = extractContext(query);
        if (!ctx.YemotToken) {
            return res.status(200).send("id_list_message=t-תקלה במערכת חסר מפתח הגדרה&hangup=yes");
        }

        const yemot = new YemotManager(ctx.YemotToken);
        cleanupEmptyQueryVariables(query);
        
        let responseBuilder = null;

        if (ctx.isAdmin) {
            responseBuilder = await handleAdminFlow(query, ctx, yemot);
        } else {
            responseBuilder = await handleListenerFlow(query, ctx, yemot);
        }

        const yemotFinalResponse = responseBuilder.build();
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        TelemetryLogger.error("Main", "CriticalError", "קריסת שרת", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה במערכת אנו מתנצלים&go_to_folder=/");
    } 
};
