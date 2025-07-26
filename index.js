const discord = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config(); // Loads values from .env file

const MODEL = "gemini-2.5-flash"; // Defines the AI model to use for text generation
const IMAGE_MODEL = "imagen-3.0-generate-002"; // Defines the AI model to use for image generation
const API_KEY = process.env.API_KEY; // Retrieves Gemini API Key from Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN; // Retrieves Discord Bot Token from Environment Variables
const CHANNEL_ID = process.env.CHANNEL_ID; // Retrieves Channel ID from Environment Variables (for message filtering)

const COMMAND_PREFIX = "!"; // Prefix for bot commands, e.g., !generateimage

// Checks if all necessary keys are loaded (good practice)
if (!API_KEY || !BOT_TOKEN || !CHANNEL_ID) {
    console.error(
        "Error: Missing one or more environment variables. Make sure .env file is configured correctly.",
    );
    process.exit(1); // Exits the program if essential keys are missing
}

// Creates an instance of GoogleGenerativeAI with the API Key
const ai = new GoogleGenerativeAI(API_KEY);
// Gets the desired AI model for text generation
const textModel = ai.getGenerativeModel({ model: MODEL });
// Gets the desired AI model for image generation
const imageModel = ai.getGenerativeModel({ model: IMAGE_MODEL });

// Creates an instance of Discord Client
const client = new discord.Client({
    // Defines the Intents the bot needs to access (very important for Discord.js v13+)
    // It's recommended to specify only necessary Intents for security and performance.
    intents: [
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.MessageContent, // Essential for reading message content
    ],
});

// Event: When the bot is ready
client.on("ready", () => {
    console.log("Bot is ready!");
});

// Logs in to Discord with the Bot Token
client.login(BOT_TOKEN);

// Map to store conversation history
// Key: string (combines User ID and Channel ID so each user in each channel has separate history)
// Value: Array<Object> (conversation history in a format understood by Gemini API)
// Example Key: "userId_channelId"
const contextualConversationHistory = new Map();

