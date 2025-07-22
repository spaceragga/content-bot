import { Telegraf, Context } from "telegraf";
import axios from "axios";
import * as dotenv from "dotenv";
import express from "express";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN!);

interface MemeResponse {
    url: string;
    title: string;
    author: string;
    subreddit: string;
    ups: number;
    preview: string[];
}

const RECENT_MEMES_LIMIT = 100;
const recentMemes = new Set<string>();

// Meme command handler
bot.command("mem", async (ctx: Context) => {
    try {
        const meme = await fetchRandomMeme();

        if (meme) {
            const qualityEmoji =
                meme.ups >= 10000 ? "🔥" : meme.ups >= 5000 ? "⚡" : "👍";
            await ctx.replyWithPhoto(meme.url, {
                caption: `${qualityEmoji} ${meme.title}\n r/${meme.subreddit
                    } • ⬆️ ${meme.ups.toLocaleString()}`,
            });
        } else {
            await ctx.reply("😅 Sorry, couldn't fetch a meme right now. Try again!");
        }
    } catch (error) {
        console.error("Error in mem command:", error);
        await ctx.reply(
            "❌ Something went wrong while fetching the meme! Try again"
        );
    }
});

// Fetch random meme from Reddit API
async function fetchRandomMeme(): Promise<MemeResponse | null> {
    try {
        const subreddits = [
            "memes",
            "dankmemes",
            "wholesomememes",
            "funny",
            "animemes",
            "comedyheaven",
        ];
        const randomSubreddit =
            subreddits[Math.floor(Math.random() * subreddits.length)];

        const response = await axios.get(
            `https://meme-api.com/gimme/${randomSubreddit}`,
            {
                timeout: 10000,
                headers: {
                    "User-Agent": "ContentBot/1.0",
                },
            }
        );

        const data = response.data;

        // Check for repeats
        if (
            data.url &&
            (data.url.includes(".jpg") ||
                data.url.includes(".png") ||
                data.url.includes(".gif")) &&
            data.ups >= 1000 &&
            !recentMemes.has(data.url)
        ) {
            // Add to recent memes
            recentMemes.add(data.url);
            if (recentMemes.size > RECENT_MEMES_LIMIT) {
                // Remove oldest
                const first = recentMemes.values().next().value;
                recentMemes.delete(first as string);
            }
            return {
                url: data.url,
                title: data.title || "Untitled Meme",
                author: data.author || "Anonymous",
                subreddit: data.subreddit || randomSubreddit,
                ups: data.ups || 0,
                preview: data.preview || [],
            };
        }

        // If no high-rated or non-repeated meme found, try again (recursive call with limit)
        return await retryFetchMeme(randomSubreddit, 3);
    } catch (error) {
        console.error("Error fetching meme:", error);
        return null;
    }
}

// Retry function to get top-rated content
async function retryFetchMeme(
    subreddit: string,
    attempts: number
): Promise<MemeResponse | null> {
    if (attempts <= 0) return null;

    try {
        const response = await axios.get(
            `https://meme-api.com/gimme/${subreddit}`,
            {
                timeout: 10000,
                headers: {
                    "User-Agent": "ContentBot/1.0",
                },
            }
        );

        const data = response.data;

        // Lower threshold for retries
        const minUpvotes = attempts === 3 ? 500 : 100;

        if (
            data.url &&
            (data.url.includes(".jpg") ||
                data.url.includes(".png") ||
                data.url.includes(".gif")) &&
            data.ups >= minUpvotes &&
            !recentMemes.has(data.url)
        ) {
            recentMemes.add(data.url);
            if (recentMemes.size > RECENT_MEMES_LIMIT) {
                const first = recentMemes.values().next().value;
                recentMemes.delete(first as string);
            }
            return {
                url: data.url,
                title: data.title || "Untitled Meme",
                author: data.author || "Anonymous",
                subreddit: data.subreddit || subreddit,
                ups: data.ups || 0,
                preview: data.preview || [],
            };
        }

        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await retryFetchMeme(subreddit, attempts - 1);
    } catch (error) {
        console.error(`Retry attempt ${attempts} failed:`, error);
        return await retryFetchMeme(subreddit, attempts - 1);
    }
}

// Start message
bot.start((ctx: Context) => {
    ctx.reply(`
🤖 Welcome to Content Bot!

Commands:
/mem - Get a top-rated meme

Just send /mem and I'll find you the best memes with 1000+ upvotes! 🔥
  `);
});

// Health check endpoint for Heroku
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("Content Bot is running! 🤖");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Set up webhook route for production
if (process.env.NODE_ENV === "production") {
    app.use(bot.webhookCallback("/webhook"));

    // Set webhook URL
    bot.telegram.setWebhook(`${process.env.HEROKU_URL}/webhook`);
} else {
    // Use polling for development
    bot.launch();
}

console.log("Content bot started successfully! 🚀");

// Enable graceful stop
process.once("SIGINT", () => {
    console.log("\n🛑 Received SIGINT (Ctrl+C). Shutting down gracefully...");
    bot.stop("SIGINT");
    process.exit(0);
});

process.once("SIGTERM", () => {
    console.log("\n🛑 Received SIGTERM. Shutting down gracefully...");
    bot.stop("SIGTERM");
    process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
    console.error("❌ Uncaught Exception:", error);
    bot.stop("SIGTERM");
    process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
    bot.stop("SIGTERM");
    process.exit(1);
});
