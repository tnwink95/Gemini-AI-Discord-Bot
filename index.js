const discord = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const MODEL = "gemini-2.5-flash";
const API_KEY = process.env.API_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const ai = new GoogleGenerativeAI(API_KEY);
const model = ai.getGenerativeModel({ model: MODEL });

const client = new discord.Client({
  intents: Object.keys(discord.GatewayIntentBits),
});

client.on("ready", () => {
  console.log("Bot is ready!");
});

client.login(BOT_TOKEN);

const conversationHistory = new Map();

client.on("messageCreate", async (message) => {
    try {
        if (message.content === "status?") {
            message.reply(message.channel.id);
        } 
        else {
        if (message.author.bot) return;
        if (message.channel.id !== CHANNEL_ID) return;

        if (!message.content.trim()) {
            return;
        }

        await message.channel.sendTyping();

        // ดึงประวัติการสนทนาสำหรับ Channel นี้
        let history = conversationHistory.get(message.channel.id) || [];

        // เพิ่มข้อความของผู้ใช้ปัจจุบันเข้าไปในประวัติ
        history.push({ role: "user", parts: [{ text: message.content }] });

        // สร้าง chat object โดยใช้ประวัติการสนทนา
        const chat = model.startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: 2000, // กำหนด max output tokens เพื่อไม่ให้ response ยาวเกินไป
            },
     });
        

        // ส่งข้อความล่าสุดไปยัง AI พร้อมประวัติการสนทนา
        const result = await chat.sendMessage(message.content);
        const response = await result.response;

        const generatedText = response.text().trim();

        if (!generatedText) {
            message.reply("ฉันไม่มีอะไรจะพูดตอนนี้ค่ะ");
            return;
        }

        // เพิ่มข้อความที่ AI ตอบกลับเข้าไปในประวัติ
        history.push({ role: "model", parts: [{ text: generatedText }] });
        // อัปเดตประวัติการสนทนาใน Map
        conversationHistory.set(message.channel.id, history);

        // Check if the response was blocked due to safety
        // (คุณอาจจะต้องตรวจสอบ response.promptFeedback.blockReason หากใช้ chat.sendMessage)
        if (response.text().includes("Response was blocked due to SAFETY") || response.promptFeedback?.blockReason) {
             message.reply("ขออภัยค่ะ ฉันไม่สามารถให้คำตอบนั้นได้ เพื่อรักษาเนื้อหาให้ปลอดภัยและเหมาะสม");
             return;
        }


        if (generatedText.length > 2000) {
            message.reply("ฉันมีเรื่องจะพูดเยอะเกินไปสำหรับ Discord ที่จะแสดงในข้อความเดียวค่ะ");
        } else {
            message.reply({
                content: generatedText,
            });
        }
    }
        
    } catch (error) {
        console.error("Error:", error.message);
        console.error(error.stack);
        message.reply("เกิดข้อผิดพลาดบางอย่างค่ะ กรุณาลองอีกครั้งในภายหลัง.");
    }
});