// Event: When a new message is created
client.on("messageCreate", async (message) => {
    try {
        // Special command to check the bot's Channel ID
        if (message.content === "status?") {
            message.reply(`บอทกำลังทำงานใน Channel ID: ${message.channel.id}`);
            return; // Stops bot operation for this command
        }

        // Filters messages: Does not reply to messages from other bots
        if (message.author.bot) return;

        // Filters messages: Only replies to messages in the Channel ID specified in .env
        // If you want the bot to reply in all channels, remove this line.
        if (message.channel.id !== CHANNEL_ID) return;

        // Filters messages: Does not reply if the message is empty or contains only whitespace
        if (!message.content.trim()) {
            return;
        }

        // --- Image Generation Command Handling ---
        if (message.content.startsWith(`${COMMAND_PREFIX}รูป`)) {
            const prompt = message.content
                .slice(`${COMMAND_PREFIX}รูป`.length)
                .trim();

            if (!prompt) {
                message.reply(
                    "โปรดระบุข้อความสำหรับสร้างรูปภาพด้วยค่ะ เช่น `!รูป แมวอวกาศ`",
                );
                return;
            }

            // Sends "Typing..." status to Discord
            const typingIndicator = await message.channel.sendTyping();
            const loadingMessage = await message.reply(
                "กำลังสร้างรูปภาพให้ Paimon สักครู่นะ...",
            );

            try {
                const payload = {
                    instances: { prompt: prompt },
                    parameters: { sampleCount: 1 },
                };
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:predict?key=${API_KEY}`;
                const response = await fetch(apiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });

                const result = await response.json();

                if (
                    result.predictions &&
                    result.predictions.length > 0 &&
                    result.predictions[0].bytesBase64Encoded
                ) {
                    const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
                    // Send the image as a Discord attachment
                    await message.reply({
                        files: [
                            {
                                attachment: Buffer.from(
                                    result.predictions[0].bytesBase64Encoded,
                                    "base64",
                                ),
                                name: "generated_image.png",
                            },
                        ],
                    });
                } else {
                    message.reply(
                        "Paimon สร้างรูปภาพไม่ได้ค่ะ ลองข้อความอื่นดูนะ!",
                    );
                    console.error("Image generation failed:", result);
                }
            } catch (imageError) {
                console.error("Error generating image:", imageError);
                message.reply(
                    "เกิดข้อผิดพลาดในการสร้างรูปภาพค่ะ กรุณาลองอีกครั้งในภายหลัง.",
                );
            } finally {
                // Delete the typing indicator and loading message
                if (typingIndicator) typingIndicator.delete();
                if (loadingMessage) loadingMessage.delete();
            }
            return; // Stop further processing for image command
        }

        // --- Text Generation (Existing Logic) ---

        // Sends "Typing..." status to Discord
        await message.channel.sendTyping();

        // Creates a unique key for this user in this channel
        // e.g., "1234567890_9876543210"
        const conversationKey = `${message.author.id}_${message.channel.id}`;

        // Retrieves conversation history for this key (user + channel)
        // If no history, starts with an empty Array
        let history = contextualConversationHistory.get(conversationKey) || [];

        const personaPrompt = {
            role: "user",
            parts: [
                {
                    text: "จากนี้ไป คุณคือบอท Paimon อ้างอิงลักษณะการพูดของตัวละคร Paimon จากเกม Genshin Impact ที่มีความรู้รอบด้าน สามารถถามข้อมูลจากเกมอื่นๆได้ทุกเกม",
                },
            ],
        };
        if (
            history.length === 0 ||
            history[0].parts[0].text !== personaPrompt.parts[0].text
        ) {
            // Clones history to add personaPrompt at the beginning of this session
            // without affecting other sessions
            let sessionHistory = [...history]; // Creates a copy to avoid affecting the main Map
            sessionHistory.unshift(personaPrompt); // Adds personaPrompt to the beginning of history
            history = sessionHistory; // Updates history for this session
        }
        // Adds the current user's message to conversation history
        // Role "user" is messages from the user
        history.push({ role: "user", parts: [{ text: message.content }] });

        // Creates a chat object from the AI model with conversation history
        const chat = textModel.startChat({
            // Use textModel for chat
            history: history, // Uses retrieved history
            generationConfig: {
                maxOutputTokens: 2000, // Defines maximum AI response tokens
            },
        });

        // Sends the latest message to AI to get a response
        const result = await chat.sendMessage(message.content);
        const response = await result.response;

        // Extracts the AI's response text
        const generatedText = response.text().trim();

        // If AI has nothing to say
        if (!generatedText) {
            message.reply("ฉันไม่มีอะไรจะพูดตอนนี้ค่ะ");
            return;
        }

        // Adds the AI's response to conversation history
        // Role "model" is messages from AI
        history.push({ role: "model", parts: [{ text: generatedText }] });
        // Updates conversation history in the Map for this key (user + channel)
        contextualConversationHistory.set(conversationKey, history);

        // Checks if the response was blocked due to safety policy
        // (promptFeedback?.blockReason is a more detailed way)
        if (
            response.text().includes("Response was blocked due to SAFETY") ||
            response.promptFeedback?.blockReason
        ) {
            message.reply(
                "ขออภัยค่ะ ฉันไม่สามารถให้คำตอบนั้นได้ เพื่อรักษาเนื้อหาให้ปลอดภัยและเหมาะสม",
            );
            return;
        }

        // Checks the length of the AI's response
        if (generatedText.length > 2000) {
            // Discord has a message length limit of 2000 characters
            message.reply(
                "ฉันมีเรื่องจะพูดเยอะเกินไปสำหรับ Discord ที่จะแสดงในข้อความเดียวค่ะ",
            );
        } else {
            // Sends the AI's response to the Channel
            message.reply({
                content: generatedText,
            });
        }
    } catch (error) {
        // Handles errors that occur
        console.error("Error:", error.message);
        console.error(error.stack); // Displays Stack Trace to help with debugging
        message.reply("เกิดข้อผิดพลาดบางอย่างค่ะ กรุณาลองอีกครั้งในภายหลัง.");
    }
});
