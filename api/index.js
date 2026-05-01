/**
 * @file index.js
 * @description בקר השיחה (Controller). מנהל את זרימת המשתמש.
 * מותאם לחוויה חלקה, ללא אישורים כפולים ועם תפריטי הקלטה מלאים.
 */

const { GeminiClient, YemotClient, GEMINI_VOICES } = require('./core');

const KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : ["YOUR_KEY"];
const gemini = new GeminiClient(KEYS);
const TEMP = "/Temp_Gemini_App";

/**
 * בונה תגובות בפורמט ימות המשיח עם ניקוי תווים אסורים
 */
class YemotResponse {
    constructor(action) {
        this.action = action;
        this.content = [];
        this.apiAdd = {};
    }
    addT(text) { this.content.push(`t-${text.replace(/[.\-(),]/g, "")}`); return this; }
    addF(path) { this.content.push(`f-${path}`); return this; }
    setApi(key, val) { this.apiAdd[key] = val; return this; }
    
    // בניית read לספרות (דינמי - סיפרה 1 או 2)
    readDigits(varName, count, timeout = 10) {
        // פרמטר 7 = No מבטל את ה"לאישור הקישו 1"
        this.params = `${varName},no,Digits,${count},${count},${timeout},No,yes`;
        return this;
    }
    
    // בניית read להקלטה עם תפריט אישור מלא
    readRecord(varName, filename) {
        // פרמטר 6 = yes מפעיל תפריט M3345 מלא (שמיעה, אישור, מחדש, המשך)
        this.params = `${varName},no,record,${TEMP},${filename},yes,yes,no,2,120`;
        return this;
    }

    build() {
        let r = `${this.action}=${this.content.join('.')}`;
        if (this.params) r += `=${this.params}`;
        Object.entries(this.apiAdd).forEach(([k, v], i) => {
            r += `&api_add_${i}=${k}=${encodeURIComponent(v)}`;
        });
        return r;
    }
}

