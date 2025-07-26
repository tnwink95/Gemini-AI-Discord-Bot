const discord = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs").promises; // Import fs.promises สำหรับการทำงานกับไฟล์แบบ Asynchronous
require("dotenv").config(); // โหลดค่าจากไฟล์ .env

const MODEL = "gemini-2.5-flash"; // กำหนดโมเดล AI ที่ใช้
const API_KEY = process.env.API_KEY; // ดึง Gemini API Key จาก Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN; // ดึง Discord Bot Token จาก Environment Variables
const CHANNEL_ID = process.env.CHANNEL_ID; // ดึง Channel ID จาก Environment Variables (สำหรับกรองข้อความ)
const HISTORY_FILE = "conversation_history.json"; // กำหนดชื่อไฟล์สำหรับเก็บประวัติการสนทนา

// ตรวจสอบว่า Key ถูกโหลดมาครบหรือไม่ (เป็นแนวทางปฏิบัติที่ดี)
if (!API_KEY || !BOT_TOKEN || !CHANNEL_ID) {
    console.error(
        "Error: Missing one or more environment variables. Make sure .env file is configured correctly.",
    );
    process.exit(1); // ออกจากโปรแกรมหากไม่มี Key ที่จำเป็น
}

// สร้าง Instance ของ GoogleGenerativeAI ด้วย API Key
const ai = new GoogleGenerativeAI(API_KEY);
// รับโมเดล AI ที่ต้องการใช้
const model = ai.getGenerativeModel({ model: MODEL });

// สร้าง Instance ของ Discord Client
const client = new discord.Client({
    // กำหนด Intents ที่บอตต้องการเข้าถึง (สำคัญมากสำหรับ Discord.js v13+)
    // คุณอาจต้องการระบุ Intents เฉพาะที่จำเป็นเพื่อความปลอดภัยและประสิทธิภาพ
    intents: [
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.MessageContent, // จำเป็นสำหรับอ่านเนื้อหาข้อความ
    ],
});

// Map สำหรับเก็บประวัติการสนทนา (จะถูกโหลดจากไฟล์เมื่อเริ่มต้น)
// Key: string (รวม User ID และ Channel ID เพื่อให้แต่ละ user ในแต่ละ channel มีประวัติแยกกัน)
// Value: Array<Object> (ประวัติการสนทนาในรูปแบบที่ Gemini API เข้าใจ)
// ตัวอย่าง Key: "userId_channelId"
const contextualConversationHistory = new Map();

// ฟังก์ชันสำหรับโหลดประวัติการสนทนาจากไฟล์
async function loadConversationHistory() {
    try {
        const data = await fs.readFile(HISTORY_FILE, "utf8");
        // แปลง JSON string กลับเป็น Map
        const parsedData = JSON.parse(data);
        // ตรวจสอบว่า parsedData เป็น Array ของ [key, value] pairs หรือไม่
        if (Array.isArray(parsedData)) {
            parsedData.forEach(([key, value]) => {
                contextualConversationHistory.set(key, value);
            });
            console.log("Conversation history loaded successfully.");
        } else {
            console.warn(
                "Loaded history file is not in expected array format. Starting with empty history.",
            );
        }
    } catch (error) {
        if (error.code === "ENOENT") {
            console.log(
                "No conversation history file found. Starting with empty history.",
            );
        } else {
            console.error("Error loading conversation history:", error.message);
        }
    }
}

// ฟังก์ชันสำหรับบันทึกประวัติการสนทนาลงไฟล์
async function saveConversationHistory() {
    try {
        // แปลง Map เป็น Array ของ [key, value] pairs เพื่อให้ JSON.stringify ทำงานได้
        const dataToSave = Array.from(contextualConversationHistory.entries());
        await fs.writeFile(
            HISTORY_FILE,
            JSON.stringify(dataToSave, null, 2),
            "utf8",
        );
        console.log("Conversation history saved successfully.");
    } catch (error) {
        console.error("Error saving conversation history:", error.message);
    }
}

// Event: เมื่อบอตพร้อมใช้งาน
client.on("ready", async () => {
    console.log("Bot is ready!");
    await loadConversationHistory(); // โหลดประวัติเมื่อบอตพร้อม
});

// เข้าสู่ระบบ Discord ด้วย Bot Token
client.login(BOT_TOKEN);

