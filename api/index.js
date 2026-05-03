/**
 * @file api/index.js
 * @version 18.0.0 (Fixed Edition)
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');

const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    :["YOUR_DEFAULT_API_KEY_HERE"];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

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

    setReadDigitsAdvanced(varName, maxDigits, minDigits, timeout, disableConfirmation = true, allowZero = false, autoReplaceAsteriskWithSlash = false) {
        const playType = disableConfirmation ? "NO" : "Digits";
        const blockAsterisk = autoReplaceAsteriskWithSlash ? "no" : "yes";
        const blockZero = allowZero ? "no" : "yes"; 
        const replaceChar = autoReplaceAsteriskWithSlash ? "*/" : "";
        const askConfirm = disableConfirmation ? "no" : "";

        this.params =[
            varName, "no", maxDigits.toString(), minDigits.toString(), timeout.toString(), playType,
            blockAsterisk, blockZero, replaceChar, "", "", "", "", "", askConfirm
        ];
        return this;
    }

    setRecordInput(varName, folder, fileName) {
        this.params =[varName, "no", "record", folder, fileName, "", "yes", "no"];
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

        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; 
    return rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

function cleanupEmptyQueryVariables(query) {
    const keys =["UserAudioRecord", "VoiceGender", "VoiceIndex", "TargetFolderDefault", "TargetFolderCopy", "SetDefaultChoice", "WantCopySave"];
    for (const key of keys) {
        if (query[key] === "") delete query[key];
    }
}

module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        if (query.hangup === "yes") {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        if (!YEMOT_TOKEN) {
            return res.status(200).send("id_list_message=t-תקלה במערכת חסר מפתח הגדרה&hangup=yes");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        const ApiPhone = query.ApiPhone || "UnknownPhone";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        cleanupEmptyQueryVariables(query);
        
        // סידור מחדש של הסטייט משין למניעת התנגשויות
        let state = 0;
        if (query.SetDefaultChoice !== undefined) state = 5;
        else if (query.TargetFolderCopy !== undefined) state = 4;
        else if (query.WantCopySave !== undefined) state = 33;
        else if (query.TargetFolderDefault !== undefined) state = 3;
        else if (query.VoiceIndex !== undefined) state = 2;
        else if (query.VoiceGender !== undefined) state = 1;
        else if (query.UserAudioRecord !== undefined) state = 100;

        let responseBuilder = null;

        switch (state) {
            case 0:
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("ברוכים הבאים למחולל ההקראות החכם של ג'מיני")
                    .addText("הקליטו את הטקסט שברצונכם להקריא ולאחר מכן הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 100:
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                const transcribedTextWithEmotion = await gemini.transcribeAudioWithEmotion(mainAudioBuffer);

                if (!transcribedTextWithEmotion || transcribedTextWithEmotion.length < 2) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("לא הצלחנו להבין את ההקלטה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                    break;
                }

                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedTextWithEmotion);

                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הטקסט נותח ונקלט בהצלחה")
                    .addText("לבחירת קול קריין גברי הקישו 1 לבחירת קול קריינית נשית הקישו 2")
                    .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false); 
                break;

            case 1:
                if (query.VoiceGender !== "1" && query.VoiceGender !== "2") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית לבחירת קול גברי הקישו 1 לקול נשי הקישו 2")
                        .setReadDigitsAdvanced("VoiceGender", 1, 1, 10, true, false, false); 
                    break;
                }

                const isMale = query.VoiceGender === "1";
                const voices = isMale ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                
                responseBuilder = new YemotCommandBuilder("read").addText("אנא בחרו את הקול הרצוי מתוך הרשימה הבאה");
                for (let i = 0; i < voices.length; i++) {
                    const num = i + 1;
                    const spokenNum = num < 10 ? `אפס ${num}` : `${num}`; 
                    responseBuilder.addText(`ל${voices[i].desc} הקישו ${spokenNum}`);
                }
                responseBuilder.addText("ובסיום הקישו סולמית");
                responseBuilder.setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false);
                break;

            case 2:
                const voiceListCheck = query.VoiceGender === "1" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                let checkIdx = parseInt(query.VoiceIndex, 10) - 1;
                
                if (isNaN(checkIdx) || checkIdx < 0 || checkIdx >= voiceListCheck.length) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("בחירה לא חוקית אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                        .setReadDigitsAdvanced("VoiceIndex", 2, 2, 15, true, true, false);
                    break;
                }

                const selectedVoiceId = voiceListCheck[checkIdx].id;
                const mainTextForTTS = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);
                const ttsBuffer = await gemini.generateTTS(mainTextForTTS, selectedVoiceId);
                const ttsTempPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`;
                await yemot.uploadFile(ttsTempPath, ttsBuffer);

                const prefPath = `ivr2:/Preferences/${ApiPhone}.txt`;
                const defaultFolder = await yemot.getTextFile(prefPath);

                // תיקון סיומת ה-WAV בהשמעה למניעת שגיאה
                if (defaultFolder && defaultFolder.trim().length > 0) {
                    const folder = defaultFolder.trim();
                    const nextFileNum = await yemot.getNextSequenceFileName(folder);
                    const finalPath = `ivr2:/${folder}/${nextFileNum}.wav`;
                    
                    await yemot.uploadFile(finalPath, ttsBuffer);

                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts.wav`) 
                        .addText(`הקובץ הושמע ונשמר בהצלחה כקובץ מספר ${nextFileNum} בשלוחת ברירת המחדל שלכם`)
                        .addText("האם תרצו לשמור עותק במיקום נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2")
                        .setReadDigitsAdvanced("WantCopySave", 1, 1, 10, true, false, false);
                } else {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addFile(`${TEMP_FOLDER}/${ApiCallId}_tts.wav`)
                        .addText("הקובץ הושמע בהצלחה כעת נעבור לשמירת הקובץ במערכת")
                        .addText("נא הקישו את מספר השלוחה לשמירה למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, true, true, true);
                }
                break;

            case 33: // שלב בחירת עותק
                if (query.WantCopySave === "1") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("נא הקישו את מספר השלוחה עבור העותק הנוסף ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        .setReadDigitsAdvanced("TargetFolderCopy", 20, 1, 15, true, true, true);
                } else {
                    responseBuilder = new YemotCommandBuilder("id_list_message").addText("תודה ולהתראות").addGoToFolder("/");
                }
                break;

            case 3: // שלב שמירת קובץ רגיל ובקשת ברירת מחדל
                let targetFolder = cleanAndSanitizeFolder(query.TargetFolderDefault);
                if (targetFolder === "0") targetFolder = "";
                
                const ttsForSave = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const seqFileName = await yemot.getNextSequenceFileName(targetFolder || "/");
                
                const uploadPath = targetFolder ? `ivr2:/${targetFolder}/${seqFileName}.wav` : `ivr2:/${seqFileName}.wav`;
                await yemot.uploadFile(uploadPath, ttsForSave);

                responseBuilder = new YemotCommandBuilder("read")
                    .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${seqFileName}`)
                    .addText("האם תרצו להגדיר שלוחה זו כברירת המחדל לשמירות הבאות לאישור הקישו 1 לסיום הקישו 2")
                    .setReadDigitsAdvanced("SetDefaultChoice", 1, 1, 10, true, false, false);
                break;

            case 4: // שלב שמירת עותק
                let copyFolder = cleanAndSanitizeFolder(query.TargetFolderCopy);
                if (copyFolder === "0") copyFolder = "";

                const ttsForCopy = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
                const copySeqName = await yemot.getNextSequenceFileName(copyFolder || "/");
                
                const copyPath = copyFolder ? `ivr2:/${copyFolder}/${copySeqName}.wav` : `ivr2:/${copySeqName}.wav`;
                await yemot.uploadFile(copyPath, ttsForCopy);

                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText(`העותק נשמר בהצלחה כקובץ מספר ${copySeqName} תודה ולהתראות`)
                    .addGoToFolder("/"); 
                break;

            case 5:
                if (query.SetDefaultChoice === "1" && query.TargetFolderDefault !== undefined) {
                    const prefPathTxt = `ivr2:/Preferences/${ApiPhone}.txt`;
                    const finalPrefs = cleanAndSanitizeFolder(query.TargetFolderDefault);
                    await yemot.uploadTextFile(prefPathTxt, finalPrefs);
                    
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("שלוחת ברירת המחדל עודכנה בהצלחה תודה ולהתראות")
                        .addGoToFolder("/");
                } else {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("תודה ולהתראות")
                        .addGoToFolder("/");
                }
                break;

            default:
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
        }

        yemotFinalResponse = responseBuilder.build();
        if (yemotFinalResponse.includes("read=") || yemotFinalResponse.includes("id_list_message=")) {
            yemotFinalResponse += `&api_add_99=yemot_token=${encodeURIComponent(YEMOT_TOKEN)}`;
            
            if (query.VoiceGender) yemotFinalResponse += `&api_add_98=VoiceGender=${query.VoiceGender}`;
            if (query.VoiceIndex) yemotFinalResponse += `&api_add_97=VoiceIndex=${query.VoiceIndex}`;
            if (query.TargetFolderDefault) yemotFinalResponse += `&api_add_96=TargetFolderDefault=${query.TargetFolderDefault}`;
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send("id_list_message=t-אירעה שגיאה קריטית במערכת אנו מתנצלים&go_to_folder=/");
    }
};