module.exports = async function (req, res) {
    const q = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
    if (q.hangup === "yes") return res.status(200).send("");

    const yemot = new YemotClient(q.yemot_token);
    const phone = q.ApiPhone || "000";
    const callId = q.ApiCallId || "000";

    // Stateless State Recognition
    let state = 0;
    if (q.SetDefaultChoice) state = 9;
    else if (q.TargetFolderCopy) state = 85;
    else if (q.TargetFolderDefault) state = 8;
    else if (q.UserChoiceAdditionalSave) state = 7;
    else if (q.StyleChoice) state = 4;
    else if (q.VoiceIndex) state = 3;
    else if (q.VoiceGender) state = 2;
    else if (q.UserAudioRecord) state = 1;

    try {
        let out = "";
        switch (state) {
            case 0:
                out = new YemotResponse("read").addT("ברוכים הבאים למערכת היצירה הקולית הקליטו את הטקסט ובסיום הקישו סולמית")
                    .readRecord("UserAudioRecord", `${callId}_main`).setApi("yemot_token", q.yemot_token).build();
                break;

            case 1:
                const audio = await yemot.download(`ivr2:${TEMP}/${callId}_main.wav`);
                const text = await gemini.stt(audio);
                await yemot.saveText(`ivr2:${TEMP}/${callId}_txt.txt`, text);
                out = new YemotResponse("read").addT("הטקסט נקלט בהצלחה לבחירת קול של גבר הקישו 1 לבחירת קול של אישה הקישו 2")
                    .readDigits("VoiceGender", 1).setApi("yemot_token", q.yemot_token).build();
                break;

            case 2:
                const isM = q.VoiceGender === "1";
                const voices = isM ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const builder = new YemotResponse("read").addT("בחרו את הקול הרצוי");
                voices.forEach((v, i) => {
                    const d = (i + 1).toString().padStart(2, '0');
                    builder.addT(`ל${v.desc} הקישו ${d.replace("0", "אפס ")}`);
                });
                out = builder.readDigits("VoiceIndex", 2, 15).setApi("yemot_token", q.yemot_token).setApi("gender", isM ? "MALE" : "FEMALE").build();
                break;

            case 3:
                out = new YemotResponse("read").addT("לבחירת סגנון רגיל הקישו 1 לשמח הקישו 2 לרציני הקישו 3 להנחיות במאי בהקלטה הקישו 4")
                    .readDigits("StyleChoice", 1).setApi("yemot_token", q.yemot_token).setApi("vId", q.VoiceIndex).setApi("gen", q.gender).build();
                break;

            case 4:
                const style = q.StyleChoice;
                if (style === "4") {
                    out = new YemotResponse("read").addT("הקליטו את הנחיות הבמאי ובסיום הקישו סולמית")
                        .readRecord("CustomStyleRecord", `${callId}_style`).setApi("yemot_token", q.yemot_token).setApi("vId", q.vId).setApi("gen", q.gen).build();
                } else {
                    const txt = await yemot.download(`ivr2:${TEMP}/${callId}_txt.txt`).then(b => b.toString());
                    const vList = q.gen === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                    const vObj = vList[parseInt(q.vId) - 1];
                    let cue = vObj.cue;
                    if (style === "2") cue = "[Tone: very happy and excited]";
                    if (style === "3") cue = "[Tone: very serious and formal]";
                    
                    const result = await gemini.tts(txt, vObj.id, cue);
                    await yemot.upload(`${TEMP}/${callId}_res.wav`, result);
                    
                    const pref = await yemot.download(`ivr2:/Preferences/${phone}.txt`).then(b => b.toString()).catch(() => "");
                    if (pref && pref.length > 0) {
                        const folder = pref.trim();
                        const next = await yemot.getNextFile(folder);
                        await yemot.upload(`ivr2:/${folder}/${next}.wav`, result);
                        out = new YemotResponse("read").addF(`${TEMP}/${callId}_res`).addT(`נשמר בהצלחה בשלוחה המועדפת כקובץ ${next} האם לשמור עותק נוסף לאישור הקישו 1 לביטול וחזרה הקישו 2`)
                            .readDigits("UserChoiceAdditionalSave", 1).setApi("yemot_token", q.yemot_token).build();
                    } else {
                        out = new YemotResponse("read").addF(`${TEMP}/${callId}_res`).addT("הקישו את מספר השלוחה לשמירה")
                            .readDigits("TargetFolderDefault", 10, 15).setApi("yemot_token", q.yemot_token).build();
                    }
                }
                break;

            case 5: // חזרה מהקלטת במאי
                const sAud = await yemot.download(`ivr2:${TEMP}/${callId}_style.wav`);
                const sTxt = await gemini.stt(sAud);
                const mTxt = await yemot.download(`ivr2:${TEMP}/${callId}_txt.txt`).then(b => b.toString());
                const vL = q.gen === "MALE" ? GEMINI_VOICES.MALE : GEMINI_VOICES.FEMALE;
                const vO = vL[parseInt(q.vId) - 1];
                const resBuf = await gemini.tts(mTxt, vO.id, `[Director context: ${sTxt}]`);
                await yemot.upload(`${TEMP}/${callId}_res.wav`, resBuf);
                out = new YemotResponse("read").addF(`${TEMP}/${callId}_res`).addT("הקישו את מספר השלוחה לשמירה")
                    .readDigits("TargetFolderDefault", 10, 15).setApi("yemot_token", q.yemot_token).build();
                break;

            case 7:
                if (q.UserChoiceAdditionalSave === "1") {
                    out = new YemotResponse("read").addT("הקישו מספר שלוחה להעתק").readDigits("TargetFolderCopy", 10).setApi("yemot_token", q.yemot_token).build();
                } else out = "go_to_folder=/";
                break;

            case 8:
            case 85:
                const fld = (q.TargetFolderDefault || q.TargetFolderCopy).replace(/\*/g, "/");
                const resA = await yemot.download(`ivr2:${TEMP}/${callId}_res.wav`);
                const nxt = await yemot.getNextFile(fld);
                await yemot.upload(`ivr2:/${fld}/${nxt}.wav`, resA);
                if (state === 85) out = `id_list_message=t-הקובץ הועתק בהצלחה&go_to_folder=/`;
                else out = new YemotResponse("read").addT(`נשמר כקובץ ${nxt} להגדרת שלוחה זו כברירת מחדל הקישו 1 לסיום הקישו 2`)
                    .readDigits("SetDefaultChoice", 1).setApi("fld", fld).setApi("yemot_token", q.yemot_token).build();
                break;

            case 9:
                if (q.SetDefaultChoice === "1") await yemot.saveText(`ivr2:/Preferences/${phone}.txt`, q.fld);
                out = `id_list_message=t-תודה ולהתראות&go_to_folder=/`;
                break;

            default: out = "go_to_folder=/";
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(out);
    } catch (e) {
        console.error(e);
        res.status(200).send("id_list_message=t-אירעה שגיאה במערכת&go_to_folder=/");
    }
};