// Event: เมื่อมีข้อความใหม่ถูกสร้างขึ้น
client.on("messageCreate", async (message) => {
    try {
        // กรองข้อความ: ไม่ตอบกลับข้อความจากบอตด้วยกันเอง
        if (message.author.bot) return;

        // คำสั่งพิเศษสำหรับตรวจสอบ Channel ID ของบอต
        if (message.content === "status?") {
            message.reply(
                `สวัสดี ${message.author.displayName} ${message.author.id}`,
            );
            message.reply(
                `บอทกำลังทำงานใน Channel ID: ${message.channel.name}`,
            );
            return; // หยุดการทำงานของบอตสำหรับคำสั่งนี้
        }

        // คำสั่งสำหรับล้างประวัติการสนทนา
        if (message.content === "!clearhistory") {
            const conversationKey = `${message.author.id}_${message.channel.id}`;
            contextualConversationHistory.delete(conversationKey); // ลบประวัติการสนทนาสำหรับผู้ใช้และช่องทางนี้
            await saveConversationHistory(); // บันทึกการเปลี่ยนแปลงลงไฟล์
            message.reply("ประวัติการสนทนาของคุณถูกล้างแล้วค่ะ!");
            return; // หยุดการทำงานของบอตสำหรับคำสั่งนี้
        }

        // กรองข้อความ: ตอบเฉพาะข้อความใน Channel ID ที่กำหนดไว้ใน .env
        // ถ้าคุณต้องการให้บอตตอบได้ทุก Channel ให้ลบบรรทัดนี้ออก
        if (message.channel.id !== CHANNEL_ID) return;

        // กรองข้อความ: ไม่ตอบกลับถ้าข้อความเป็นช่องว่างหรือมีแค่ whitespace
        if (!message.content.trim()) {
            return;
        }

        // ส่งสถานะ "กำลังพิมพ์..." (Typing...) ไปยัง Discord
        await message.channel.sendTyping();

        // สร้าง Key เฉพาะสำหรับผู้ใช้คนนี้ใน Channel นี้
        // เช่น "1234567890_9876543210"
        const conversationKey = `${message.author.id}_${message.channel.id}`;

        // ดึงประวัติการสนทนาสำหรับ Key นี้ (ผู้ใช้ + Channel)
        // หากไม่มีประวัติ ให้เริ่มต้นด้วย Array ว่าง
        let history = contextualConversationHistory.get(conversationKey) || [];

        const personaPrompt = {
            role: "user",
            parts: [
                {
                    text: "จากนี้ไป คุณคือบอท Paimon อ้างอิงลักษณะการพูดของตัวละคร Paimon จากเกม Genshin Impact ที่มีความรู้รอบด้าน สามารถถามข้อมูลจากเกมอื่นๆได้ทุกเกม จากนี้ Paimon จะทำงานเป็น AI อยู่ใน Discord Paimon รู้คำสั่งของโปรแกรม Discord ทั้งหมดที่ใช้งานได้และสามารถใช้ทำสั่งได้ทันที เมื่อผู้สนทนาต้องการ เมื่อ Paimon ต้องการพูดกับทุกคนในช่อง ให้ใช้ @everyone ในข้อความด้วยนะ!",
                },
            ],
        };
        // ตรวจสอบและเพิ่ม personaPrompt ถ้ายังไม่มีในประวัติ
        if (
            history.length === 0 ||
            history[0].parts[0].text !== personaPrompt.parts[0].text
        ) {
            // สร้างสำเนาของ history เพื่อไม่ให้กระทบ Map หลัก
            let sessionHistory = [...history];
            // เพิ่ม personaPrompt ไปที่ต้นประวัติ
            sessionHistory.unshift(personaPrompt);
            // อัปเดต history สำหรับ session นี้
            history = sessionHistory;
        }
        // เพิ่มข้อความของผู้ใช้ปัจจุบันเข้าไปในประวัติการสนทนา
        // Role "user" คือข้อความจากผู้ใช้
        history.push({ role: "user", parts: [{ text: message.content }] });

        // สร้าง chat object จากโมเดล AI พร้อมประวัติการสนทนา
        const chat = model.startChat({
            history: history, // ใช้ประวัติที่ดึงมา
            generationConfig: {
                maxOutputTokens: 2000, // กำหนดจำนวนโทเค็นสูงสุดของคำตอบ AI
            },
        });

        // ส่งข้อความล่าสุดไปยัง AI เพื่อรับคำตอบ
        const result = await chat.sendMessage(message.content);
        const response = await result.response;

        // ดึงข้อความที่ AI ตอบกลับออกมา
        const generatedText = response.text().trim();

        // หาก AI ไม่มีอะไรจะตอบกลับ
        if (!generatedText) {
            message.reply("ฉันไม่มีอะไรจะพูดตอนนี้ค่ะ");
            return;
        }

        // เพิ่มข้อความที่ AI ตอบกลับเข้าไปในประวัติการสนทนา
        // Role "model" คือข้อความจาก AI
        history.push({ role: "model", parts: [{ text: generatedText }] });
        // อัปเดตประวัติการสนทนาใน Map สำหรับ Key นี้ (ผู้ใช้ + Channel)
        contextualConversationHistory.set(conversationKey, history);
        await saveConversationHistory(); // บันทึกประวัติหลังจากการสนทนาแต่ละครั้ง

        // ตรวจสอบว่าคำตอบถูกบล็อกเนื่องจากนโยบายความปลอดภัยหรือไม่
        // (promptFeedback?.blockReason เป็นวิธีที่ละเอียดกว่า)
        if (
            response.text().includes("Response was blocked due to SAFETY") ||
            response.promptFeedback?.blockReason
        ) {
            message.reply(
                "ขออภัยค่ะ ฉันไม่สามารถให้คำตอบนั้นได้ เพื่อรักษาเนื้อหาให้ปลอดภัยและเหมาะสม",
            );
            return;
        }

        // ตรวจสอบความยาวของข้อความที่ AI ตอบกลับ
        if (generatedText.length > 2000) {
            // Discord มีข้อจำกัดความยาวข้อความ 2000 ตัวอักษร
            message.reply(
                "ฉันมีเรื่องจะพูดเยอะเกินไปสำหรับ Discord ที่จะแสดงในข้อความเดียวค่ะ",
            );
        } else {
            // ส่งข้อความที่ AI ตอบกลับไปยัง Channel
            message.reply({
                content: generatedText,
            });
        }
    } catch (error) {
        // จัดการข้อผิดพลาดที่เกิดขึ้น
        console.error("Error:", error.message);
        console.error(error.stack); // แสดง Stack Trace เพื่อช่วยในการ debug
        message.reply("เกิดข้อผิดพลาดบางอย่างค่ะ กรุณาลองอีกครั้งในภายหลัง.");
    }
});
